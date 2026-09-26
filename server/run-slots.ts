import { AsyncLocalStorage } from "node:async_hooks";

type Waiter = {
  entry: Entry;
  work: boolean;
  grant: () => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
};
type Root = { limit: number; active: number; queue: Waiter[] };
type Entry = {
  id: string;
  root: Root;
  signal?: AbortSignal;
  held: boolean;
  suspensions: number;
  branches: number;
  waiter?: Waiter;
  acquired: boolean;
};
type Branch = {
  entry: Entry;
  release?: () => void;
  pauses: number;
  done: boolean;
  signal?: AbortSignal;
};
const cancelled = (message: string) => new DOMException(message, "AbortError");

/**
 * Per-root job slots with FIFO admission. Limits persist until forgetRoot/close.
 * Use withWork around each non-delegation tool AFTER outer authorization. Its
 * async scope lets internal approvals yield only their own branch's pin.
 * Delegate tools must remain outside withWork so waiting on children can yield.
 * Abort after admission does not release executing code; always release/finally.
 */
export class RunSlots {
  private roots = new Map<string, Root>();
  private jobs = new Map<string, Entry>();
  private scope = new AsyncLocalStorage<Branch>();
  private closed = false;

  async acquire(
    jobId: string,
    rootId: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.closed) throw cancelled("Run slots are closed");
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError("Run slot limit must be a positive safe integer");
    if (this.jobs.has(jobId))
      throw new Error(`Job already registered: ${jobId}`);
    let root = this.roots.get(rootId);
    if (!root) {
      root = { limit, active: 0, queue: [] };
      this.roots.set(rootId, root);
    }
    const entry: Entry = {
      id: jobId,
      root,
      signal,
      held: false,
      suspensions: 0,
      branches: 0,
      acquired: false,
    };
    this.jobs.set(jobId, entry);
    await this.enqueue(entry, false);
  }

  release(jobId: string): void {
    const entry = this.jobs.get(jobId);
    if (entry) this.remove(entry, cancelled("Job released"));
  }

  isSuspended(jobId: string): boolean {
    const entry = this.jobs.get(jobId);
    return !!entry?.acquired && !entry.held;
  }

  forgetRoot(rootId: string): boolean {
    const root = this.roots.get(rootId);
    if (!root || root.active || root.queue.length) return false;
    for (const entry of this.jobs.values())
      if (entry.root === root) return false;
    return this.roots.delete(rootId);
  }

  /** Pin executable work. Raw leases must be released before any internal wait. */
  async enterWork(jobId: string, signal?: AbortSignal): Promise<() => void> {
    const entry = this.jobs.get(jobId);
    if (!entry?.acquired)
      throw cancelled(`Job has not acquired a slot: ${jobId}`);
    entry.signal?.throwIfAborted();
    signal?.throwIfAborted();
    await this.enqueue(entry, true, signal);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (this.jobs.get(jobId) !== entry) return;
      entry.branches--;
      this.yield(entry);
    };
    if (
      this.jobs.get(jobId) !== entry ||
      entry.signal?.aborted ||
      signal?.aborted
    ) {
      release();
      throw entry.signal?.reason ?? signal?.reason ?? cancelled("Job released");
    }
    return release;
  }

  /** Async branch scope is required for tools with internal authorization waits. */
  async withWork<T>(
    jobId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const entry = this.jobs.get(jobId);
    const current = this.scope.getStore();
    signal?.throwIfAborted();
    entry?.signal?.throwIfAborted();
    // Nested helpers in one tool share its pin and approval scope.
    if (current && current.entry === entry && !current.done) {
      if (!current.release || current.pauses)
        throw new Error("Cannot start nested work from a suspended branch");
      return operation();
    }
    const release = await this.enterWork(jobId, signal);
    if (
      !entry ||
      this.jobs.get(jobId) !== entry ||
      entry.signal?.aborted ||
      signal?.aborted
    ) {
      release();
      throw (
        entry?.signal?.reason ?? signal?.reason ?? cancelled("Job released")
      );
    }
    const branch: Branch = { entry, release, pauses: 0, done: false, signal };
    try {
      return await this.scope.run(branch, operation);
    } finally {
      branch.done = true;
      branch.release?.();
      branch.release = undefined;
    }
  }

  /** Reference-counted waits; scoped work always reacquires before continuing. */
  suspend(jobId: string): () => Promise<void> {
    const entry = this.jobs.get(jobId);
    if (!entry?.acquired)
      throw new Error(`Job has not acquired a slot: ${jobId}`);
    const context = this.scope.getStore();
    const branch =
      context?.entry === entry && !context.done ? context : undefined;
    entry.suspensions++;
    if (branch) {
      branch.pauses++;
      branch.release?.();
      branch.release = undefined;
    }
    if (entry.waiter) {
      const waiter = entry.waiter;
      this.unqueue(waiter);
      waiter.grant();
    }
    this.yield(entry);
    let result: Promise<void> | undefined;
    return () =>
      (result ??= (async () => {
        if (this.jobs.get(jobId) !== entry) {
          if (branch && !branch.done) throw cancelled("Job released");
          return;
        }
        entry.suspensions--;
        if (!entry.suspensions && !entry.held) await this.enqueue(entry, false);
        if (branch && --branch.pauses === 0 && !branch.done)
          branch.release = await this.enterWork(jobId, branch.signal);
      })());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.jobs.values())
      this.remove(entry, cancelled("Run slots are closed"));
    this.roots.clear();
  }

  private yield(entry: Entry): void {
    if (entry.held && entry.suspensions > 0 && entry.branches === 0) {
      entry.held = false;
      entry.root.active--;
    }
    this.drain(entry.root);
  }

  private enqueue(
    entry: Entry,
    work: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const signals = [
        ...new Set([entry.signal, signal].filter((s): s is AbortSignal => !!s)),
      ];
      const abort = () => {
        const reason = signals.find((s) => s.aborted)?.reason;
        if (!work) this.remove(entry, reason);
        else {
          this.unqueue(waiter);
          reject(reason);
          this.drain(entry.root);
        }
      };
      const waiter: Waiter = {
        entry,
        work,
        grant: resolve,
        reject,
        cleanup: () =>
          signals.forEach((s) => s.removeEventListener("abort", abort)),
      };
      if (!work) entry.waiter = waiter;
      entry.root.queue.push(waiter);
      signals.forEach((s) =>
        s.addEventListener("abort", abort, { once: true }),
      );
      if (signals.some((s) => s.aborted)) abort();
      else this.drain(entry.root);
    });
  }

  private unqueue(waiter: Waiter): void {
    const { entry } = waiter;
    if (entry.waiter === waiter) entry.waiter = undefined;
    const index = entry.root.queue.indexOf(waiter);
    if (index >= 0) entry.root.queue.splice(index, 1);
    waiter.cleanup();
  }

  private remove(entry: Entry, reason: unknown): void {
    if (this.jobs.get(entry.id) !== entry) return;
    this.jobs.delete(entry.id);
    for (const waiter of [...entry.root.queue]) {
      if (waiter.entry !== entry) continue;
      this.unqueue(waiter);
      waiter.reject(reason);
    }
    if (entry.held) {
      entry.held = false;
      entry.root.active--;
    }
    this.drain(entry.root);
  }

  private drain(root: Root): void {
    if (this.closed) return;
    // Sharing an already-held job slot consumes no additional root capacity.
    for (const waiter of [...root.queue]) {
      const { entry } = waiter;
      if (!entry.held && root.active >= root.limit) continue;
      this.unqueue(waiter);
      if (!entry.held) {
        entry.held = true;
        root.active++;
      }
      entry.acquired = true;
      if (waiter.work) entry.branches++;
      waiter.grant();
    }
  }
}
