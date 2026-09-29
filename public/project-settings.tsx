import React, { useEffect, useState } from "react";
import type { Memory, Project } from "../shared/types.ts";
import { Modal } from "./bot-ui.tsx";

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
  const [saved, setSaved] = useState(false);
  const base = `/projects/${project.id}`;
  useEffect(() => {
    let live = true;
    api<Memory[]>(base + "/memories")
      .then((rows) => {
        if (live) setMemories(rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [base]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await fn();
      await refresh();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="專案設定" close={close}>
      <section className="modal cw-settings-modal">
        <header>
          <h2>{project.name} · 專案設定</h2>
          <button aria-label="關閉專案設定" onClick={close}>
            ×
          </button>
        </header>
        <p className="cw-muted">{project.path}</p>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">已儲存</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(base, "PATCH", { description });
            });
          }}
        >
          <label>
            專案說明
            <textarea
              value={description}
              maxLength={4000}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <button disabled={busy}>儲存說明</button>
        </form>
        <h3>專案知識</h3>
        <p className="cw-muted">
          這個專案的任務共用這些記憶；Bot 建議新增內容時，仍會先請你確認。
        </p>
        {memories.length === 0 && <p>尚無專案記憶。</p>}
        {memories.map((m) => (
          <article className="memory" key={m.id}>
            <p>{m.content}</p>
            <small>
              v{m.revision ?? 1} · {m.enabled === false ? "已停用" : "使用中"}
            </small>
            <button disabled={busy} onClick={() => setEditing(m)}>
              編輯
            </button>
          </article>
        ))}
        {!editing && (
          <button
            onClick={() => {
              setSaved(false);
              setEditing({ content: "" });
            }}
          >
            新增專案記憶
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
              });
            }}
          >
            <label>
              記憶內容
              <textarea
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
                checked={editing.enabled !== false}
                onChange={(e) =>
                  setEditing({ ...editing, enabled: e.target.checked })
                }
              />
              啟用
            </label>
            <div className="cw-actions">
              <button disabled={busy}>儲存記憶</button>
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
            </div>
          </form>
        )}
      </section>
    </Modal>
  );
}
