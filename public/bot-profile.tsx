import { api } from "./chat-api.ts";

import { ModelPicker, connectionModelOptions } from "./model-picker.tsx";

import { uiText } from "./settings-dictionary.ts";
import { useState } from "react";

import { BrandMark, AvatarPicker, Modal } from "./bot-ui.tsx";
import type { Snapshot, BotDetail as Detail } from "../shared/api.ts";

import { BotAccessFields, PermissionEditor } from "./settings-controls.tsx";

import {
  settingsText as t,
  useSettingsLocale,
  getSettingsLocale,
} from "./settings-locale.ts";
import type { PermissionRule } from "../shared/settings.ts";

export function Profile({
  detail,
  state,
  save,
  remove,
}: {
  detail?: Detail;
  state: Snapshot;
  save: (body: unknown) => Promise<void>;
  remove?: () => Promise<void>;
}) {
  useSettingsLocale();
  const needsReplacement =
    !!detail?.bot.connectionId &&
    !state.connections.some((c) => c.id === detail.bot.connectionId);
  const [name, setName] = useState(detail?.bot.name || "");
  const [description, setDescription] = useState(detail?.bot.description || "");
  const [model, setModel] = useState(
    needsReplacement
      ? "__replacement__"
      : detail?.bot.connectionId
        ? JSON.stringify([detail.bot.connectionId, detail.bot.model])
        : "",
  );
  const [avatar, setAvatar] = useState(
    detail?.bot.avatar && detail.bot.avatar !== "✳"
      ? detail.bot.avatar
      : "orbit",
  );
  const [saving, setSaving] = useState(false);
  const [avatarExpanded, setAvatarExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [access, setAccess] = useState({
    connectorIds:
      detail?.bot.connectorIds ??
      state.connectors
        .filter((connector) => connector.enabled)
        .map((connector) => connector.id),
    permissionMode:
      detail?.bot.permissionMode ?? ("workspace" as "workspace" | "readonly"),
  });
  const [permissionRules, setPermissionRules] = useState<PermissionRule[]>(
    detail?.bot.permissionRules ?? [],
  );
  const commit = async (body: unknown) => {
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      await save(body);
      setNotice(t("saved"));
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (model === "__replacement__") return;
        const [connectionId, modelName] = model
          ? (JSON.parse(model) as string[])
          : ["", ""];
        void commit({
          name,
          description,
          avatar,
          connectionId: connectionId || "",
          model: modelName,
          ...access,
          permissionRules,
        });
      }}
    >
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <label>
        {t("name")}
        <input
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="compose-option-field">
        <span>{t("model")}</span>
        <ModelPicker
          label={t("model")}
          value={model}
          onChange={setModel}
          disabled={saving}
          placeholder={t("selectModel")}
          options={[
            { value: "", label: t("defaultModel") },
            ...connectionModelOptions(state.connections),
          ]}
        />
      </div>
      {needsReplacement && (
        <p className="notice" role="alert">
          {t("replacement")}
        </p>
      )}
      <label>
        {t("description")}
        <textarea
          rows={3}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={uiText(
            "例如：你是我的秘書，依其他 Bot 的角色派工，收到結果後整理回覆給我。",
          )}
        />
      </label>
      <details
        className="profile-disclosure profile-avatar-disclosure"
        onToggle={(event) => setAvatarExpanded(event.currentTarget.open)}
      >
        <summary>
          <span className="avatar small">
            <BrandMark size={26} avatar={avatar} />
          </span>
          <span>
            {getSettingsLocale() === "en"
              ? "Icon and avatar collection"
              : "圖示與頭像收藏"}
          </span>
        </summary>
        {avatarExpanded && <AvatarPicker value={avatar} onChange={setAvatar} />}
      </details>
      <details className="profile-disclosure profile-advanced">
        <summary>
          {getSettingsLocale() === "en" ? "Advanced settings" : "進階設定"}
        </summary>
        <BotAccessFields
          connectors={state.connectors}
          {...access}
          disabled={saving}
          onChange={(patch) => setAccess((old) => ({ ...old, ...patch }))}
        />
        <PermissionEditor
          value={permissionRules}
          onChange={setPermissionRules}
          botId={detail?.bot.id}
          disabled={saving}
        />
      </details>
      <button
        className="primary"
        type="submit"
        disabled={saving || !name.trim() || model === "__replacement__"}
      >
        {saving ? t("saving") : detail ? t("save") : t("createBot")}
      </button>
      {detail && (
        <button
          type="button"
          className="secondary"
          disabled={saving || !name.trim() || model === "__replacement__"}
          onClick={async () => {
            setSaving(true);
            setNotice("");
            try {
              const [connectionId, modelName] = model
                ? (JSON.parse(model) as string[])
                : ["", ""];
              await api("/templates", "POST", {
                name,
                description,
                avatar,
                ...(connectionId ? { connectionId, model: modelName } : {}),
                ...access,
                permissionRules,
              });
              setNotice(t("templateSaved"));
            } catch (error) {
              setNotice((error as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("saveTemplate")}
        </button>
      )}
      {detail && (
        <div className="profile-options">
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ pinned: !detail.bot.pinned })}
          >
            {detail.bot.pinned ? uiText("取消釘選") : uiText("釘選 Bot")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ hidden: !detail.bot.hidden })}
          >
            {detail.bot.hidden ? uiText("顯示 Bot") : uiText("隱藏 Bot")}
          </button>
          <small>{uiText("隱藏不會暫停排程。")}</small>
          {remove && (
            <button
              type="button"
              className="delete-bot"
              disabled={saving}
              onClick={() => {
                setDeleteError("");
                setConfirmDelete(true);
              }}
            >
              {uiText("刪除 Bot")}
            </button>
          )}
        </div>
      )}
      {confirmDelete && detail && remove && (
        <Modal
          label={uiText("刪除 Bot")}
          close={() => {
            if (!deleting) setConfirmDelete(false);
          }}
        >
          <section className="modal bot-delete-modal">
            <header>
              <h2>{uiText("刪除「{0}」？", [detail.bot.name])}</h2>
            </header>
            <div className="delete-body">
              <p>
                {uiText(
                  "此操作無法復原。將停止這位 Bot 的工作，刪除對話、專屬記憶與技能、排程、草稿、核准規則，以及附件與成果清單。",
                )}
              </p>
              <p>
                {uiText(
                  "工作區實體檔案與執行日誌會保留；已完成的外部操作不會撤銷。",
                )}
              </p>
              {deleteError && (
                <p role="alert" className="notice">
                  {deleteError}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  className="secondary"
                  autoFocus
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  {uiText("取消")}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={deleting}
                  onClick={async () => {
                    if (deleting) return;
                    setDeleting(true);
                    setDeleteError("");
                    try {
                      await remove();
                    } catch (error) {
                      setDeleteError((error as Error).message);
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? uiText("停止回覆並刪除中…") : uiText("確認刪除")}
                </button>
              </footer>
            </div>
          </section>
        </Modal>
      )}
    </form>
  );
}
