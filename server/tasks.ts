import { randomUUID } from "node:crypto";
import { runAgent } from "./agent.ts";
import type { RunOptions } from "./runtime.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
import type {
  RunEvent,
  Session,
  SessionView,
  Environment,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { finishRun, finishUserMessage } from "./task-lifecycle.ts";
import { RunStore } from "./runs.ts";
import type { RunPermissions, TaskRun } from "../shared/types.ts";
import { Projects } from "./projects.ts";
import { findBash, shellContext, shellMissing } from "./shell.ts";
import { recoveryContext } from "./recovery.ts";
import { WorkLocations } from "./work-locations.ts";

export type AgentRunner = typeof runAgent;
export class TaskService {
  store: Store;
  workspace: Workspace;
  runner: AgentRunner;
  runs: RunStore;
  projects: Projects;
  locations: WorkLocations;
  running = new Map<
    string,
    {
      controller: AbortController;
      text: string;
      activity: string[];
      runId: string;
    }
  >();
  extensions?: (session: Session, runId: string) => Partial<RunOptions>;
  timeoutMs = 300000;
  isWaiting?: (sessionId: string) => boolean;
  constructor(
    store: Store,
    workspace: Workspace,
    runner: AgentRunner = runAgent,
  ) {
    this.store = store;
    this.workspace = workspace;
    this.runner = runner;
    this.runs = new RunStore(
      store.directory,
      (run) =>
        !!store.conversations.db
          .prepare(
            "SELECT 1 FROM messages WHERE session_id=? AND channel='chat' AND json_extract(value,'$.runId')=? AND json_extract(value,'$.role')='assistant' AND json_extract(value,'$.status')='complete' LIMIT 1",
          )
          .get(run.sessionId, run.id),
    );
    this.projects = new Projects(store, workspace);
    this.locations = new WorkLocations(store, this.projects, workspace);
  }
  async create({
    botId,
    projectId,
  }: { botId?: string; projectId?: string } = {}) {
    const session: Session = {
      project: this.projects.get(projectId),
      id: randomUUID(),
      title: "新的對話",
      botId,
      createdAt: new Date().toISOString(),
      messages: [],
    };
    this.store.conversations.transaction(() =>
      this.store.conversations.saveSession(session),
    );
    if (projectId)
      this.locations.bind(
        session.id,
        this.store.conversations.activeId(session.id),
        this.locations.project(projectId),
      );
    return session;
  }
  view(id: string): SessionView {
    this.locations.ensure(id);
    const session = this.store.conversations.metadata(id);
    if (!session)
      throw Object.assign(new Error("找不到工作階段。"), { status: 404 });
    const { engineState, ...view } = session;
    const live = this.running.get(id);
    return {
      ...view,
      ...this.store.conversations.page(id),
      context: this.store.conversations.context(id),
      running: !!live,
      activeRunId: live?.runId,
      ...(live
        ? { live: { text: live.text, activity: [...live.activity] } }
        : {}),
    };
  }
  stop(id: string) {
    this.running.get(id)?.controller.abort();
  }
  stopAll() {
    for (const id of this.running.keys()) this.stop(id);
  }
  async run(
    id: string,
    prompt: string,
    allowWrites: boolean,
    onEvent: (event: RunEvent) => void = () => {},
    signal?: AbortSignal,
    permissions?: RunPermissions,
    workContextId?: string,
  ) {
    const session = this.store.conversations.load(id, workContextId);
    const location = this.locations.lock(id, session.workContextId!);
    session.project = {
      id: location.projectId || location.id,
      name: location.name,
      path: location.path,
    };
    if (this.running.has(id))
      throw Object.assign(new Error("此對話正在執行，請等待完成或停止。"), {
        status: 409,
      });
    if (!prompt.trim() || prompt.length > 16000)
      throw Object.assign(new Error("訊息需為 1–16000 字。"), { status: 400 });
    const controller = new AbortController();
    const runId = randomUUID();
    const configured = this.extensions?.(session, runId);
    const extensions = configured && {
      ...configured,
      agent: configured.agent && structuredClone(configured.agent),
      env: configured.env && { ...configured.env },
      runtimeSettings:
        configured.runtimeSettings &&
        structuredClone(configured.runtimeSettings),
      modelSettings:
        configured.modelSettings && structuredClone(configured.modelSettings),
    };
    const timeoutMs =
      extensions?.runtimeSettings?.taskTimeoutMs ?? this.timeoutMs;
    const grants = permissions || {
      files: allowWrites,
      memory: allowWrites,
      skills: allowWrites,
    };
    const live = { controller, text: "", activity: [] as string[], runId };
    this.running.set(id, live);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let timedOut = false;
    let activeMs = 0;
    let lastTick = Date.now();
    const timer = setInterval(() => {
      const tick = Date.now();
      if (!this.isWaiting?.(id)) activeMs += tick - lastTick;
      lastTick = tick;
      if (activeMs >= timeoutMs) {
        timedOut = true;
        abort();
      }
    }, 1000);
    const env: Environment = extensions?.env || {};
    const userId = randomUUID();
    const run: TaskRun = {
      jobId: extensions?.jobId,
      location,
      workContextId: session.workContextId,
      project: session.project || this.projects.get(),
      id: runId,
      sessionId: id,
      engine: "deepagents",
      agentName: extensions?.agent?.name || "Apsis",
      connectionId: extensions?.agent?.connectionId,
      model: extensions?.agent?.model || env.MODEL_ID || "",
      permissions: grants,
      status: "running",
      createdAt: new Date().toISOString(),
      text: "",
      activity: live.activity,
      operations: [],
      timeline: [],
    };
    // Queue the initial durable record synchronously, before returning a task ID.
    const initialSave = this.runs.save(run);
    const redact = (value: string) =>
      [env.OPENAI_API_KEY, env.COMPATIBLE_API_KEY, env.ANTHROPIC_API_KEY]
        .filter((v): v is string => !!v)
        .reduce((text, key) => text.replaceAll(key, "[redacted]"), value);
    let persistenceError: Error | undefined;
    const failedPersistence = (error: unknown): never => {
      persistenceError ||= new Error(
        "任務日誌寫入失敗：" + asError(error).message,
      );
      controller.abort();
      throw persistenceError;
    };
    const persist = (value: TaskRun) =>
      this.runs.save(value).catch(failedPersistence);
    const persistProgress = () => {
      // RunStore retains failures for flush; the task also stops immediately.
      void persist(run).catch(() => {});
    };
    const emit = (event: RunEvent) => {
      if ("text" in event && typeof event.text === "string")
        event = { ...event, text: redact(event.text) };
      if (event.type === "execution") {
        const evidence = JSON.parse(redact(JSON.stringify(event.evidence)));
        run.timeline!.push({
          ...evidence,
          id: randomUUID(),
          at: new Date().toISOString(),
        });
        persistProgress();
      }
      if (event.type === "delta") live.text += event.text;
      if (event.type === "commentary") {
        run.progress = {
          kind: "message",
          text: event.text,
          updatedAt: new Date().toISOString(),
        };
        if (!run.timeline!.some((entry) => entry.id === event.id))
          run.timeline!.push({
            kind: "commentary",
            id: event.id,
            text: event.text,
            at: new Date().toISOString(),
          });
        live.text = "";
      }
      if (event.type === "activity") live.activity.push(event.text);
      if (event.type === "delta" || event.type === "progress") {
        run.progress = {
          kind: event.type === "delta" ? "reply" : "message",
          text:
            event.type === "progress"
              ? event.text?.replace(/\s+/g, " ").slice(0, 120)
              : undefined,
          updatedAt: new Date().toISOString(),
        };
      }
      run.text = live.text;
      if (event.type === "commentary") persistProgress();
      try {
        onEvent(event);
      } catch {
        /* A subscriber cannot terminate a server-owned task. */
      }
    };
    try {
      await initialSave.catch(failedPersistence);
      const workspace = this.locations.workspace(location);
      await workspace.ready();
      const recovery = recoveryContext(this.runs, session);
      run.recoveryRunIds = recovery.ids;
      this.store.conversations.transaction(() => {
        if (!this.store.conversations.page(id, undefined, 1).messages.length)
          this.store.conversations.updateSession(id, {
            title: prompt.slice(0, 44),
          });
        this.store.conversations.append(
          id,
          {
            createdAt: new Date().toISOString(),
            id: userId,
            runId,
            workContextId: session.workContextId,
            role: "user",
            content: prompt,
            status: "pending",
          },
          session.workContextId,
        );
      });
      controller.signal.throwIfAborted();
      emit({ type: "activity", text: "Apsis 正在處理任務。" });
      if (grants.shell && !findBash())
        emit({ type: "activity", text: shellMissing });
      const result = await this.runner({
        ...extensions,
        memoryKey: location.memoryKey,
        historyContextId: session.workContextId,
        prompt,
        session,
        store: this.store,
        workspace,
        executionContext: `Current task work location: ${JSON.stringify(location)}. Memory writes belong to ${JSON.stringify(location.memoryKey)}; only user-promoted Bot preferences cross tasks. All relative file tools and shell start in ${JSON.stringify(workspace.root)}. ${shellContext(workspace.root)} A work directory is not an OS sandbox. Before reporting completion, distinguish actual tool results, checks performed and remaining unverified work.\n${recovery.context}\n${extensions?.executionContext || ""}`,
        allowWrites,
        emit,
        signal: controller.signal,
        env,
        agent: extensions?.agent,
        permissions: grants,
        source: { sessionId: id, runId, messageId: userId },
        recordOperation: async (operation) => {
          const index = run.operations.findIndex((o) => o.id === operation.id);
          const safe = {
            ...operation,
            error: operation.error
              ? redact(operation.error).slice(0, 16000)
              : undefined,
            target: operation.target ? redact(operation.target) : undefined,
            evidence: operation.evidence
              ? {
                  ...operation.evidence,
                  command:
                    operation.evidence.command === undefined
                      ? undefined
                      : redact(operation.evidence.command),
                  output:
                    operation.evidence.output === undefined
                      ? undefined
                      : redact(operation.evidence.output),
                  patch:
                    operation.evidence.patch === undefined
                      ? undefined
                      : redact(operation.evidence.patch),
                }
              : undefined,
          };
          if (index < 0) {
            run.operations.push(safe);
            run.timeline!.push({
              kind: "operation",
              id: `operation-${operation.id}`,
              operationId: operation.id,
              at: new Date().toISOString(),
            });
          } else run.operations[index] = safe;
          await persist(run);
          emit({ type: "operation" });
        },
      } satisfies RunOptions);
      controller.signal.throwIfAborted();
      await this.runs.flush(run.id);
      if (persistenceError) throw persistenceError;
      controller.signal.throwIfAborted();
      const completed = finishRun(
        { ...run, text: result.text, usage: result.usage },
        "completed",
      );
      await persist(completed);
      controller.signal.throwIfAborted();
      this.store.conversations.transaction(() => {
        const user = this.store.conversations.message(id, userId);
        if (user) {
          this.store.conversations.append(
            id,
            finishUserMessage(user, "complete"),
            session.workContextId,
          );
        }
        this.store.conversations.append(
          id,
          {
            createdAt: new Date().toISOString(),
            id: randomUUID(),
            role: "assistant",
            content: result.text,
            runId,
            workContextId: session.workContextId,
            status: "complete",
            activity: live.activity,
          },
          session.workContextId,
        );
        if (result.engineState !== undefined)
          this.store.conversations.saveCheckpoint(
            id,
            session.workContextId!,
            result.engineState,
          );
      });
      Object.assign(run, completed);
      emit({ type: "done" });
      return result.text;
    } catch (caught) {
      let message = persistenceError
        ? persistenceError.message
        : controller.signal.aborted
          ? timedOut
            ? "任務超過執行時間上限，已停止。"
            : "已停止執行。"
          : asError(caught).message;
      for (const key of [
        env.OPENAI_API_KEY,
        env.COMPATIBLE_API_KEY,
        env.ANTHROPIC_API_KEY,
      ].filter((v): v is string => !!v))
        message = message.replaceAll(key, "[redacted]");
      this.store.conversations.transaction(() => {
        const user = this.store.conversations.message(id, userId);
        if (user) {
          this.store.conversations.append(
            id,
            finishUserMessage(user, "failed"),
            session.workContextId,
          );
        }
        this.store.conversations.append(
          id,
          {
            id: randomUUID(),
            role: "assistant",
            content: live.text ? live.text + "\n\n" + message : message,
            runId,
            workContextId: session.workContextId,
            status: "error",
            activity: live.activity,
          },
          session.workContextId,
        );
      });
      emit({ type: "error", text: message });
      Object.assign(
        run,
        finishRun(
          run,
          controller.signal.aborted && !timedOut && !persistenceError
            ? "cancelled"
            : "failed",
          message,
        ),
      );
      await this.runs.save(run);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.running.delete(id);
    }
  }
}
