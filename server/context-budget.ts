/** Conservative multilingual estimate; never present this as provider usage. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value) || "";
  let units = 0;
  for (const char of text) units += char.codePointAt(0)! > 127 ? 1.5 : 0.3;
  return Math.ceil(units);
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256 * 1024;

export function contextBudget(
  _provider: string,
  _model: string,
  settings?: {
    contextWindowTokens?: number;
    maxOutputTokens?: number;
  },
) {
  const windowTokens =
    settings?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const output = settings?.maxOutputTokens ?? 4096;
  if (
    !Number.isSafeInteger(windowTokens) ||
    windowTokens < 2048 ||
    windowTokens > 10000000 ||
    !Number.isSafeInteger(output) ||
    output < 1 ||
    output > 1000000
  )
    throw Object.assign(new Error("模型 token 預算格式錯誤。"), {
      status: 422,
    });
  const reserve = Math.max(1024, Math.ceil(windowTokens * 0.05));
  const input = windowTokens - output - reserve;
  if (input < 1024)
    throw Object.assign(
      new Error("Context 上限不足以容納輸出預留與安全空間，請調整模型設定。"),
      { status: 422 },
    );
  return {
    windowTokens,
    output,
    input,
    trigger: Math.floor(input * 0.8),
    keep: Math.min(12000, Math.floor(input * 0.2)),
    memory: Math.min(1600, Math.floor(input * 0.15)),
    tool: Math.min(2000, Math.floor(input * 0.1)),
  };
}
