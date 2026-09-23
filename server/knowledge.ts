import type { Memory } from "../shared/types.ts";
export const normalizeFact = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}]+/gu, "");
export function revise(item: Memory, content: string) {
  if (item.content === content) return;
  item.revisions = [
    ...(item.revisions || []),
    {
      content: item.content,
      at: item.updatedAt || item.createdAt || new Date().toISOString(),
    },
  ].slice(-20);
  item.content = content;
  item.updatedAt = new Date().toISOString();
}
/** Lexical relevance, including CJK bigrams; no external embedding service. */
export function rankMemories(memories: Memory[], query: string) {
  const terms = new Set(
    query.toLocaleLowerCase().match(/[a-z0-9_]{2,}|[\p{Script=Han}]{1,}/gu) ||
      [],
  );
  for (const term of [...terms])
    if (/\p{Script=Han}/u.test(term))
      for (let i = 0; i < term.length - 1; i++) terms.add(term.slice(i, i + 2));
  return memories
    .filter((m) => m.enabled !== false && !m.mergedInto)
    .map((m, index) => ({
      m,
      index,
      score: [...terms].reduce(
        (score, term) =>
          score +
          (m.content.toLocaleLowerCase().includes(term) ? term.length : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.m);
}
