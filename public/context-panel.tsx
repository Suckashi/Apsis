import { useEffect, useState } from "react";
import type { Memory, WorkContext, ChatMessage } from "../shared/types.ts";
import type { HistoryHit } from "../server/conversations.ts";
import { uiText as t } from "./settings-dictionary.ts";

type API = <T>(path: string, body?: unknown) => Promise<T>;
export function ContextPanel({
  botId,
  memories,
  api,
  refresh,
  quote,
  updateKey,
}: {
  updateKey?: string;
  botId: string;
  memories: Memory[];
  api: API;
  refresh: () => Promise<void>;
  quote: (id: string, content: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HistoryHit[]>([]);
  const [contexts, setContexts] = useState<WorkContext[]>([]);
  const [past, setPast] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const [usage, setUsage] = useState<{
    context: WorkContext;
    compactions: { id: number; summary: string }[];
  }>();
  const [editing, setEditing] = useState<Partial<Memory>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/bots/${botId}`;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const memoryRevision = memories.map((m) => m.id + ":" + m.revision).join(",");
  useEffect(() => {
    let valid = true;
    Promise.all([
      api<WorkContext[]>(base + "/contexts"),
      api<typeof usage>(base + "/context"),
    ])
      .then(([rows, info]) => {
        if (valid) {
          setContexts(rows);
          setUsage(info);
        }
      })
      .catch((e) => {
        if (valid) setError(e.message);
      });
    return () => {
      valid = false;
    };
  }, [base, memoryRevision, updateKey]);
  const loadTask = async (id: string, before?: number) => {
    const page = await api<{ messages: ChatMessage[]; olderCursor?: number }>(
      `${base}/history?context=${encodeURIComponent(id)}${before ? `&before=${before}` : ""}`,
    );
    setSelected(id);
    setPast(page.messages);
    setOlder(page.olderCursor);
  };
  return (
    <div className="context-panel">
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>{t("歷史搜尋與任務")}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () =>
              setHits(
                await api<HistoryHit[]>(
                  `${base}/history/search?q=${encodeURIComponent(query)}`,
                ),
              ),
            );
          }}
        >
          <label>
            {t("搜尋歷史")}
            <input
              value={query}
              minLength={2}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button disabled={busy || query.trim().length < 2}>
            {t("搜尋")}
          </button>
        </form>
        {hits.map((hit) => (
          <div className="memory" key={hit.sequence}>
            <p>{hit.content}</p>
            <small>
              {hit.workContextId} · {hit.role}
            </small>
            {hit.channel === "chat" && (
              <button onClick={() => quote(hit.id, hit.content)}>
                {t("引用")}
              </button>
            )}
            <button
              onClick={() =>
                void act(async () =>
                  setHits(
                    await api<HistoryHit[]>(
                      `${base}/history/around?sequence=${hit.sequence}`,
                    ),
                  ),
                )
              }
            >
              {t("前後文")}
            </button>
          </div>
        ))}
        {!!hits.length && (
          <button
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setHits(
                  await api<HistoryHit[]>(
                    `${base}/history/search?q=${encodeURIComponent(query)}&before=${hits.at(-1)!.sequence}`,
                  ),
                ),
              )
            }
          >
            {t("更早的搜尋結果")}
          </button>
        )}
        <label>
          {t("瀏覽舊任務")}
          <select
            value={selected || ""}
            onChange={(e) => {
              if (e.target.value) void act(() => loadTask(e.target.value));
            }}
          >
            <option value="">{t("選擇任務")}</option>
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.createdAt} · {c.kind}
              </option>
            ))}
          </select>
        </label>
        {past.map((m) => (
          <div className="memory" key={m.id}>
            <p>{m.content}</p>
            <button onClick={() => quote(m.id, m.content)}>{t("引用")}</button>
          </div>
        ))}
        {older && selected && (
          <button
            disabled={busy}
            onClick={() => void act(() => loadTask(selected, older))}
          >
            {t("更早的訊息")}
          </button>
        )}
        {contexts.length >= 50 && (
          <button
            disabled={busy}
            onClick={() =>
              void act(async () =>
                setContexts(
                  await api<WorkContext[]>(
                    base +
                      "/contexts?beforeId=" +
                      encodeURIComponent(contexts.at(-1)!.id),
                  ),
                ),
              )
            }
          >
            {t("更早的任務")}
          </button>
        )}
      </details>
      <details>
        <summary>{t("Context 用量")}</summary>
        {usage?.context.usage ? (
          <>
            <p>
              {usage.context.usage.inputTokens.toLocaleString()} /{" "}
              {usage.context.usage.inputBudget.toLocaleString()} tokens ·{" "}
              {t(
                usage.context.usage.source === "provider" ? "實際回報" : "估計",
              )}
            </p>
            {!!usage.context.usage.omittedCoreIds.length && (
              <p>
                {t("未載入的核心記憶")}：
                {usage.context.usage.omittedCoreIds
                  .map(
                    (id) =>
                      memories.find((m) => m.id === id)?.content.slice(0, 80) ||
                      id,
                  )
                  .join("；")}
              </p>
            )}
          </>
        ) : (
          <p>{t("尚無用量紀錄")}</p>
        )}
        {usage?.compactions.map((c) => (
          <details key={c.id}>
            <summary>
              {t("壓縮紀錄")} #{c.id}
            </summary>
            <p>{c.summary}</p>
          </details>
        ))}
      </details>
      <button
        onClick={() =>
          setEditing({ content: "", tier: "reference", enabled: true })
        }
      >
        {t("新增記憶")}
      </button>
      {memories.map((m) => (
        <div className="memory" key={m.id}>
          <p>{m.content}</p>
          <small>
            {t(m.tier === "core" ? "核心" : "參考")} · v{m.revision ?? 1}{" "}
            {m.locked ? "🔒" : ""} {m.enabled === false ? t("已停用") : ""}
          </small>
          <button onClick={() => setEditing(m)}>{t("編輯")}</button>
          <details>
            <summary>{t("來源與修訂")}</summary>
            <p>{m.updatedAt || m.createdAt}</p>
            <pre>{JSON.stringify(m.source, null, 2)}</pre>
            {m.revisions?.map((r, i) => (
              <p key={i}>
                {r.at} — {r.content}
              </p>
            ))}
          </details>
        </div>
      ))}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(base + "/memories", editing);
              setEditing(undefined);
              await refresh();
            });
          }}
        >
          <label>
            {t("記憶內容")}
            <textarea
              required
              maxLength={4000}
              value={editing.content}
              onChange={(e) =>
                setEditing({ ...editing, content: e.target.value })
              }
            />
          </label>
          <label>
            {t("分類")}
            <select
              value={editing.tier || "reference"}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  tier: e.target.value as Memory["tier"],
                })
              }
            >
              <option value="core">{t("核心")}</option>
              <option value="reference">{t("參考")}</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!editing.locked}
              onChange={(e) =>
                setEditing({ ...editing, locked: e.target.checked })
              }
            />
            {t("鎖定")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={editing.enabled !== false}
              onChange={(e) =>
                setEditing({ ...editing, enabled: e.target.checked })
              }
            />
            {t("啟用")}
          </label>
          <button disabled={busy}>{t("儲存")}</button>
          <button type="button" onClick={() => setEditing(undefined)}>
            {t("取消")}
          </button>
        </form>
      )}
    </div>
  );
}
