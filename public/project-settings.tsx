import { useEffect, useRef, useState } from "react";
import type { Memory, Project } from "../shared/types.ts";
import { Modal } from "./bot-ui.tsx";
import { Icon } from "./chat-visuals.tsx";
import { uiText as t, uiError } from "./settings-dictionary.ts";

export function ProjectSettings({
  project,
  api,
  refresh,
  close,
}: {
  project: Project;
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [description, setDescription] = useState(project.description || "");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [editing, setEditing] = useState<Partial<Memory>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const addTrigger = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const base = `/projects/${project.id}`;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    api<Memory[]>(base + "/memories")
      .then((rows) => {
        if (live) setMemories(rows);
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [base, reload]);
  useEffect(() => {
    if (editing) returnFocus.current = true;
    else if (!busy && returnFocus.current && editTrigger.current) {
      (editTrigger.current.isConnected
        ? editTrigger.current
        : addTrigger.current
      )?.focus();
      returnFocus.current = false;
    }
  }, [editing, busy]);
  const act = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await fn();
      await refresh();
      setSaved(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label={t("專案設定")} close={close}>
      <section className="modal cw-settings-modal project-settings-modal">
        <header>
          <div>
            <h2>{t("專案設定")}</h2>
            <p className="project-settings-name">{project.name}</p>
          </div>
          <button aria-label={t("關閉專案設定")} onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="project-settings-body">
          <div className="project-settings-location">
            <span>{t("工作資料夾")}</span>
            <p>{project.path}</p>
          </div>
          {error && <p role="alert">{uiError(error)}</p>}
          {saved && <p role="status">{t(saved)}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api(base, "PATCH", { description });
              }, "專案說明已儲存。");
            }}
          >
            <label>
              {t("專案說明")}
              <textarea
                disabled={busy}
                value={description}
                maxLength={4000}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setSaved("");
                }}
              />
            </label>
            <div className="cw-actions">
              <button disabled={busy} className="project-save">
                {t(busy ? "儲存中…" : "儲存說明")}
              </button>
            </div>
          </form>
          <section
            className="project-settings-knowledge"
            aria-label={t("專案知識")}
          >
            <h3>{t("專案知識")}</h3>
            <p className="cw-muted">
              {t(
                "這個專案的任務共用這些記憶；Bot 建議新增內容時，仍會先請你確認。",
              )}
            </p>
            {loading && <p role="status">{t("載入中…")}</p>}
            {loadError && (
              <div className="project-memory-error">
                <p role="alert">{uiError(loadError)}</p>
                <button onClick={() => setReload((old) => old + 1)}>
                  {t("重新載入記憶")}
                </button>
              </div>
            )}
            {!loading && !loadError && memories.length === 0 && (
              <p className="project-memory-empty">{t("尚無專案記憶。")}</p>
            )}
            {memories.map((m) => (
              <article className="memory" key={m.id}>
                <p>{m.content}</p>
                <div className="project-memory-footer">
                  <small>
                    v{m.revision ?? 1} ·{" "}
                    {t(m.enabled === false ? "已停用" : "使用中")}
                  </small>
                  <button
                    disabled={busy || loading || !!loadError}
                    onClick={(event) => {
                      editTrigger.current = event.currentTarget;
                      setSaved("");
                      setEditing(m);
                    }}
                  >
                    {t("編輯")}
                  </button>
                </div>
              </article>
            ))}
            {!editing && (
              <button
                ref={addTrigger}
                disabled={busy || loading || !!loadError}
                onClick={(event) => {
                  editTrigger.current = event.currentTarget;
                  setSaved("");
                  setEditing({ content: "" });
                }}
              >
                {t("新增專案記憶")}
              </button>
            )}
            {editing && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await api(base + "/memories", "POST", {
                      id: editing.id,
                      revision: editing.revision ?? 1,
                      content: editing.content,
                      enabled: editing.enabled !== false,
                    });
                    setMemories(await api<Memory[]>(base + "/memories"));
                    setEditing(undefined);
                  }, "專案記憶已儲存。");
                }}
              >
                <label>
                  {t("記憶內容")}
                  <textarea
                    disabled={busy}
                    autoFocus
                    required
                    maxLength={4000}
                    value={editing.content || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, content: e.target.value })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={editing.enabled !== false}
                    onChange={(e) =>
                      setEditing({ ...editing, enabled: e.target.checked })
                    }
                  />
                  {t("啟用")}
                </label>
                <div className="cw-actions">
                  <button disabled={busy} className="project-save">
                    {t(busy ? "儲存中…" : "儲存記憶")}
                  </button>
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => setEditing(undefined)}
                  >
                    {t("取消")}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </section>
    </Modal>
  );
}
