import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from "@langchain/core/messages";

export interface DeepValue {
  messages: BaseMessage[];
  todos?: {
    content: string;
    status: "pending" | "in_progress" | "completed";
  }[];
  _summarizationSessionId?: string;
  _summarizationEvent?: {
    cutoffIndex: number;
    summaryMessage: BaseMessage;
    filePath: string | null;
  };
}
export interface ContextCheckpoint {
  version: 1;
  engine: "deepagents@1.14.0";
  messages: StoredMessage[];
  todos?: DeepValue["todos"];
}
export function effectiveMessages(value: DeepValue): BaseMessage[] {
  const event = value._summarizationEvent;
  if (!event) return value.messages;
  if (
    !Number.isInteger(event.cutoffIndex) ||
    event.cutoffIndex < 0 ||
    event.cutoffIndex > value.messages.length
  )
    throw new Error("無法還原摘要邊界，已保留原始紀錄。");
  return [event.summaryMessage, ...value.messages.slice(event.cutoffIndex)];
}
export function completeToolPairs(messages: BaseMessage[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.type === "ai" && "tool_calls" in message)
      for (const call of (message.tool_calls || []) as { id?: string }[]) {
        if (!call.id) return false;
        pending.add(call.id);
      }
    if (message.type === "tool" && "tool_call_id" in message) {
      if (!pending.delete(String(message.tool_call_id))) return false;
    }
  }
  return pending.size === 0;
}
export function checkpoint(value: DeepValue): ContextCheckpoint | undefined {
  const messages = effectiveMessages(value);
  if (!completeToolPairs(messages)) return undefined;
  return {
    version: 1,
    engine: "deepagents@1.14.0",
    messages: mapChatMessagesToStoredMessages(messages),
    todos: value.todos,
  };
}
export function restoreCheckpoint(value: unknown): DeepValue | undefined {
  if (!value) return undefined;
  const saved = value as ContextCheckpoint;
  if (saved.version === 1 && saved.engine !== "deepagents@1.14.0")
    throw new Error("不支援的 checkpoint 引擎版本。");
  if (saved.version !== undefined && saved.version !== 1)
    throw new Error("不支援的 context checkpoint 版本。");
  if (!Array.isArray(saved.messages))
    throw new Error("Context checkpoint 格式錯誤。");
  // Legacy messages are retained intact. New checkpoints already contain the
  // summary, so a previous cutoff must never be applied again.
  return {
    messages: mapStoredMessagesToChatMessages(saved.messages),
    todos: saved.todos,
  };
}
