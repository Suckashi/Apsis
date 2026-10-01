import { useEffect, useRef, useState } from "react";
import type { Memory, WorkContext } from "../shared/types.ts";
import { Icon } from "./chat-visuals.tsx";
import { uiText as t, uiError } from "./settings-dictionary.ts";

export function MemoryPanel({
  memories,
  context,
  loading,
  loadError,
  retry,
  api,
  base,
  refresh,
}: {
  memories: Memory[];
  context?: WorkContext;
  loading: boolean;
  loadError: string;
  retry: () => void;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  base: string;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<Memory>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing) returnFocus.current = true;
    else if (!busy && !loading && !loadError && returnFocus.current) {
      // The parent may reload scope metadata after saving a memory. Wait for
      // the resulting commit before focusing a temporarily disabled trigger.
      const frame = requestAnimationFrame(() => {
        if (trigger.current?.isConnected && !trigger.current.disabled) {
          trigger.current.focus();
          returnFocus.current = false;
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [editing, busy, loading, loadError]);
  const edit = (memory: Partial<Memory>, button: HTMLButtonElement) => {
    trigger.current = button;
    setSaved(false);
    setError("");
    setEditing(memory);
  };
  return (
    <section className="memory-reading" aria-label={t("記憶管理")}>
      <div className="memory-reading-intro">
        <p>{t("保存偏好、需求與工作背景，並選擇適用範圍。")}</p>
        <button
          disabled={busy || loading || !!loadError || !!editing || !context}
          onClick={(event) =>
            edit(
              { content: "", tier: "reference", enabled: true },
              event.currentTarget,
            )
          }
        >
          <Icon name="plus" size={16} />
          {t("新增記憶")}
        </button>
      </div>
      {loading && <p role="status">{t("載入中…")}</p>}
      {loadError && (
        <div>
          <p role="alert">{uiError(loadError)}</p>
          <button onClick={retry}>{t("重新載入")}</button>
        </div>
      )}
      {error && <p role="alert">{uiError(error)}</p>}
      {saved && <p role="status">{t("記憶已儲存。")}</p>}
      {!loading && !loadError && !memories.length && !editing && (
        <div className="memory-empty">
          <Icon name="memory" size={28} />
          <h3>{t("尚未加入記憶")}</h3>
          <p>{t("加入常用偏好或背景，讓 Bot 在適用範圍內延續工作。")}</p>
        </div>
      )}
      {editing && (
        <form
          className="memory-edit-form"
          onChangeCapture={() => {
            setError("");
            setSaved(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !context || loading || loadError) return;
            setBusy(true);
            setError("");
            setSaved(false);
            void (async () => {
              try {
                await api(base + "/memories", {
                  id: editing.id,
                  content: editing.content,
                  tier: editing.tier,
                  enabled: editing.enabled,
                  locked: editing.locked,
                  revision: editing.revision,
                  scopeKey:
                    editing.scopeKey === "global" ? "global" : "current",
                  workContextId: context.id,
                });
                await refresh();
                setEditing(undefined);
                setSaved(true);
              } catch (reason) {
                setError((reason as Error).message);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <label>
            {t("記憶內容")}
            <textarea
              autoFocus
              required
              disabled={busy}
              maxLength={4000}
              value={editing.content || ""}
              onChange={(event) =>
                setEditing({ ...editing, content: event.target.value })
              }
            />
          </label>
          <label>
            {t("記憶範圍")}
            <select
              disabled={busy}
              value={editing.scopeKey === "global" ? "global" : "current"}
              onChange={(event) =>
                setEditing({ ...editing, scopeKey: event.target.value })
              }
            >
              <option value="current">
                {t(context?.location?.projectId ? "專案記憶" : "目前話題記憶")}
              </option>
              <option value="global">{t("跨工作偏好")}</option>
            </select>
          </label>
          <details className="memory-edit-advanced">
            <summary>
              {t("進階選項")}
              {editing.tier === "core" && <span> · {t("核心")}</span>}
              {editing.locked && <span> · {t("鎖定")}</span>}
              {editing.enabled === false && <span> · {t("已停用")}</span>}
              <Icon name="chevron-right" size={14} />
            </summary>
            <label>
              {t("分類")}
              <select
                disabled={busy}
                value={editing.tier || "reference"}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    tier: event.target.value as Memory["tier"],
                  })
                }
              >
                <option value="core">{t("核心")}</option>
                <option value="reference">{t("參考")}</option>
              </select>
            </label>
            <label className="memory-check">
              <input
                disabled={busy}
                type="checkbox"
                checked={!!editing.locked}
                onChange={(event) =>
                  setEditing({ ...editing, locked: event.target.checked })
                }
              />
              {t("鎖定")}
            </label>
            <label className="memory-check">
              <input
                disabled={busy}
                type="checkbox"
                checked={editing.enabled !== false}
                onChange={(event) =>
                  setEditing({ ...editing, enabled: event.target.checked })
                }
              />
              {t("啟用")}
            </label>
          </details>
          <div className="memory-edit-actions">
            <button
              disabled={busy || loading || !!loadError}
              className="primary"
            >
              {t(busy ? "儲存中…" : "儲存")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setEditing(undefined);
              }}
            >
              {t("取消")}
            </button>
          </div>
        </form>
      )}
      <div className="memory-list">
        {memories.map((memory) => (
          <article className="memory memory-card" key={memory.id}>
            <p>{memory.content}</p>
            <div className="memory-card-footer">
              <small>
                {t(
                  memory.scopeKey === "global"
                    ? "跨工作偏好"
                    : memory.scopeKey?.startsWith("project:")
                      ? "專案記憶"
                      : "目前話題記憶",
                )}
                {memory.locked && <span> · {t("鎖定")}</span>}
                {memory.enabled === false && <span> · {t("已停用")}</span>}
              </small>
              <button
                disabled={
                  busy || loading || !!loadError || !!editing || !context
                }
                onClick={(event) => edit(memory, event.currentTarget)}
              >
                {t("編輯")}
              </button>
            </div>
            <details className="memory-source">
              <summary>
                {t("來源與修訂")}
                <Icon name="chevron-right" size={14} />
              </summary>
              <p>
                {t(memory.tier === "core" ? "核心" : "參考")} · v
                {memory.revision ?? 1}
              </p>
              <p>{memory.updatedAt || memory.createdAt}</p>
              <pre>{JSON.stringify(memory.source, null, 2)}</pre>
              {memory.revisions?.map((revision, index) => (
                <p key={index}>
                  {revision.at} — {revision.content}
                </p>
              ))}
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
