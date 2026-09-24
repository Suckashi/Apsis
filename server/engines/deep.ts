import { createDeepAgent, StateBackend, type FileData } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  AIMessage,
  mapStoredMessagesToChatMessages,
  mapChatMessagesToStoredMessages,
  type BaseMessage,
  type StoredMessage,
} from "@langchain/core/messages";
import { agentContext } from "../context.ts";
import { createTools } from "../tools.ts";
import type { RunOptions } from "../runtime.ts";
import { connection, executeTool, toolSchema } from "./common.ts";

interface DeepState {
  messages: StoredMessage[];
  files?: Record<string, FileData>;
  todos?: {
    content: string;
    status: "pending" | "in_progress" | "completed";
  }[];
}
export async function runDeep(options: RunOptions) {
  const config = connection(options);
  const model =
    config.provider === "anthropic"
      ? new ChatAnthropic({
          model: config.model,
          apiKey: config.apiKey,
          maxTokens: 4096,
          maxRetries: 0,
        })
      : new ChatOpenAI({
          model: config.model,
          apiKey: config.apiKey,
          configuration: { baseURL: config.baseURL },
          useResponsesApi: false,
          maxTokens: 4096,
          maxRetries: 0,
          streamUsage: false,
          ...(config.provider === "ollama"
            ? { modelKwargs: { reasoning_effort: "none" } }
            : {}),
        });
  // Built-in Deep Agents filesystem tools operate only on conversation state.
  // Real workspace tools have distinct names and keep Apsis's permission checks.
  const tools = createTools(options).map((t) =>
    tool(
      async (args) => {
        try {
          return await executeTool(t, args as Record<string, unknown>, options);
        } catch (error) {
          options.signal.throwIfAborted();
          return `Tool failed: ${(error as Error).message}`;
        }
      },
      {
        name: ["read_file", "write_file", "edit_file", "list_files"].includes(
          t.name,
        )
          ? "workspace_" + t.name
          : t.name,
        description: t.description,
        schema: toolSchema(t),
      },
    ),
  );
  const agent = createDeepAgent({
    model,
    tools,
    backend: (config) => new StateBackend(config),
    systemPrompt:
      agentContext(
        options.store,
        options.allowWrites,
        options.agent,
        options.prompt,
        options.permissions,
        options.executionContext,
      ) +
      "\nDeep Agents filesystem tools use private virtual scratch files, NOT the user's workspace. workspace_* tools access real workspace files; use these when the user asks about their files. The separately granted shell tool executes on the host. Never claim scratch writes modified the workspace. Long-term memory is managed only by Apsis remember/update_memory tools.",
  });
  const previous = options.session.engineState as DeepState | undefined;
  const previousMessages = previous
    ? mapStoredMessagesToChatMessages(previous.messages)
    : options.session.messages
        .filter((message) => message.status === "complete")
        .slice(-12)
        .map((message) =>
          message.role === "user"
            ? new HumanMessage(message.content.slice(0, 16000))
            : new AIMessage(message.content.slice(0, 16000)),
        );
  const steers: string[] = [];
  options.registerSteer?.(async (instruction) => {
    steers.push(instruction);
  });
  let input = {
    messages: [...previousMessages, new HumanMessage(options.prompt)],
    ...(previous?.files ? { files: previous.files } : {}),
    ...(previous?.todos ? { todos: previous.todos } : {}),
  };
  let final:
    | {
        messages: BaseMessage[];
        files?: Record<string, FileData>;
        todos?: DeepState["todos"];
      }
    | undefined;
  let text = "";
  const seenTools = new Set<string>();
  for (const message of previousMessages) {
    if ("tool_calls" in message && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls)
        if (call.id) seenTools.add(call.id);
    }
  }
  for (;;) {
    final = undefined;
    const stream = await agent.stream(input, {
      streamMode: ["messages", "values"],
      signal: options.signal,
      recursionLimit: Math.min(200, Math.max(48, options.maxTurns || 48)),
    });
    for await (const [kind, value] of stream) {
      options.signal.throwIfAborted();
      if (kind === "messages") {
        const [message] = value;
        if (message.type === "ai") {
          const delta =
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("");
          if (delta) {
            text += delta;
            options.emit({ type: "delta", text: delta });
          }
        }
      } else if (kind === "values") {
        final = value;
        for (const m of value.messages) {
          if ("tool_calls" in m && Array.isArray(m.tool_calls))
            for (const call of m.tool_calls) {
              if (call.id && !seenTools.has(call.id)) {
                seenTools.add(call.id);
                options.emit({
                  type: "activity",
                  tool: call.name,
                  text: `規劃工具 ${call.name}`,
                });
              }
            }
        }
      }
    }
    if (!final) throw new Error("Deep Agents 未回傳執行結果。");
    if (!steers.length) break;
    const instruction = steers.splice(0).join("\n");
    input = {
      messages: [...final.messages, new HumanMessage(instruction)],
      ...(final.files ? { files: final.files } : {}),
      ...(final.todos ? { todos: final.todos } : {}),
    };
  }
  if (!text) {
    const last = final.messages.findLast((m) => m.type === "ai");
    text =
      typeof last?.content === "string"
        ? last.content
        : Array.isArray(last?.content)
          ? last.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
          : "";
    if (!text.trim())
      throw new Error("模型未回傳文字結果；請檢查操作紀錄並更換模型或重試。");
    options.emit({ type: "delta", text });
  }
  const previousIds = new Set(
    previousMessages.map((m) => m.id).filter(Boolean),
  );
  const usage = { inputTokens: 0, outputTokens: 0 };
  let hasUsage = false;
  for (const message of final.messages) {
    if (message.id && previousIds.has(message.id)) continue;
    if ("usage_metadata" in message && message.usage_metadata) {
      const data = message.usage_metadata as {
        input_tokens: number;
        output_tokens: number;
      };
      if (
        Number.isFinite(data.input_tokens) &&
        Number.isFinite(data.output_tokens)
      ) {
        hasUsage = true;
        usage.inputTokens += data.input_tokens;
        usage.outputTokens += data.output_tokens;
      }
    }
  }
  return {
    text,
    ...(hasUsage ? { usage } : {}),
    engineState: {
      messages: mapChatMessagesToStoredMessages(final.messages),
      files: final.files,
      todos: final.todos,
    },
  };
}
