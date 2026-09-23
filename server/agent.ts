import { ollamaProvider, defaultOllamaUrl } from "./ollama.ts";
import { compatibleProvider } from "./compatible.ts";
import type {
  AgentMessage,
  AgentTool,
  AgentToolResult,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type {
  Environment,
  Status,
  Session,
  RunEvent,
  RunResult,
} from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { Workspace } from "./workspace.ts";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { askHermes } from "./hermes.ts";
import { buildContext, skillIndex } from "./context.ts";

type ToolHandler = (
  args: Record<string, string>,
  signal?: AbortSignal,
) => unknown | Promise<unknown>;
const schema = (properties: string[]) =>
  Type.Object(
    Object.fromEntries(properties.map((name) => [name, Type.String()])),
    { additionalProperties: false },
  );
const result = (value: unknown): AgentToolResult => ({
  content: [
    {
      type: "text",
      text:
        typeof value === "string" ? value : (JSON.stringify(value) ?? "null"),
    },
  ],
  details: {},
});
const tool = (
  name: string,
  description: string,
  fields: string[],
  run: ToolHandler,
): AgentTool => ({
  name,
  label: name,
  description,
  parameters: schema(fields),
  execute: async (_id, args, signal) =>
    result(await run(args as Record<string, string>, signal)),
});

export function configuration(env: Environment = process.env): Status {
  const provider = env.PI_PROVIDER || "openai";
  const model =
    env.PI_MODEL ||
    (provider === "ollama"
      ? "qwen3.5:9b"
      : provider === "anthropic"
        ? "claude-sonnet-4-6"
        : provider === "openai-compatible"
          ? ""
          : "gpt-4.1-mini");
  return {
    provider,
    model,
    piReady: Boolean(
      provider === "ollama"
        ? true
        : provider === "openai-compatible"
          ? env.COMPATIBLE_BASE_URL && env.PI_MODEL
          : provider === "anthropic"
            ? env.ANTHROPIC_API_KEY
            : provider === "openai" && env.OPENAI_API_KEY,
    ),
    hermesReady: Boolean(env.HERMES_URL && env.HERMES_API_KEY),
  };
}

export interface ToolOptions {
  store: Store;
  workspace: Workspace;
  allowWrites: boolean;
  hybrid?: boolean;
  env?: Environment;
}
export interface PiOptions extends ToolOptions {
  prompt: string;
  session: { piMessages?: AgentMessage[] };
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  runtime?: { model: Model<Api>; streamFn: StreamFn };
}
export interface RunOptions extends PiOptions {
  mode: Session["mode"];
  session: Session;
}

export function createTools({
  store,
  workspace,
  allowWrites,
  hybrid,
  env = process.env,
}: ToolOptions) {
  const writable =
    (fn: ToolHandler): ToolHandler =>
    async (...args) => {
      if (!allowWrites) throw new Error("使用者尚未開啟「允許修改」。");
      return fn(...args);
    };
  const tools = [
    tool(
      "list_skills",
      "List reusable skill names, IDs and brief descriptions. Pass a query or empty string to list all.",
      ["query"],
      (a) =>
        skillIndex(store.state)
          .filter((s) =>
            (s.name + " " + s.description)
              .toLocaleLowerCase()
              .includes(a.query.toLocaleLowerCase()),
          )
          .slice(0, 100),
    ),
    tool(
      "read_skill",
      "Load the complete procedure for a skill ID from list_skills.",
      ["id"],
      (a) => {
        const skill = store.state.skills.find((s) => s.id === a.id);
        if (!skill) throw new Error("找不到技能。");
        return skill;
      },
    ),
    tool(
      "search_history",
      "Find matching completed messages in the owner's past Web and bot conversations. Query must be at least two characters.",
      ["query"],
      (a) => {
        const query = a.query.trim().toLocaleLowerCase();
        if (query.length < 2 || query.length > 200)
          throw new Error("查詢需為 2–200 字。");
        return store.state.sessions
          .flatMap((s) =>
            s.messages
              .filter(
                (m) =>
                  m.status === "complete" &&
                  m.content.toLocaleLowerCase().includes(query),
              )
              .map((m) => ({
                sessionId: s.id,
                title: s.title,
                role: m.role,
                excerpt: m.content.slice(
                  Math.max(
                    0,
                    m.content.toLocaleLowerCase().indexOf(query) - 160,
                  ),
                  Math.max(
                    0,
                    m.content.toLocaleLowerCase().indexOf(query) - 160,
                  ) + 1000,
                ),
              })),
          )
          .slice(0, 10);
      },
    ),
    tool(
      "update_memory",
      "Replace an outdated memory by ID. Requires write permission. Never store credentials.",
      ["id", "content"],
      writable(async (a) => {
        if (!a.content.trim() || a.content.length > 4000)
          throw new Error("記憶需為 1–4000 字。");
        await store.mutate((s) => {
          const memory = s.memories.find((m) => m.id === a.id);
          if (!memory) throw new Error("找不到記憶。");
          memory.content = a.content;
        });
        return "記憶已更新。";
      }),
    ),
    tool(
      "list_files",
      "List files in the local workspace. Use an empty path for the root.",
      ["path"],
      (a) => workspace.list(a.path),
    ),
    tool("read_file", "Read a UTF-8 file in the workspace.", ["path"], (a) =>
      workspace.read(a.path),
    ),
    tool(
      "write_file",
      "Create or replace a workspace file. Requires user-enabled writes.",
      ["path", "content"],
      writable((a) => workspace.write(a.path, a.content)),
    ),
    tool(
      "remember",
      "Save a useful user preference or durable project fact. Never store credentials.",
      ["content"],
      writable(async (a) => {
        if (!a.content.trim() || a.content.length > 4000)
          throw new Error("記憶長度必須為 1–4000 字。");
        await store.mutate((s) =>
          s.memories.push({
            id: randomUUID(),
            content: a.content,
            createdAt: new Date().toISOString(),
          }),
        );
        return "已儲存記憶。";
      }),
    ),
    tool(
      "save_skill",
      "Save a reusable procedure after a successful task. Never include secrets.",
      ["name", "content"],
      writable(async (a) => {
        if (
          !a.name.trim() ||
          a.name.length > 100 ||
          !a.content.trim() ||
          a.content.length > 12000
        )
          throw new Error("技能名稱或內容長度不符。");
        await store.mutate((s) =>
          s.skills.push({
            id: randomUUID(),
            name: a.name,
            content: a.content,
            createdAt: new Date().toISOString(),
          }),
        );
        return "已儲存技能。";
      }),
    ),
  ];
  if (hybrid)
    tools.push(
      tool(
        "delegate_to_hermes",
        "Delegate a self-contained task to the configured Hermes agent. Hermes may execute tools on its own host. Only delegate when the user permits modifications.",
        ["task"],
        writable((a, signal) =>
          askHermes({
            url: env.HERMES_URL,
            key: env.HERMES_API_KEY,
            model: env.HERMES_MODEL,
            messages: [{ role: "user", content: a.task }],
            signal,
          }),
        ),
      ),
    );
  return tools;
}

export async function runPi({
  prompt,
  session,
  store,
  workspace,
  allowWrites,
  hybrid,
  emit,
  signal,
  env = process.env,
  runtime,
}: PiOptions): Promise<RunResult> {
  const config = configuration(env);
  let models;
  let model: Model<Api> | undefined;
  let streamFn: StreamFn;
  if (runtime) ({ model, streamFn } = runtime);
  else {
    if (!config.piReady)
      throw new Error(
        "Pi 尚未設定。請前往「連線設定」儲存 API key，或選擇示範模式。",
      );
    models = createModels();
    models.setProvider(
      config.provider === "ollama"
        ? ollamaProvider(config.model, env.OLLAMA_URL || defaultOllamaUrl)
        : config.provider === "openai-compatible"
          ? compatibleProvider(
              config.model,
              env.COMPATIBLE_BASE_URL || "",
              env.COMPATIBLE_API_KEY,
            )
          : config.provider === "anthropic"
            ? anthropicProvider()
            : openaiProvider(),
    );
    model = models.getModel(config.provider, config.model);
    if (!model)
      throw new Error(
        `找不到模型 ${config.provider}/${config.model}，請在「連線設定」選擇支援的模型。`,
      );
    streamFn = models.streamSimple.bind(models);
  }
  const context = buildContext(store.state, allowWrites, hybrid);
  let turns = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: context,
      model,
      messages: session.piMessages || [],
      tools: createTools({ store, workspace, allowWrites, hybrid, env }),
    },
    streamFn,
    getApiKey: () =>
      config.provider === "ollama"
        ? "ollama"
        : config.provider === "openai-compatible"
          ? env.COMPATIBLE_API_KEY || "not-required"
          : config.provider === "anthropic"
            ? env.ANTHROPIC_API_KEY
            : env.OPENAI_API_KEY,
    toolExecution: "sequential",
    finishTurn: () => {
      if (++turns >= 12) {
        emit({ type: "activity", text: "已達單次 12 回合上限。" });
        return { action: "end" };
      }
    },
  });
  let text = "";
  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      const delta = event.assistantMessageEvent.delta;
      text += delta;
      emit({ type: "delta", text: delta });
    }
    if (event.type === "tool_execution_start")
      emit({
        type: "activity",
        text: `執行 ${event.toolName}`,
        tool: event.toolName,
      });
    if (event.type === "tool_execution_end")
      emit({
        type: "activity",
        text: `${event.toolName} ${event.isError ? "失敗" : "完成"}`,
        tool: event.toolName,
      });
  });
  const abort = () => agent.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await agent.prompt(prompt);
    if (signal.aborted) throw new Error("已停止執行。");
    const last = agent.state.messages.findLast((m) => m.role === "assistant");
    if (last?.stopReason === "error" || last?.stopReason === "aborted")
      throw new Error(last.errorMessage || "模型執行失敗。");
    if (!text.trim()) {
      text = "此回合已完成工具操作，未產生文字回覆。";
      emit({ type: "delta", text });
    }
    return {
      text,
      piMessages: agent.state.messages.filter((m) => m.role !== "system"),
    };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const { mode, prompt, session, emit, signal, env = process.env } = options;
  if (mode === "demo") {
    emit({
      type: "activity",
      text: "示範流程：讀取本機記憶與技能（未呼叫 AI）",
    });
    const text = `這是本機示範回覆，不是真實 AI 生成。\n\n你提出的任務：${prompt}\n\n## 我們可以一起做的事\n\n- 閱讀工作區檔案，理解你的專案。\n- 保存重要偏好與可重用的技能，讓下次對話接得上。\n- 在 Web 或已配對的 Telegram Bot 交辦任務。\n\n到「Bot 設定」連接模型，再從「任務選項」選擇 Talaria，就能開始真實對話。需要修改檔案或保存記憶時，請先開啟「允許修改與保存」。`;
    for (const chunk of text.match(/.{1,14}|\n/gu) || []) {
      signal.throwIfAborted();
      emit({ type: "delta", text: chunk });
      await delay(15, undefined, { signal });
    }
    return { text };
  }
  if (mode === "hermes") {
    if (!options.allowWrites)
      throw new Error(
        "Hermes 可在遠端執行工具；請先在任務選項開啟「允許修改與保存」。",
      );
    emit({
      type: "activity",
      text: "等待 Hermes gateway 執行；結果將完整回傳。",
    });
    const messages = session.messages
      .filter((m) => m.status === "complete")
      .map((m) => ({ role: m.role, content: m.content }));
    messages.push({ role: "user", content: prompt });
    const text = await askHermes({
      url: env.HERMES_URL,
      key: env.HERMES_API_KEY,
      model: env.HERMES_MODEL,
      messages,
      signal,
    });
    emit({ type: "delta", text });
    return { text };
  }
  if (mode === "hybrid" && !configuration(env).hermesReady)
    throw new Error("協作模式需要先設定 Hermes gateway。");
  return runPi({ ...options, hybrid: mode === "hybrid" });
}
