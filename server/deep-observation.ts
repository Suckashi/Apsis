import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createMiddleware } from "langchain";
import type { RunOptions } from "./runtime.ts";
import type { SubagentActivity, ExecutionTodo } from "../shared/types.ts";
import { operationLabel } from "../shared/task-progress.ts";

// Correlate concurrent native task invocations without creating product jobs.
export function deepObservation(original: RunOptions) {
  const scope = new AsyncLocalStorage<SubagentActivity>();
  const publish = (activity: SubagentActivity) =>
    original.emit({
      type: "execution",
      evidence: { kind: "subagent", activity: { ...activity } },
    });
  const options: RunOptions = {
    ...original,
    recordOperation: async (operation) => {
      const child = scope.getStore();
      if (child && operation.status === "started") {
        child.progress = `正在${operationLabel(operation)}`;
        publish(child);
      }
      await original.recordOperation?.({
        ...operation,
        ...(child ? { subagentId: child.id } : {}),
      });
    },
  };
  const plans = new Map<string, string>();
  const middleware = createMiddleware({
    name: "ApsisExecutionObservation",
    afterModel: (state) => {
      const child = scope.getStore();
      const message = state.messages.at(-1);
      if (child && message?.type === "ai") {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("");
        if (text.trim()) {
          child.progress = text;
          publish(child);
        }
      }
    },
    wrapToolCall: async (request, handler) => {
      original.signal.throwIfAborted();
      const call = request.toolCall;
      if (call.name === "task") {
        const child: SubagentActivity = {
          id: call.id || randomUUID(),
          name: String(call.args.subagent_type),
          task: String(call.args.description),
          status: "running",
          startedAt: new Date().toISOString(),
        };
        publish(child);
        return scope.run(child, async () => {
          try {
            const result = await handler(request);
            original.signal.throwIfAborted();
            const messages =
              "update" in result
                ? (
                    result.update as {
                      messages?: { content: unknown; status?: string }[];
                    }
                  )?.messages
                : [result];
            const message = messages?.at(-1) as
              | { content?: unknown; status?: string }
              | undefined;
            child.status = message?.status === "error" ? "failed" : "completed";
            if (typeof message?.content === "string")
              child.resultSummary = message.content;
            return result;
          } catch (error) {
            child.status = original.signal.aborted ? "cancelled" : "failed";
            child.progress = original.signal.aborted ? "已停止" : String(error);
            throw error;
          } finally {
            child.endedAt = new Date().toISOString();
            publish(child);
          }
        });
      }
      const result = await handler(request);
      if (call.name === "write_todos" && Array.isArray(call.args.todos)) {
        const key = scope.getStore()?.id || "parent";
        const todos = call.args.todos as ExecutionTodo[];
        const value = JSON.stringify(todos);
        if (
          plans.get(key) !== value &&
          !("status" in result && result.status === "error")
        ) {
          plans.set(key, value);
          original.emit({
            type: "execution",
            evidence: {
              kind: "planning",
              todos,
              subagentId: scope.getStore()?.id,
            },
          });
        }
      }
      return result;
    },
  });
  return { options, middleware };
}
