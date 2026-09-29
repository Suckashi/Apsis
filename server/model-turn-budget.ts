import { createMiddleware } from "langchain";

export class ModelTurnLimitError extends Error {
  constructor(limit: number) {
    super(
      `已達本次 ${limit} 次模型回合上限，已停止繼續請求。已完成的變更與操作紀錄會保留；請檢查目前結果後縮小範圍或重新交辦。`,
    );
    this.name = "ModelTurnLimitError";
  }
}

/** Model attempts, not LangGraph nodes; provider retries consume the same budget. */
export function modelTurnBudget(value: number) {
  const limit = Math.max(
    1,
    Math.min(200, Number.isFinite(value) ? Math.floor(value) : 48),
  );
  let used = 0;
  const assertAvailable = () => {
    if (used >= limit) throw new ModelTurnLimitError(limit);
  };
  return {
    // Multiple beforeModel/afterModel/tool nodes run for each model attempt.
    // This is only a graph safety ceiling; consume enforces the user budget.
    recursionLimit: limit * 12 + 32,
    assertAvailable,
    consume: () => {
      assertAvailable();
      used++;
    },
    middleware: createMiddleware({
      name: "ApsisModelTurnBudget",
      beforeModel: () => {
        assertAvailable();
      },
    }),
  };
}
