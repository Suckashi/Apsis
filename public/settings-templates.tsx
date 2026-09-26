import { uiText } from "./settings-dictionary.ts";
import React, { useEffect, useState } from "react";
import type { BotTemplate } from "../shared/product.ts";
import {
  BotAccessFields,
  PermissionEditor,
  type SettingsRequest,
} from "./settings-controls.tsx";
import { AvatarPicker } from "./bot-ui.tsx";
import type { ProductService } from "../server/product.ts";
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
  const [catalog, setCatalog] =
    useState<ReturnType<ProductService["snapshot"]>>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<BotTemplate>();
  const [initialDraft, setInitialDraft] = useState("");
  const dirty = !!editing && JSON.stringify(editing) !== initialDraft;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api<BotTemplate[]>("/templates"),
      api<ReturnType<ProductService["snapshot"]>>("/state"),
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
        c.provider !== "codex" &&
        c.id === editing.connectionId &&
        (c.models || [c.model]).includes(editing.model || ""),
    );
  return (
    <section className="template-settings">
      <h3>{t("templates")}</h3>
      <p className="muted">{t("templateHelp")}</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
          <button
            className="text-button"
            disabled={loading || busy}
            onClick={() => setReload((n) => n + 1)}
          >
            {t("retry")}
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : !templates.length && !error ? (
        <p className="empty-section">{t("noTemplates")}</p>
      ) : null}
      <div className="template-list">
        {templates.map((template) => (
          <article className="template-card" key={template.id}>
            {editing?.id === template.id ? (
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () => {
                    const next = await api<BotTemplate>(
                      `/templates/${template.id}`,
                      "PUT",
                      editing,
                    );
                    setTemplates((rows) =>
                      rows.map((row) => (row.id === next.id ? next : row)),
                    );
                    setEditing(undefined);
                    setNotice(t("saved"));
                  });
                }}
              >
                <label>
                  {t("name")}
                  <input
                    required
                    maxLength={80}
                    disabled={busy}
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("description")}
                  <textarea
                    rows={4}
                    maxLength={4000}
                    disabled={busy}
                    value={editing.description}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value })
                    }
                  />
                </label>
                <fieldset disabled={busy}>
                  <AvatarPicker
                    value={editing.avatar}
                    onChange={(avatar) => setEditing({ ...editing, avatar })}
                  />
                </fieldset>
                <label>
                  {t("model")}
                  <select
                    disabled={busy}
                    value={
                      !validModel
                        ? "__replacement__"
                        : editing.connectionId
                          ? JSON.stringify([
                              editing.connectionId,
                              editing.model,
                            ])
                          : ""
                    }
                    onChange={(e) => {
                      const [connectionId, model] = e.target.value
                        ? (JSON.parse(e.target.value) as string[])
                        : [undefined, undefined];
                      setEditing({ ...editing, connectionId, model });
                    }}
                  >
                    {!validModel && (
                      <option disabled value="__replacement__">
                        {t("selectModel")}
                      </option>
                    )}
                    <option value="">{t("defaultModel")}</option>
                    {catalog?.connections
                      .filter((c) => c.provider !== "codex")
                      .flatMap((c) =>
                        (c.models || [c.model]).map((model) => (
                          <option
                            key={`${c.id}:${model}`}
                            value={JSON.stringify([c.id, model])}
                          >
                            {c.name} /{" "}
                            {c.modelSettings?.[model]?.displayName || model}
                          </option>
                        )),
                      )}
                  </select>
                </label>
                {!validModel && (
                  <p role="alert" className="notice">
                    {t("replacement")}
                  </p>
                )}
                {catalog && (
                  <BotAccessFields
                    skills={catalog.skills}
                    connectors={catalog.connectors}
                    skillIds={editing.skillIds}
                    connectorIds={editing.connectorIds}
                    permissionMode={editing.permissionMode}
                    disabled={busy}
                    onChange={(patch) => setEditing({ ...editing, ...patch })}
                  />
                )}
                <PermissionEditor
                  value={editing.permissionRules}
                  disabled={busy}
                  onChange={(permissionRules) =>
                    setEditing({ ...editing, permissionRules })
                  }
                />
                <div className="settings-save-row">
                  <button
                    className="primary"
                    disabled={busy || !editing.name.trim() || !validModel}
                  >
                    {busy ? t("saving") : t("save")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing(undefined)}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <h4>{template.name}</h4>
                <p className="template-description">{template.description}</p>
                <small className="muted">
                  {template.model || t("defaultModel")} ·{" "}
                  {template.skillIds.length} {t("skills")} ·{" "}
                  {template.connectorIds.length} {t("connectors")} ·{" "}
                  {t(
                    template.permissionMode === "readonly"
                      ? "readonly"
                      : "workspace",
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
                    onClick={() => {
                      if (
                        dirty &&
                        !window.confirm(uiText("捨棄尚未儲存的設定變更？"))
                      )
                        return;
                      setInitialDraft(JSON.stringify(template));
                      setEditing({ ...template });
                    }}
                  >
                    {uiText("編輯")}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(template.id)}
                  >
                    {t("remove")}
                  </button>
                </div>
              </>
            )}
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
    </section>
  );
}
