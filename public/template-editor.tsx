import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Snapshot } from "../shared/api.ts";
import type { BotTemplate } from "../shared/product.ts";
import { AvatarPicker } from "./avatar-picker.tsx";
import { BrandMark } from "./avatar-mark.tsx";
import { Icon } from "./chat-visuals.tsx";
import { BotAccessFields, PermissionEditor } from "./settings-controls.tsx";
import { settingsText as t, useSettingsLocale } from "./settings-locale.ts";
import { uiText } from "./settings-dictionary.ts";

export function TemplateEditor({
  value,
  change,
  catalog,
  validModel,
  busy,
  save,
  cancel,
  back,
  feedback,
}: {
  value: BotTemplate;
  change: (value: BotTemplate) => void;
  catalog?: Snapshot;
  validModel: boolean;
  busy: boolean;
  save: () => void;
  cancel: () => void;
  back: () => void;
  feedback: ReactNode;
}) {
  useSettingsLocale();
  const name = useRef<HTMLInputElement>(null);
  const modelLabel = useId();
  const [avatarExpanded, setAvatarExpanded] = useState(false);
  useLayoutEffect(() => {
    name.current?.focus();
  }, []);
  return (
    <form
      className="template-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onInvalidCapture={(event) => {
        const target = event.target as HTMLInputElement;
        const disclosure = target.closest("details");
        if (disclosure) disclosure.open = true;
        target.focus();
      }}
    >
      <div className="template-editor-body">
        <button
          type="button"
          className="text-button template-back"
          disabled={busy}
          onClick={back}
        >
          <Icon name="back" size={16} />
          {uiText("返回範本")}
        </button>
        <h3>{uiText("編輯範本")}</h3>
        <p className="field-help">
          {uiText("變更只套用到之後從此範本建立的 Bot。")}
        </p>
        <label>
          {t("name")}
          <input
            ref={name}
            required
            maxLength={80}
            disabled={busy}
            value={value.name}
            onChange={(e) => change({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          {t("description")}
          <textarea
            rows={4}
            maxLength={4000}
            disabled={busy}
            value={value.description}
            onChange={(e) => change({ ...value, description: e.target.value })}
          />
        </label>
        <label>
          <span id={modelLabel}>{t("model")}</span>
          <select
            aria-labelledby={modelLabel}
            disabled={busy}
            value={
              !validModel
                ? "__replacement__"
                : value.connectionId
                  ? JSON.stringify([value.connectionId, value.model])
                  : ""
            }
            onChange={(e) => {
              const [connectionId, model] = e.target.value
                ? (JSON.parse(e.target.value) as string[])
                : [undefined, undefined];
              change({ ...value, connectionId, model });
            }}
          >
            {!validModel && (
              <option disabled value="__replacement__">
                {t("selectModel")}
              </option>
            )}
            <option value="">{t("defaultModel")}</option>
            {catalog?.connections.flatMap((c) =>
              (c.models || [c.model]).map((model) => (
                <option
                  key={`${c.id}:${model}`}
                  value={JSON.stringify([c.id, model])}
                >
                  {c.name} / {c.modelSettings?.[model]?.displayName || model}
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
        <details
          className="profile-disclosure template-avatar-disclosure"
          onToggle={(e) => setAvatarExpanded(e.currentTarget.open)}
        >
          <summary>
            <span className="avatar small">
              <BrandMark avatar={value.avatar} size={26} />
            </span>
            <span>{uiText("Bot 頭像")}</span>
          </summary>
          {avatarExpanded && (
            <AvatarPicker
              value={value.avatar}
              disabled={busy}
              onChange={(avatar) => change({ ...value, avatar })}
            />
          )}
        </details>
        <details className="profile-disclosure template-advanced">
          <summary>{uiText("進階設定")}</summary>
          {catalog && (
            <BotAccessFields
              connectors={catalog.connectors}
              connectorIds={value.connectorIds}
              permissionMode={value.permissionMode}
              disabled={busy}
              onChange={(patch) => change({ ...value, ...patch })}
            />
          )}
          <PermissionEditor
            value={value.permissionRules}
            disabled={busy}
            onChange={(permissionRules) =>
              change({ ...value, permissionRules })
            }
          />
        </details>
      </div>
      <footer className="template-editor-footer">
        {feedback}
        <div className="settings-save-row">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={cancel}
          >
            {t("cancel")}
          </button>
          <button
            className="primary"
            disabled={busy || !value.name.trim() || !validModel}
          >
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </footer>
    </form>
  );
}
