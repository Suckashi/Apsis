import { randomUUID } from "node:crypto";
import { runAgent, type RunOptions } from "./agent.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
import type { Settings } from "./settings.ts";
import type { Mode, RunEvent, Session, SessionView } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";

export type AgentRunner = typeof runAgent;
export class TaskService {
  store: Store;
  workspace: Workspace;
  settings: Settings;
  runner: AgentRunner;
  running = new Map<
    string,
    { controller: AbortController; text: string; activity: string[] }
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
  }
  async create(mode: Mode = "pi", source: Session["source"] = "web") {
    const session: Session = {
      id: randomUUID(),
      title: "新的對話",
      mode,
      source,
      createdAt: new Date().toISOString(),
      messages: [],
      piMessages: [],
    };
    await this.store.mutate((s) => s.sessions.unshift(session));
    return session;
  }
  view(id: string): SessionView {
    const session = this.store.state.sessions.find((s) => s.id === id);
    if (!session)
      throw Object.assign(new Error("找不到工作階段。"), { status: 404 });
    const { piMessages, ...view } = session;
    const live = this.running.get(id);
    return {
      ...view,
      running: !!live,
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
    const live = { controller, text: "", activity: [] as string[] };
    this.running.set(id, live);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 300000);
    const env = this.settings.environment();
    const userId = randomUUID();
    const emit = (event: RunEvent) => {
      if (event.type === "delta") live.text += event.text;
      if (event.type === "activity") live.activity.push(event.text);
      onEvent(event);
    };
    try {
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        if (!row.messages.length) row.title = prompt.slice(0, 44);
        row.messages.push({
          id: userId,
          role: "user",
          content: prompt,
          status: "pending",
        });
      });
      controller.signal.throwIfAborted();
      emit({ type: "activity", text: "Talaria 正在處理任務。" });
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
      } satisfies RunOptions);
      controller.signal.throwIfAborted();
      await this.store.mutate((s) => {
        const row = s.sessions.find((x) => x.id === id)!;
        row.messages.find((m) => m.id === userId)!.status = "complete";
        row.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: result.text,
          status: "complete",
          activity: live.activity,
        });
        if (result.piMessages) row.piMessages = result.piMessages;
      });
      emit({ type: "done" });
      return result.text;
    } catch (caught) {
      let message = controller.signal.aborted
        ? "已停止執行。"
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
          status: "error",
          activity: live.activity,
        });
      });
      emit({ type: "error", text: message });
      throw new Error(message);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.running.delete(id);
    }
  }
}
