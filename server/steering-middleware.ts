import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import type { DeepValue } from "./context-checkpoint.ts";
import type { SteerHandler } from "./runtime.ts";

/** Deliver supplements at the next internal model boundary, including tool loops. */
export function steeringMiddleware(
  signal: AbortSignal,
  assertActive: () => void,
  persist: (state: DeepValue) => void,
) {
  const pending: { message: HumanMessage; onApplied?: () => Promise<void> }[] =
    [];
  const staged = new Map<string, (typeof pending)[number]>();
  let accepting = true;
  const check = () => {
    signal.throwIfAborted();
    assertActive();
  };
  const enqueue: SteerHandler = async (instruction, onApplied) => {
    if (!accepting || signal.aborted)
      throw Object.assign(new Error("目前回合已結束，補充指示尚未採用。"), {
        status: 409,
      });
    assertActive();
    pending.push({
      message: new HumanMessage({
        id: `steer-input-${randomUUID()}`,
        content: instruction,
      }),
      onApplied,
    });
  };
  const forPersistence = (state: DeepValue): DeepValue => ({
    ...state,
    // If stopped between state injection and the model boundary, do not restore
    // a supplement whose delivery receipt will become not-applied.
    messages: state.messages.filter(
      (message) => !message.id || !staged.has(message.id),
    ),
  });
  const middleware = createMiddleware({
    name: "ApsisSteering",
    beforeModel: () => {
      check();
      const batch = pending.splice(0);
      if (!batch.length) return;
      for (const item of batch) staged.set(item.message.id!, item);
      return { messages: batch.map((item) => item.message) };
    },
    wrapModelCall: async (request, handler) => {
      check();
      const ids = new Set(request.messages.map((message) => message.id));
      for (const [id, item] of staged) {
        if (!ids.has(id)) continue;
        check();
        // The graph has applied the beforeModel update and this request now
        // contains the message. Adoption does not claim model/tool success.
        await item.onApplied?.();
        staged.delete(id);
        persist(forPersistence(request.state as DeepValue));
      }
      check();
      return handler(request);
    },
  });
  return {
    middleware,
    enqueue,
    forPersistence,
    hasPending: () => pending.length > 0 || staged.size > 0,
    close: () => {
      accepting = false;
    },
  };
}
