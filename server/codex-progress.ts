import type { RunOptions } from "./runtime.ts";
import type { ToolOperation } from "../shared/types.ts";
import { boundedEvidence } from "./evidence.ts";

/** Public app-server items only; reasoning items are deliberately not surfaced. */
export function codexProgress(
  options: Pick<RunOptions, "emit" | "recordOperation">,
) {
  const operations = new Map<string, ToolOperation>();
  const messages = new Map<string, { phase?: string; text: string }>();
  let writes = Promise.resolve();
  let writeError: unknown;
  const save = (operation: ToolOperation) => {
    operations.set(operation.id, operation);
    writes = writes
      .then(() => options.recordOperation?.(operation))
      .then(
        () => {},
        (error) => {
          writeError ??= error;
        },
      );
  };
  return {
    receive(method: string, params: any) {
      if (method === "item/agentMessage/delta") {
        const message = messages.get(params.itemId);
        if (!message || typeof params.delta !== "string") return;
        message.text += params.delta;
        options.emit({
          type: "progress",
          text: message.phase === "commentary" ? message.text : "正在產生回覆",
        });
        return;
      }
      if (method !== "item/started" && method !== "item/completed") return;
      const item = params.item;
      if (!item || typeof item.id !== "string") return;
      const finished = method === "item/completed";
      if (item.type === "agentMessage") {
        messages.set(item.id, { phase: item.phase, text: item.text || "" });
        if (item.phase === "commentary" && item.text) {
          options.emit({ type: "progress", text: item.text });
          if (finished) options.emit({ type: "activity", text: item.text });
        } else options.emit({ type: "progress", text: "正在產生回覆" });
        return;
      }
      if (
        ![
          "commandExecution",
          "fileChange",
          "webSearch",
          "mcpToolCall",
        ].includes(item.type)
      )
        return;
      // Apsis MCP tools already have durable records from createTools().
      if (item.type === "mcpToolCall" && item.server === "apsis") return;
      const id = `codex-${item.id}`;
      const previous = operations.get(id);
      if (previous?.endedAt && !finished) return;
      const failed =
        item.status === "failed" ||
        item.status === "declined" ||
        item.error ||
        (typeof item.exitCode === "number" && item.exitCode !== 0);
      const succeeded =
        item.status === "completed" || item.type === "webSearch";
      const operation: ToolOperation = {
        id,
        name:
          item.type === "mcpToolCall"
            ? `${item.server}/${item.tool}`
            : item.type,
        status: !finished
          ? "started"
          : failed
            ? "failed"
            : succeeded
              ? "succeeded"
              : "unknown",
        startedAt: previous?.startedAt || new Date().toISOString(),
        endedAt: finished ? new Date().toISOString() : undefined,
        mutating:
          ["commandExecution", "fileChange"].includes(item.type) ||
          (item.type === "mcpToolCall" && item.readOnlyHint !== true),
        target: (
          item.command ||
          item.query ||
          item.changes?.[0]?.path ||
          item.tool
        )?.slice(0, 300),
        error: item.error?.message,
        evidence: finished
          ? boundedEvidence({
              command: item.command,
              output:
                item.aggregatedOutput ??
                (item.result ? JSON.stringify(item.result) : undefined),
              exitCode: item.exitCode,
              patch: item.changes
                ?.map(
                  (c: { path: string; diff: string }) => `${c.path}\n${c.diff}`,
                )
                .join("\n"),
            })
          : undefined,
      };
      save(operation);
    },
    async flush() {
      await writes;
      if (writeError) throw writeError;
    },
  };
}

/** Notifications may precede the turn/start response. Replay only the selected turn. */
export function codexTurnNotifications(
  handle: (method: string, params: any) => void,
) {
  let thread = "",
    turn = "";
  let buffered: { method: string; params: any }[] = [];
  const receive = (method: string, params: any) => {
    if (!thread || params?.threadId !== thread) return;
    if (!turn) {
      buffered.push({ method, params });
      return;
    }
    const eventTurn = params?.turnId || params?.turn?.id;
    if (eventTurn !== turn) return;
    handle(method, params);
  };
  return {
    thread(id: string) {
      thread = id;
    },
    turn(id: string) {
      turn = id;
      const pending = buffered;
      buffered = [];
      for (const event of pending) receive(event.method, event.params);
    },
    receive,
  };
}
