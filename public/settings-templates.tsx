import { uiText } from "./settings-dictionary.ts";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
import type { BotTemplate } from "../shared/product.ts";
import type { Snapshot } from "../shared/api.ts";
import type { SettingsRequest } from "./settings-controls.tsx";
import { BrandMark } from "./avatar-mark.tsx";
import { TemplateEditor } from "./template-editor.tsx";
import { settingsText as t, useSettingsLocale } from "./settings-locale.ts";

export function TemplateSettings({
  api,
  refresh,
  onDirtyChange,
}: {
  api: SettingsRequest;
  refresh: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  useSettingsLocale();
  const [templates, setTemplates] = useState<BotTemplate[]>([]);
  const [catalog, setCatalog] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BotTemplate>();
  const [initialDraft, setInitialDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const dirty = !!editing && JSON.stringify(editing) !== initialDraft;
  const section = useRef<HTMLElement>(null);
  const returnFocus = useRef("");
  const deleteFocus = useRef("");
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (!editing && returnFocus.current) {
      section.current
        ?.querySelector<HTMLButtonElement>(
          `button[data-edit-template="${CSS.escape(returnFocus.current)}"]`,
        )
        ?.focus();
      returnFocus.current = "";
    } else if (!editing && !confirmDelete && deleteFocus.current) {
      const target = section.current?.querySelector<HTMLButtonElement>(
        `button[data-remove-template="${CSS.escape(deleteFocus.current)}"]`,
      );
      (target || section.current?.querySelector<HTMLElement>("h3"))?.focus();
      deleteFocus.current = "";
    }
  }, [editing?.id, confirmDelete]);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api<BotTemplate[]>("/templates"),
      api<Snapshot>("/state"),
    ])
      .then(([rows, state]) => {
        if (!cancelled) {
          setTemplates(rows);
          setCatalog(state);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, reload]);
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const validModel =
    !editing?.connectionId ||
    !!catalog?.connections.some(
      (c) =>
        c.id === editing.connectionId &&
        (c.models || [c.model]).includes(editing.model || ""),
    );
  const feedback = (
    <>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p
          className="notice"
          role="alert"
          tabIndex={0}
          aria-label={uiText("範本設定錯誤")}
        >
          {error}
          <button
            type="button"
            className="text-button"
            disabled={loading || busy}
            onClick={() => setReload((n) => n + 1)}
          >
            {t("retry")}
          </button>
        </p>
      )}
    </>
  );
  return (
    <section className="template-settings" ref={section}>
      {editing ? (
        <TemplateEditor
          key={editing.id}
          value={editing}
          change={setEditing}
          catalog={catalog}
          validModel={validModel}
          busy={busy}
          feedback={feedback}
          cancel={() => {
            setError("");
            setNotice("");
            setEditing(undefined);
          }}
          back={() => {
            if (!dirty || window.confirm(uiText("捨棄尚未儲存的設定變更？"))) {
              setError("");
              setNotice("");
              setEditing(undefined);
            }
          }}
          save={() =>
            void perform(async () => {
              const { id: _id, ...request } = editing;
              const next = await api<BotTemplate>(
                `/templates/${editing.id}`,
                "PUT",
                request,
              );
              setTemplates((rows) =>
                rows.map((row) => (row.id === next.id ? next : row)),
              );
              setEditing(undefined);
              setNotice(t("saved"));
            })
          }
        />
      ) : (
        <div className="template-settings-body">
          <h3 tabIndex={-1}>{t("templates")}</h3>
          <p className="muted">{t("templateHelp")}</p>
          {feedback}
          {loading ? (
            <p role="status">{t("loading")}</p>
          ) : !templates.length && !error ? (
            <p className="empty-section">{t("noTemplates")}</p>
          ) : null}
          <div className="template-list">
            {templates.map((template) => (
              <article className="template-card" key={template.id}>
                <div className="template-card-heading">
                  <span className="avatar">
                    <BrandMark avatar={template.avatar} size={30} />
                  </span>
                  <h4>{template.name}</h4>
                </div>
                <p className="template-description">{template.description}</p>
                <small className="muted">
                  {template.model || t("defaultModel")} ·{" "}
                  {t(
                    template.permissionMode === "readonly"
                      ? "readonly"
                      : "workspace",
                  )}
                  {template.connectorIds.length > 0 && (
                    <>
                      {" "}
                      · {template.connectorIds.length} {t("connectors")}
                    </>
                  )}
                </small>
                <div className="settings-save-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api("/bots", "POST", { templateId: template.id });
                        setNotice(t("templateCreated"));
                        await refresh();
                      })
                    }
                  >
                    {t("createBot")}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    data-edit-template={template.id}
                    onClick={() => {
                      returnFocus.current = template.id;
                      deleteFocus.current = "";
                      setInitialDraft(JSON.stringify(template));
                      setEditing({ ...template });
                      setNotice("");
                      setError("");
                      setConfirmDelete("");
                    }}
                  >
                    {uiText("編輯")}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    data-remove-template={template.id}
                    onClick={() => {
                      deleteFocus.current = template.id;
                      setConfirmDelete(template.id);
                    }}
                  >
                    {t("remove")}
                  </button>
                </div>
                {confirmDelete === template.id && (
                  <div className="notice">
                    <p>{uiText("移除此範本？既有 Bot 將保留。")}</p>
                    <div className="settings-save-row">
                      <button
                        className="danger-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api(`/templates/${template.id}`, "DELETE");
                            setTemplates((rows) =>
                              rows.filter((row) => row.id !== template.id),
                            );
                            setConfirmDelete("");
                          })
                        }
                      >
                        {t("remove")}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setConfirmDelete("")}
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
