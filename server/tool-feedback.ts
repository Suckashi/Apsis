import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import type { RunOptions } from "./runtime.ts";
import type { ToolOperation } from "../shared/types.ts";
import { isRecordedToolFailure } from "./tools.ts";
import { ToolExecutionError } from "./evidence.ts";
import {
  ToolFailureGuard,
  ToolFailureLoopError,
} from "./tool-failure-guard.ts";

/** Native scratch tools must have the same visible lifecycle as workspace tools. */
export function toolFeedback(
  options: RunOptions,
  workspaceTools: Set<string>,
  guard = new ToolFailureGuard(),
) {
  return createMiddleware({
    name: "ApsisToolFeedback",
    beforeModel: () => {
      guard.assertActive();
    },
    wrapModelCall: (request, handler) => {
      guard.assertActive();
      return handler(request);
    },
    wrapToolCall: async (request, handler) => {
      options.signal.throwIfAborted();
      guard.assertActive();
      const { name, args, id } = request.toolCall;
      const native = !workspaceTools.has(name);
      const target = ["file_path", "path", "pattern", "command", "botId"]
        .map((key) => args?.[key])
        .find((value) => typeof value === "string");
      const operation: ToolOperation = {
        id: id || randomUUID(),
        name: [
          "read_file",
          "write_file",
          "edit_file",
          "ls",
          "glob",
          "grep",
        ].includes(name)
          ? "scratch_" + name
          : name.replace(/^workspace_/, ""),
        target: typeof target === "string" ? target.slice(0, 300) : undefined,
        status: "started",
        startedAt: new Date().toISOString(),
        mutating: ["write_file", "edit_file", "write_todos"].includes(
          name.replace(/^workspace_/, ""),
        ),
      };
      if (native) await options.recordOperation?.(operation);
      let result;
      let failure: string | undefined;
      let threw = false;
      let alreadyRecorded = false;
      let cause: unknown;
      try {
        result = await handler(request);
        if (ToolMessage.isInstance(result)) {
          const content =
            typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content);
          if (
            result.status === "error" ||
            /^(Tool failed:|Error[: ])/i.test(content)
          )
            failure = content;
        }
      } catch (error) {
        options.signal.throwIfAborted();
        if (error instanceof ToolFailureLoopError) throw error;
        threw = true;
        cause = error;
        alreadyRecorded = isRecordedToolFailure(error);
        failure = error instanceof Error ? error.message : String(error);
      }
      if (native || (threw && !alreadyRecorded)) {
        await options.recordOperation?.({
          ...operation,
          status: failure ? "failed" : "succeeded",
          endedAt: new Date().toISOString(),
          error: failure?.slice(0, 4000),
          evidence: failure
            ? undefined
            : {
                output: ToolMessage.isInstance(result)
                  ? String(result.content).slice(0, 2000)
                  : "Tool completed",
              },
        });
      }
      if (!failure) {
        guard.success(name, args);
        return result!;
      }
      const count = guard.failure(name, args, failure, cause);
      if (count >= 3) {
        options.emit({
          type: "activity",
          tool: name,
          text: "同一操作持續失敗 3 次，已停止自動重試，請檢查操作紀錄後重新交辦。",
        });
        guard.assertActive();
      }
      // Let the model repair arguments; never automatically replay host actions.
      const hint = /虛擬檔案路徑|scratch|virtual/i.test(failure)
        ? " Scratch paths use /name.txt, without drive letters, backslashes or '..'. For user deliverables use workspace_write_file with a relative path such as snake/index.html."
        : " Inspect the error and correct the arguments or choose an appropriate tool. Do not repeat the same failed call. If an external action may already have occurred, inspect its state before trying again. Never bypass a permission denial.";
      options.emit({
        type: "activity",
        tool: name,
        text: `${name} 失敗，已交回模型修正（${count}/3）。`,
      });
      return new ToolMessage({
        tool_call_id: id || operation.id,
        name,
        status: "error",
        content: `Tool failed: ${failure.slice(0, 4000)}${cause instanceof ToolExecutionError && cause.evidence.output ? "\nCommand output:\n" + cause.evidence.output.slice(0, 4000) : ""}${hint}`,
      });
    },
  });
}
