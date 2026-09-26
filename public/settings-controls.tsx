import {
  ApprovalModeHelp,
  ApprovalModePicker,
} from "./approval-mode-picker.tsx";
import { uiText } from "./settings-dictionary.ts";
import React, { useEffect, useId, useState } from "react";
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  type Settings,
  type PermissionRule,
} from "../shared/settings.ts";
import {
  setSettingsLocale,
  settingsText as t,
  useSettingsLocale,
} from "./settings-locale.ts";

export type SettingsRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
const labels = {
  maxTurns: ["每次任務的回合上限", "Maximum turns per task"],
  taskTimeoutMs: ["任務逾時（秒）", "Task timeout (seconds)"],
  shellTimeoutSeconds: ["命令逾時（秒）", "Command timeout (seconds)"],
  outputLimit: ["工具輸出字元上限", "Tool output character limit"],
  maxDelegationDepth: ["派工層數上限", "Maximum delegation depth"],
  maxDelegatedJobs: ["派工數量上限", "Maximum delegated jobs"],
  maxConcurrent: ["同時執行數量", "Concurrent tasks"],
} as const;

export function PermissionEditor({
  value,
  onChange,
  botId,
  disabled = false,
}: {
  value: readonly PermissionRule[];
  onChange: (rules: PermissionRule[]) => void;
  botId?: string;
  disabled?: boolean;
}) {
  useSettingsLocale();
  const update = (id: string, patch: Partial<PermissionRule>) =>
    onChange(
      value.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  return (
    <fieldset className="permission-editor" disabled={disabled}>
      <legend>{t("permissions")}</legend>
      <p className="field-help">
        {uiText(
          "工具名稱需完全符合，或使用 *。路徑相對於工作區，包含子目錄。拒絕規則優先。",
        )}
      </p>
      {value.length === 0 && <p className="muted">{t("noRules")}</p>}
      {value.map((rule, index) => (
        <div className="permission-rule" key={rule.id}>
          <div className="settings-fields">
            <label>
              {uiText("工具")}
              <input
                required
                pattern={"\\*|[^*?\\s]+"}
                maxLength={200}
                value={rule.tool}
                onChange={(e) =>
                  update(rule.id, {
                    tool: e.target.value,
                    commandPattern:
                      e.target.value === "shell"
                        ? rule.commandPattern
                        : undefined,
                  })
                }
                placeholder="read_file"
              />
            </label>
            <label>
              {uiText("處理方式")}
              <select
                value={rule.effect}
                onChange={(e) =>
                  update(rule.id, {
                    effect: e.target.value as PermissionRule["effect"],
                  })
                }
              >
                <option value="ask">{uiText("詢問核准")}</option>
                <option value="deny">{uiText("拒絕")}</option>
                <option value="allow">{uiText("允許")}</option>
              </select>
            </label>
            <label>
              {uiText("路徑（選填）")}
              <input
                value={rule.path || ""}
                onChange={(e) =>
                  update(rule.id, { path: e.target.value || undefined })
                }
                placeholder="reports"
              />
            </label>
            <label>
              {uiText("目標 Bot ID（選填）")}
              <input
                value={rule.targetBotId || ""}
                onChange={(e) =>
                  update(rule.id, { targetBotId: e.target.value || undefined })
                }
              />
            </label>
            {rule.tool === "shell" && (
              <label>
                {uiText("完整命令 glob（選填）")}
                <input
                  value={rule.commandPattern || ""}
                  maxLength={16000}
                  onChange={(e) =>
                    update(rule.id, {
                      commandPattern: e.target.value || undefined,
                    })
                  }
                  placeholder="npm run *"
                />
                <small className="field-help">
                  {uiText("* 比對任意字元，? 比對單一字元；比對整條命令。")}
                </small>
              </label>
            )}
          </div>
          <button
            type="button"
            className="text-button"
            aria-label={`${t("remove")} ${index + 1}`}
            onClick={() => onChange(value.filter((r) => r.id !== rule.id))}
          >
            {t("remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              scope: botId ? "bot" : "global",
              ...(botId ? { botId } : {}),
              tool: "",
              effect: "ask",
            },
          ])
        }
      >
        {t("addRule")}
      </button>
    </fieldset>
  );
}

export function ExecutionSettings({
  api,
  onDirtyChange,
}: {
  api: SettingsRequest;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const locale = useSettingsLocale();
  const [saved, setSaved] = useState<Settings>();
  const [draft, setDraft] = useState<Settings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const errorId = useId();
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void api<Settings>("/settings")
      .then((value) => {
        if (cancelled) return;
        setDraft(value);
        setSaved(value);
        setError("");
        setConflict(false);
        setSettingsLocale(value.locale);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, reload]);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return (
    <section className="execution-settings">
      <h3>{t("execution")}</h3>
      <p className="muted">{t("executionHelp")}</p>
      {error && (
        <div className="notice" id={errorId} role="alert">
          {error}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!draft ? (
        <p role="status">{busy ? t("loading") : ""}</p>
      ) : (
        <form
          className="settings-form"
          onInvalidCapture={(event) => {
            const details = (event.target as HTMLElement).closest("details");
            if (details) details.open = true;
          }}
          aria-describedby={error ? errorId : undefined}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !dirty || conflict) return;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const next = await api<Settings>("/settings", "PATCH", draft);
              setSaved(next);
              setDraft(next);
              setSettingsLocale(next.locale);
              setNotice(t("saved"));
            } catch (reason) {
              const isConflict = (reason as { status?: number }).status === 409;
              setConflict(isConflict);
              setError(isConflict ? t("conflict") : (reason as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              {t("locale")}
              <select
                value={draft.locale}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    locale: e.target.value as Settings["locale"],
                  })
                }
              >
                <option value="zh-Hant">繁體中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="settings-mode-field">
              <h3>{uiText("工具核准模式")}</h3>
              <ApprovalModePicker
                label={uiText("工具核准模式")}
                value={draft.approvalMode}
                disabled={busy}
                onChange={(approvalMode) =>
                  setDraft({ ...draft, approvalMode })
                }
              />
              <ApprovalModeHelp />
            </div>
            {(
              [
                {
                  title: uiText("任務執行"),
                  keys: [
                    "maxTurns",
                    "taskTimeoutMs",
                    "shellTimeoutSeconds",
                    "outputLimit",
                  ],
                },
                {
                  title: uiText("Bot 協作"),
                  keys: [
                    "maxDelegationDepth",
                    "maxDelegatedJobs",
                    "maxConcurrent",
                  ],
                },
              ] as const
            ).map((group) => (
              <fieldset className="execution-group" key={group.title}>
                <legend>{group.title}</legend>
                <div className="settings-fields">
                  {group.keys.map((key) => {
                    const factor = key === "taskTimeoutMs" ? 1000 : 1;
                    return (
                      <label key={key}>
                        {labels[key][locale === "en" ? 1 : 0]}
                        <input
                          type="number"
                          required
                          step={key === "taskTimeoutMs" ? 0.001 : 1}
                          min={SETTINGS_BOUNDS[key][0] / factor}
                          max={SETTINGS_BOUNDS[key][1] / factor}
                          value={
                            Number.isNaN(draft[key]) ? "" : draft[key] / factor
                          }
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [key]:
                                key === "taskTimeoutMs"
                                  ? Math.round(e.target.valueAsNumber * factor)
                                  : e.target.valueAsNumber,
                            })
                          }
                        />
                        <small className="field-help">
                          {SETTINGS_BOUNDS[key][0] / factor}–
                          {SETTINGS_BOUNDS[key][1] / factor}
                        </small>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </fieldset>
          <details className="settings-advanced">
            <summary>{t("permissions")}</summary>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.dangerousCommandGuard}
                disabled={busy || draft.approvalMode === "auto"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    dangerousCommandGuard: e.target.checked,
                  })
                }
              />
              {uiText("危險命令確認（不要求核准模式不適用）")}
            </label>
            <PermissionEditor
              value={draft.permissionRules}
              onChange={(permissionRules) =>
                setDraft({ ...draft, permissionRules })
              }
              disabled={busy}
            />
          </details>
          <div className="settings-save-row">
            <button className="primary" disabled={busy || !dirty || conflict}>
              {busy ? t("saving") : t("save")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(saved);
                setNotice("");
              }}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || conflict}
              onClick={() => {
                setDraft({ ...DEFAULT_SETTINGS, revision: draft.revision });
                setNotice("");
              }}
            >
              {uiText("重設為預設值")}
            </button>
            <span className="muted" role="status">
              {dirty ? t("unsaved") : ""}
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

export function BotAccessFields({
  skills,
  connectors,
  skillIds,
  connectorIds,
  permissionMode,
  onChange,
  disabled,
}: {
  skills: { id: string; name: string }[];
  connectors: { id: string; name: string; enabled: boolean }[];
  skillIds: string[];
  connectorIds: string[];
  permissionMode: "workspace" | "readonly";
  onChange: (patch: {
    skillIds?: string[];
    connectorIds?: string[];
    permissionMode?: "workspace" | "readonly";
  }) => void;
  disabled?: boolean;
}) {
  useSettingsLocale();
  return (
    <fieldset className="bot-access-fields" disabled={disabled}>
      <legend>{t("permissions")}</legend>
      <label>
        {t("mode")}
        <select
          value={permissionMode}
          onChange={(e) =>
            onChange({
              permissionMode: e.target.value as "workspace" | "readonly",
            })
          }
        >
          <option value="workspace">{t("workspace")}</option>
          <option value="readonly">{t("readonly")}</option>
        </select>
        <small className="field-help">{t("accessHelp")}</small>
      </label>
      {(
        [
          {
            title: t("selectedSkills"),
            empty: t("noSkills"),
            items: skills,
            selected: skillIds,
            key: "skillIds",
          },
          {
            title: t("selectedConnectors"),
            empty: t("noConnectors"),
            items: connectors,
            selected: connectorIds,
            key: "connectorIds",
          },
        ] as const
      ).map((group) => (
        <fieldset key={group.key} className="settings-checklist">
          <legend>{group.title}</legend>
          <small className="field-help">{t("noneSelected")}</small>
          {!group.items.length && <p className="muted">{group.empty}</p>}
          {group.items.map((item) => (
            <label className="settings-check" key={item.id}>
              <input
                type="checkbox"
                checked={group.selected.includes(item.id)}
                onChange={(e) =>
                  onChange({
                    [group.key]: e.target.checked
                      ? [...group.selected, item.id]
                      : group.selected.filter((id) => id !== item.id),
                  })
                }
              />
              <span>
                {item.name}
                {"enabled" in item && !item.enabled
                  ? ` · ${t("disabled")}`
                  : ""}
              </span>
            </label>
          ))}
          {group.selected
            .filter((id) => !group.items.some((item) => item.id === id))
            .map((id) => (
              <label className="settings-check" key={id}>
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    onChange({
                      [group.key]: group.selected.filter(
                        (selected) => selected !== id,
                      ),
                    })
                  }
                />
                <span>
                  {id} · {uiText("已不存在")}
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </fieldset>
  );
}
