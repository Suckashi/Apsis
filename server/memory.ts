import { randomUUID } from "node:crypto";
import type { Memory, StoreState } from "../shared/types.ts";
import { normalizeFact, rankMemories } from "./knowledge.ts";
import { estimateTokens } from "./context-budget.ts";

const conflict = (message: string): never => {
  throw Object.assign(new Error(message), { status: 409 });
};
export function changeMemory(
  state: StoreState,
  scope: string | undefined,
  input: {
    id?: string;
    revision?: number;
    content?: string;
    tier?: "core" | "reference";
    locked?: boolean;
    enabled?: boolean;
    mergeIds?: string[];
    mergeRevisions?: Record<string, number>;
  },
  source: NonNullable<Memory["source"]>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("記憶資料格式錯誤。");
  if (
    (input.content !== undefined && typeof input.content !== "string") ||
    (input.enabled !== undefined && typeof input.enabled !== "boolean") ||
    (input.locked !== undefined && typeof input.locked !== "boolean") ||
    (input.mergeIds !== undefined &&
      (!Array.isArray(input.mergeIds) ||
        input.mergeIds.some((id) => typeof id !== "string")))
  )
    throw new Error("記憶資料格式錯誤。");
  const existing = input.id
    ? state.memories.find((m) => m.id === input.id && m.agentId === scope)
    : undefined;
  if (input.id && !existing)
    throw Object.assign(new Error("找不到記憶。"), { status: 404 });
  const check = (memory: Memory, revision?: number) => {
    if (revision !== (memory.revision ?? 1))
      conflict("記憶已變更，請重新載入後再編輯。");
    if (
      source.kind === "agent" &&
      (memory.locked || memory.source?.kind === "manual")
    )
      conflict("此記憶由使用者編輯或鎖定，不能自動覆寫。");
  };
  if (existing) check(existing, input.revision);
  const content = input.content ?? existing?.content ?? "";
  if (!content.trim() || content.length > 4000)
    throw new Error("記憶需為 1–4000 字。");
  if (input.tier !== undefined && !["core", "reference"].includes(input.tier))
    throw new Error("無效的記憶分類。");
  if (source.kind === "agent" && input.locked !== undefined)
    throw new Error("只有使用者能變更鎖定狀態。");
  const merged = (input.mergeIds || []).map((id) => {
    const memory = state.memories.find(
      (m) => m.id === id && m.agentId === scope && m.id !== existing?.id,
    );
    if (!memory) throw new Error("找不到合併來源。");
    check(memory, input.mergeRevisions?.[id]);
    return memory;
  });
  if (!existing) {
    const duplicate = state.memories.find(
      (m) =>
        m.agentId === scope &&
        m.enabled !== false &&
        !m.mergedInto &&
        normalizeFact(m.content) === normalizeFact(content),
    );
    if (duplicate) return duplicate;
  }
  const tier = input.tier ?? existing?.tier ?? "reference";
  const enabled = input.enabled ?? existing?.enabled ?? true;
  if (tier === "core" && enabled) {
    const size = state.memories
      .filter(
        (m) =>
          m.agentId === scope &&
          m.id !== existing?.id &&
          !merged.includes(m) &&
          m.tier === "core" &&
          m.enabled !== false &&
          !m.mergedInto,
      )
      .reduce((n, m) => n + m.content.length, 0);
    if (size + content.length > 6000)
      conflict("核心記憶超過 6,000 字元，請先整理或移至參考記憶。");
  }
  const duplicate = state.memories.find(
    (m) =>
      m.agentId === scope &&
      m.enabled !== false &&
      !m.mergedInto &&
      m.id !== existing?.id &&
      !merged.includes(m) &&
      normalizeFact(m.content) === normalizeFact(content),
  );
  if (duplicate) {
    if (!existing) return duplicate;
    conflict("已有相同內容的記憶，請合併條目。");
  }
  const memory: Memory = existing ?? {
    id: randomUUID(),
    agentId: scope,
    content,
    createdAt: new Date().toISOString(),
    revision: 0,
  };
  if (existing)
    memory.revisions = [
      ...(memory.revisions || []),
      {
        content: memory.content,
        at: new Date().toISOString(),
        revision: memory.revision ?? 1,
        source: memory.source,
        tier: memory.tier,
        locked: memory.locked,
        enabled: memory.enabled,
      },
    ];
  Object.assign(memory, {
    content,
    tier,
    enabled,
    source,
    revision: (memory.revision ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  });
  if (input.enabled === true) delete memory.mergedInto;
  if (input.locked !== undefined) memory.locked = input.locked;
  for (const old of merged) {
    old.mergedInto = memory.id;
    old.enabled = false;
    old.revision = (old.revision ?? 1) + 1;
    old.updatedAt = memory.updatedAt;
  }
  if (!existing) state.memories.push(memory);
  return memory;
}

export function selectMemories(
  memories: Memory[],
  query: string,
  limit = 1600,
) {
  const selected: Memory[] = [],
    omittedCoreIds: string[] = [];
  for (const tier of ["core", "reference"]) {
    let used = 0;
    for (const memory of rankMemories(memories, query).filter(
      (m) => (m.tier || "reference") === tier,
    )) {
      const size = estimateTokens({
        id: memory.id,
        revision: memory.revision ?? 1,
        content: memory.content,
      });
      if (used + size > limit) {
        if (tier === "core") omittedCoreIds.push(memory.id);
        continue;
      }
      selected.push(memory);
      used += size;
    }
  }
  return { selected, omittedCoreIds };
}
