import { randomUUID } from "node:crypto";
import { rejectLegacyCodex, runAgent } from "./agent.ts";
import type { RunOptions } from "./runtime.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
import type {
  Mode,
  RunEvent,
  Session,
  SessionView,
  AgentDefinition,
  Environment,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { RunStore } from "./runs.ts";
import type { Connections } from "./connections.ts";
import type { RunPermissions, TaskRun } from "../shared/types.ts";
import { Projects } from "./projects.ts";
import { findBash, shellContext, shellMissing } from "./shell.ts";
import { recoveryContext } from "./recovery.ts";

export type AgentRunner = typeof runAgent;
export class TaskService {
  store: Store;
  workspace: Workspace;
  runner: AgentRunner;
  runs: RunStore;
  connections?: Connections;
  projects: Projects;
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
    this.runs = new RunStore(store.directory);
    this.projects = new Projects(store, workspace);
  }
  async create(
    mode: Mode = "deepagents",
    source: Session["source"] = "web",
    agent?: AgentDefinition,
    projectId?: string,
  ) {
    const session: Session = {
      project: this.projects.get(projectId),
      id: randomUUID(),
      title: "新的對話",
      mode,
      source,
      createdAt: new Date().toISOString(),
      messages: [],
      ...(agent ? { agent: structuredClone(agent) } : {}),
    };
    await this.store.mutate((s) => s.sessions.unshift(session));
    return session;
  }
  view(id: string): SessionView {
    const session = this.store.state.sessions.find((s) => s.id === id);
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
    const extensions = this.extensions?.(session, runId);
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
    let env: Environment = {};
    const userId = randomUUID();
    const run: TaskRun = {
      workContextId: session.workContextId,
      project: session.project || this.projects.get(),
      id: runId,
      sessionId: id,
      engine: session.agent?.provider === "codex" ? "codex" : "deepagents",
      agentName: session.agent?.name || "Apsis",
      connectionId: session.agent?.connectionId || session.connectionId,
      model: session.agent?.model || session.model || "",
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
      if ("text" in event && typeof event.text === "string")
        event = { ...event, text: redact(event.text) };
      if (event.type === "delta") live.text += event.text;
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
      try {
        onEvent(event);
      } catch {
        /* A subscriber cannot terminate a server-owned task. */
      }
    };
    try {
      await initialSave;
      rejectLegacyCodex({ session });
      const workspace = await this.projects.workspace(session);
      const recovery = recoveryContext(this.runs, session);
      run.recoveryRunIds = recovery.ids;
      if (session.agent?.connectionId) {
        if (!this.connections) throw new Error("模型連線服務尚未初始化。");
        env = this.connections.environment(
          session.agent.connectionId,
          session.agent.model,
        );
        if (env.MODEL_PROVIDER !== session.agent.provider)
          throw new Error("連線供應商已變更，請編輯 agent 並建立新對話。");
        run.model = env.MODEL_ID || "";
      } else if (session.connectionId) {
        if (!this.connections) throw new Error("模型連線服務尚未初始化。");
        env = this.connections.environment(session.connectionId, session.model);
        if (session.provider && env.MODEL_PROVIDER !== session.provider)
          throw new Error("連線供應商已變更，請建立新對話。");
        run.model = env.MODEL_ID || "";
      }
      rejectLegacyCodex({ session, env });
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        if (!row.messages.length) row.title = prompt.slice(0, 44);
        row.messages.push({
          createdAt: new Date().toISOString(),
          id: userId,
          runId,
          workContextId: session.workContextId,
          role: "user",
          content: prompt,
          status: "pending",
        });
      });
      controller.signal.throwIfAborted();
      emit({ type: "activity", text: "Apsis 正在處理任務。" });
      if (grants.shell && !findBash())
        emit({ type: "activity", text: shellMissing });
      const result = await this.runner({
        ...extensions,
        mode: session.mode,
        prompt,
        session,
        store: this.store,
        workspace,
        executionContext: `Current project: ${JSON.stringify(run.project)}. All relative file tools and shell start in ${JSON.stringify(workspace.root)}. ${shellContext(workspace.root)} A project directory is not an OS sandbox. Before reporting completion, distinguish actual tool results, checks performed and remaining unverified work.\n${recovery.context}\n${extensions?.executionContext || ""}`,
        allowWrites,
        emit,
        signal: controller.signal,
        env,
        agent: session.agent,
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
          if (index < 0) run.operations.push(safe);
          else run.operations[index] = safe;
          await this.runs.save(run);
          emit({ type: "operation" });
        },
      } satisfies RunOptions);
      controller.signal.throwIfAborted();
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        const user =
          row.messages.find((m) => m.id === userId) ||
          this.store.conversations.message(id, userId);
        if (user) {
          user.status = "complete";
          this.store.conversations.append(id, user, session.workContextId);
        }
        row.messages.push({
          createdAt: new Date().toISOString(),
          id: randomUUID(),
          role: "assistant",
          content: result.text,
          runId,
          workContextId: session.workContextId,
          status: "complete",
          activity: live.activity,
        });
        if (result.engineState !== undefined)
          this.store.conversations.saveCheckpoint(
            id,
            session.workContextId!,
            result.engineState,
          );
      });
      run.text = result.text;
      run.status = "completed";
      for (const operation of run.operations) {
        if (operation.status === "started") {
          operation.status = "unknown";
          operation.endedAt = new Date().toISOString();
        }
      }
      run.endedAt = new Date().toISOString();
      run.usage = result.usage;
      await this.runs.save(run);
      emit({ type: "done" });
      return result.text;
    } catch (caught) {
      let message = controller.signal.aborted
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
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        const user =
          row.messages.find((m) => m.id === userId) ||
          this.store.conversations.message(id, userId);
        if (user) {
          user.status = "failed";
          this.store.conversations.append(id, user, session.workContextId);
        }
        row.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: live.text ? live.text + "\n\n" + message : message,
          runId,
          workContextId: session.workContextId,
          status: "error",
          activity: live.activity,
        });
      });
      emit({ type: "error", text: message });
      run.status =
        controller.signal.aborted && !timedOut ? "cancelled" : "failed";
      for (const operation of run.operations) {
        if (operation.status === "started") {
          operation.status = "unknown";
          operation.endedAt = new Date().toISOString();
        }
      }
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
