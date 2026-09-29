/** Short labels are for navigation only; full requests remain in the conversation. */
export function compactTaskTitle(title: string, limit = 32): string {
  const characters = Array.from(title.replace(/\s+/g, " ").trim());
  return characters.length > limit
    ? characters.slice(0, limit - 1).join("") + "…"
    : characters.join("");
}

export function planSummary(plan: string): string {
  const lines = plan
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const content = lines.find((line) => !line.startsWith("#")) || lines[0] || "";
  return compactTaskTitle(
    content.replace(/^[-*\d.)\s]+/, "").replace(/[*`]/g, ""),
    96,
  );
}

export function planStartVersion(content: string): string | undefined {
  return /^請依照使用者已確認的計畫 v(\d+) 開始實作並驗證：\r?\n/.exec(
    content,
  )?.[1];
}
