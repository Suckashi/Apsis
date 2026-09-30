import { randomUUID } from "node:crypto";
import { finishDelivery, finishUserMessage } from "./task-lifecycle.ts";
import type { ConversationStore } from "./conversations.ts";

/** In-memory steering and active model turns cannot survive a process restart. */
export function recoverConversations(conversations: ConversationStore) {
  conversations.transaction(() => {
    // Delivery receipts are separate from message status. A queued supplement
    // cannot survive a process restart because its engine queue was in memory.
    const unapplied = conversations.db
      .prepare(
        "SELECT session_id,context_id,value FROM messages WHERE channel='chat' AND json_extract(value,'$.delivery.kind')='steer' AND json_extract(value,'$.delivery.state')='pending'",
      )
      .all();
    for (const row of unapplied) {
      const message = JSON.parse(String(row.value));
      conversations.append(
        String(row.session_id),
        finishDelivery(message, "not-applied"),
        String(row.context_id),
      );
    }
    const pending = conversations.db
      .prepare(
        "SELECT session_id,context_id,value FROM messages WHERE channel='chat' AND json_extract(value,'$.status')='pending'",
      )
      .all();
    const interrupted = new Map<
      string,
      { sessionId: string; contextId: string; runId?: string }
    >();
    for (const row of pending) {
      const message = JSON.parse(String(row.value));
      conversations.append(
        String(row.session_id),
        finishUserMessage(message, "failed"),
        String(row.context_id),
      );
      interrupted.set(String(row.context_id) + ":" + message.runId, {
        sessionId: String(row.session_id),
        contextId: String(row.context_id),
        runId: message.runId,
      });
    }
    for (const item of interrupted.values())
      conversations.append(
        item.sessionId,
        {
          id: randomUUID(),
          runId: item.runId,
          role: "assistant",
          content: "服務重新啟動，上次任務已中斷。請確認已完成的操作後再重試。",
          status: "error",
        },
        item.contextId,
      );
  });
}
