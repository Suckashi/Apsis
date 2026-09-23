import { createTools } from "./tools.ts";
import type { ToolOptions, RunOptions } from "./runtime.ts";
export { createTools } from "./tools.ts";
export { agentContext } from "./context.ts";
export type { RunOptions, ToolOptions } from "./runtime.ts";
import { ollamaProvider, defaultOllamaUrl } from "./ollama.ts";
import { compatibleProvider } from "./compatible.ts";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

import type { Session, RunResult, RunEvent } from "../shared/types.ts";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  ModelRuntime,
  createExtensionRuntime,
  type ResourceLoader,
  type FileEntry,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

import { setTimeout as delay } from "node:timers/promises";
import { agentContext } from "./context.ts";

import { configuration } from "./configuration.ts";
export { configuration } from "./configuration.ts";

export interface PiOptions extends ToolOptions {
  prompt: string;
  session: { piMessages?: AgentMessage[]; engineState?: unknown };
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  runtime?: { model: Model<Api>; streamFn: StreamFn };
}

export async function runPi({
  prompt,
  session,
  store,
  workspace,
  allowWrites,
  emit,
  signal,
  env = process.env,
  runtime,
  agent: profile,
  permissions,
  source,
  recordOperation,
  probe,
  executionContext,
  extraTools,
  authorize,
  registerSteer,
  maxTurns = 12,
}: PiOptions): Promise<RunResult> {
  const config = configuration(env);
  const models = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  let model: Model<Api> | undefined;
  let streamFn: StreamFn;
  if (runtime) ({ model, streamFn } = runtime);
  else {
    if (!config.piReady)
      throw new Error("Pi 尚未設定。請前往「連線設定」儲存 API key。");
    models.registerNativeProvider(
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
  const context = agentContext(
    store,
    allowWrites,
    profile,
    prompt,
    permissions,
    executionContext,
  );
  const usage = { inputTokens: 0, outputTokens: 0 };
  let turns = 0;
  const apiKey =
    config.provider === "ollama"
      ? "ollama"
      : config.provider === "openai-compatible"
        ? env.COMPATIBLE_API_KEY || "not-required"
        : config.provider === "anthropic"
          ? env.ANTHROPIC_API_KEY
          : env.OPENAI_API_KEY;
  if (apiKey) await models.setRuntimeApiKey(model.provider, apiKey);
  const saved = session.engineState as
    | { kind?: string; entries?: FileEntry[] }
    | undefined;
  const entries =
    saved?.kind === "pi-coding-agent" && Array.isArray(saved.entries)
      ? saved.entries
      : undefined;
  const manager = SessionManager.inMemory(workspace.root, undefined, entries);
  if (!entries)
    for (const message of session.piMessages || []) {
      if (
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult"
      )
        manager.appendMessage(message);
    }
  const extensionRuntime = createExtensionRuntime();
  const resources: ResourceLoader = {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: extensionRuntime,
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => context,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources() {},
    async reload() {},
  };
  const customTools = createTools({
    store,
    workspace,
    allowWrites,
    agent: profile,
    permissions,
    source,
    recordOperation,
    probe,
    extraTools,
    authorize,
  });
  const { session: coding } = await createAgentSession({
    cwd: workspace.root,
    modelRuntime: models,
    model,
    thinkingLevel: "off",
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: !runtime },
      retry: { enabled: false },
      cacheWarming: "off",
    }),
    resourceLoader: resources,
    tools: customTools.map((tool) => tool.name),
    customTools,
  });
  const agent = coding.agent;
  registerSteer?.((text) => coding.steer(text));
  if (runtime) {
    models.hasConfiguredAuth = () => true;
    agent.streamFunction = (model, context, options) =>
      streamFn(model, context, { ...options, apiKey });
  }
  agent.toolExecution = "sequential";
  agent.finishTurn = () => {
    if (++turns >= maxTurns) {
      emit({ type: "activity", text: `已達單次 ${maxTurns} 回合上限。` });
      return { action: "end" };
    }
  };
  let text = "";
  coding.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      usage.inputTokens +=
        event.message.usage.input +
        event.message.usage.cacheRead +
        event.message.usage.cacheWrite;
      usage.outputTokens += event.message.usage.output;
    }
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
  const abort = () => {
    void coding.abort();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    await coding.prompt(prompt, { expandPromptTemplates: false });
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
      usage,
      piMessages: agent.state.messages.filter((m) => m.role !== "system"),
      engineState: {
        kind: "pi-coding-agent",
        entries: [manager.getHeader()!, ...manager.getEntries()],
      },
    };
  } finally {
    signal.removeEventListener("abort", abort);
    coding.dispose();
  }
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const { mode, prompt, emit, signal } = options;
  if (mode === "demo") {
    emit({
      type: "activity",
      text: "示範流程：讀取本機記憶與技能（未呼叫 AI）",
    });
    const text = `這是本機示範回覆，不是真實 AI 生成。\n\n你提出的任務：${prompt}\n\n## 我們可以一起做的事\n\n- 閱讀工作區檔案，理解你的專案。\n- 保存重要偏好與可重用的技能，讓下次對話接得上。\n- 在 Web 或已配對的 Telegram Bot 交辦任務。\n\n到「Bot 設定」連接模型，再從「任務選項」選擇 Apsis，就能開始真實對話。需要修改檔案或保存記憶時，請先開啟「對應的檔案／記憶／技能寫入權限」。`;
    for (const chunk of text.match(/.{1,14}|\n/gu) || []) {
      signal.throwIfAborted();
      emit({ type: "delta", text: chunk });
      await delay(15, undefined, { signal });
    }
    return { text };
  }
  if (mode !== "pi") throw new Error("不支援的回覆模式。");
  const engine = options.agent?.engine || "pi";
  if (options.session.runtimeState) {
    if (options.session.runtimeState.engine !== engine)
      throw new Error("對話引擎與保存狀態不符，請建立新對話。");
    if (engine === "pi" && Array.isArray(options.session.runtimeState.data))
      options.session.piMessages = options.session.runtimeState
        .data as Session["piMessages"];
    else options.session.engineState = options.session.runtimeState.data;
  }
  const adapter = (await import("./engines/index.ts")).engines[engine];
  const result = await adapter.run(options);
  return {
    ...result,
    runtimeState: {
      engine,
      version: 1,
      data: result.engineState ?? result.piMessages,
    },
  };
}
