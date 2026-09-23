import { randomUUID } from "node:crypto";
import { runAgent, type RunOptions } from "./agent.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
import type { Settings } from "./settings.ts";
import type {
  Mode,
  RunEvent,
  Session,
  SessionView,
  AgentDefinition,
  ConnectionSelection,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { RunStore } from "./runs.ts";
import type { Connections } from "./connections.ts";
import type { RunPermissions, TaskRun } from "../shared/types.ts";

export type AgentRunner = typeof runAgent;
export class TaskService {
  store: Store;
  workspace: Workspace;
  settings: Settings;
  runner: AgentRunner;
  runs: RunStore;
  connections?: Connections;
  running = new Map<
    string,
    {
      controller: AbortController;
      text: string;
      activity: string[];
      runId: string;
    }
  >();
  constructor(
    store: Store,
    workspace: Workspace,
    settings: Settings,
    runner: AgentRunner = runAgent,
  ) {
    this.store = store;
    this.workspace = workspace;
    this.settings = settings;
    this.runner = runner;
    this.runs = new RunStore(store.directory);
  }
  async create(
    mode: Mode = "pi",
    source: Session["source"] = "web",
    agent?: AgentDefinition,
    selection?: ConnectionSelection,
  ) {
    const selected =
      mode === "pi" && !agent
        ? selection || this.connections?.defaultSelection()
        : undefined;
    const resolved = selected
      ? this.connections?.selection(selected.connectionId, selected.model)
      : undefined;
    const provider = resolved
      ? this.connections?.view().find((row) => row.id === resolved.connectionId)
          ?.provider
      : undefined;
    const session: Session = {
      id: randomUUID(),
      title: "新的對話",
      mode,
      source,
      createdAt: new Date().toISOString(),
      messages: [],
      piMessages: [],
      ...(agent ? { agent: structuredClone(agent) } : {}),
      ...(resolved ? { ...resolved, provider } : {}),
    };
    await this.store.mutate((s) => s.sessions.unshift(session));
    return session;
  }
  view(id: string): SessionView {
    const session = this.store.state.sessions.find((s) => s.id === id);
    if (!session)
      throw Object.assign(new Error("找不到工作階段。"), { status: 404 });
    const { piMessages, engineState, runtimeState, ...view } = session;
    const live = this.running.get(id);
    return {
      ...view,
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
  async start(id: string, prompt: string, permissions: RunPermissions) {
    if (this.running.has(id))
      throw Object.assign(new Error("此對話正在執行，請等待完成或停止。"), {
        status: 409,
      });
    const completion = this.run(
      id,
      prompt,
      false,
      () => {},
      undefined,
      permissions,
    );
    void completion.catch(() => {});
    const live = this.running.get(id);
    if (!live) {
      await completion;
      throw new Error("任務未能啟動。");
    }
    await this.runs.flush(live.runId);
    return this.runs.records.get(live.runId)!;
  }
  async run(
    id: string,
    prompt: string,
    allowWrites: boolean,
    onEvent: (event: RunEvent) => void = () => {},
    signal?: AbortSignal,
    permissions?: RunPermissions,
  ) {
    const session = structuredClone(
      this.store.state.sessions.find((s) => s.id === id),
    );
    if (!session)
      throw Object.assign(new Error("找不到工作階段。"), { status: 404 });
    if (this.running.has(id))
      throw Object.assign(new Error("此對話正在執行，請等待完成或停止。"), {
        status: 409,
      });
    if (!prompt.trim() || prompt.length > 16000)
      throw Object.assign(new Error("訊息需為 1–16000 字。"), { status: 400 });
    const controller = new AbortController();
    const runId = randomUUID();
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
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, 300000);
    let env = this.settings.environment();
    if (session.agent) {
      env.PI_PROVIDER = session.agent.provider;
      env.PI_MODEL = session.agent.model;
    }
    const userId = randomUUID();
    const run: TaskRun = {
      id: runId,
      sessionId: id,
      engine: session.mode === "demo" ? "demo" : session.agent?.engine || "pi",
      agentName: session.agent?.name || "Apsis",
      connectionId: session.agent?.connectionId || session.connectionId,
      model: session.agent?.model || session.model || env.PI_MODEL || "",
      permissions: grants,
      status: "running",
      createdAt: new Date().toISOString(),
      text: "",
      activity: live.activity,
      operations: [],
    };
    // Queue the initial durable record synchronously, before returning a task ID.
    const initialSave = this.runs.save(run);
    const redact = (value: string) =>
      [env.OPENAI_API_KEY, env.COMPATIBLE_API_KEY, env.ANTHROPIC_API_KEY]
        .filter((v): v is string => !!v)
        .reduce((text, key) => text.replaceAll(key, "[redacted]"), value);
    const emit = (event: RunEvent) => {
      if (event.type === "delta") live.text += event.text;
      if (event.type === "activity") live.activity.push(event.text);
      run.text = live.text;
      try {
        onEvent(event);
      } catch {
        /* A subscriber cannot terminate a server-owned task. */
      }
    };
    try {
      await initialSave;
      if (session.agent?.connectionId) {
        if (!this.connections) throw new Error("模型連線服務尚未初始化。");
        env = this.connections.environment(
          session.agent.connectionId,
          session.agent.model,
        );
        if (env.PI_PROVIDER !== session.agent.provider)
          throw new Error("連線供應商已變更，請編輯 agent 並建立新對話。");
        run.model = env.PI_MODEL || "";
      } else if (session.connectionId) {
        if (!this.connections) throw new Error("模型連線服務尚未初始化。");
        env = this.connections.environment(session.connectionId, session.model);
        if (session.provider && env.PI_PROVIDER !== session.provider)
          throw new Error("連線供應商已變更，請建立新對話。");
        run.model = env.PI_MODEL || "";
      }
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        if (!row.messages.length) row.title = prompt.slice(0, 44);
        row.messages.push({
          id: userId,
          runId,
          role: "user",
          content: prompt,
          status: "pending",
        });
      });
      controller.signal.throwIfAborted();
      emit({ type: "activity", text: "Apsis 正在處理任務。" });
      const result = await this.runner({
        mode: session.mode,
        prompt,
        session,
        store: this.store,
        workspace: this.workspace,
        allowWrites,
        emit,
        signal: controller.signal,
        env,
        agent: session.agent,
        permissions: grants,
        source: { sessionId: id, runId },
        recordOperation: async (operation) => {
          const index = run.operations.findIndex((o) => o.id === operation.id);
          const safe = {
            ...operation,
            error: operation.error ? redact(operation.error) : undefined,
          };
          if (index < 0) run.operations.push(safe);
          else run.operations[index] = safe;
          await this.runs.save(run);
        },
      } satisfies RunOptions);
      controller.signal.throwIfAborted();
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        row.messages.find((m) => m.id === userId)!.status = "complete";
        row.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: result.text,
          runId,
          status: "complete",
          activity: live.activity,
        });
        if (result.runtimeState) {
          row.runtimeState = result.runtimeState;
          row.piMessages = [];
          delete row.engineState;
        } else {
          if (result.piMessages) row.piMessages = result.piMessages;
          if (result.engineState !== undefined)
            row.engineState = result.engineState;
        }
      });
      run.text = result.text;
      run.status = "completed";
      run.endedAt = new Date().toISOString();
      run.usage = result.usage;
      await this.runs.save(run);
      emit({ type: "done" });
      return result.text;
    } catch (caught) {
      let message = controller.signal.aborted
        ? timedOut
          ? "任務超過五分鐘，已停止。"
          : "已停止執行。"
        : asError(caught).message;
      for (const key of [
        env.OPENAI_API_KEY,
        env.COMPATIBLE_API_KEY,
        env.ANTHROPIC_API_KEY,
      ].filter((v): v is string => !!v))
        message = message.replaceAll(key, "[redacted]");
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        const user = row.messages.find((m) => m.id === userId);
        if (user) user.status = "failed";
        row.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: live.text ? live.text + "\n\n" + message : message,
          runId,
          status: "error",
          activity: live.activity,
        });
      });
      emit({ type: "error", text: message });
      run.status =
        controller.signal.aborted && !timedOut ? "cancelled" : "failed";
      run.error = message;
      run.endedAt = new Date().toISOString();
      await this.runs.save(run);
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.running.delete(id);
    }
  }
}
