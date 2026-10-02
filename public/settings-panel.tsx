import { api } from "./chat-api.ts";

import { uiText } from "./settings-dictionary.ts";
import { useEffect, useState, type RefObject } from "react";

import { Modal } from "./bot-ui.tsx";
import type { Snapshot } from "../shared/api.ts";

import { ProviderSettings } from "./provider-settings.tsx";
import { ExecutionSettings } from "./settings-controls.tsx";
import { settingsText as t, useSettingsLocale } from "./settings-locale.ts";

import { Icon } from "./chat-visuals.tsx";

export function Settings({
  state,
  close,
  refresh,
  fallbackFocus,
}: {
  state: Snapshot;
  close: () => void;
  refresh: () => Promise<void>;
  report: (text: string) => void;
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  useSettingsLocale();
  const [tab, setTab] = useState("models");
  const [dirty, setDirty] = useState(false);
  const canLeave = () =>
    !dirty || window.confirm(uiText("捨棄尚未儲存的設定變更？"));
  const guardedClose = () => {
    if (canLeave()) close();
  };
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  return (
    <Modal
      label={t("settings")}
      close={guardedClose}
      fallbackFocus={fallbackFocus}
    >
      <section className="modal settings-modal">
        <header>
          <div>
            <h2>{t("settings")}</h2>
            <p>
              {uiText(
                tab === "general"
                  ? "調整介面語言與執行方式。"
                  : "管理助理使用的模型連線。",
              )}
            </p>
          </div>
          <button
            className="icon"
            aria-label={uiText("關閉設定")}
            onClick={guardedClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-tabs" aria-label={uiText("設定分類")}>
            {[
              ["general", t("general"), "settings"],
              ["models", t("models"), "spark"],
            ].map(([id, label, icon]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                aria-current={tab === id ? "true" : undefined}
                onClick={() => {
                  if (id !== tab && canLeave()) setTab(id);
                }}
              >
                <Icon name={icon} size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div
            className={`settings-content ${tab === "general" ? "settings-general" : tab === "templates" ? "settings-templates" : "settings-models"}`}
          >
            {tab === "general" && (
              <ExecutionSettings
                api={api}
                onDirtyChange={setDirty}
                diagnostics={state.skillDiagnostics}
              />
            )}
            {tab === "models" && (
              <ProviderSettings
                onDirtyChange={setDirty}
                connections={state.connections}
                defaultModel={state.defaultModel}
                bots={state.bots}
                api={api}
                refresh={refresh}
              />
            )}
          </div>
        </div>
      </section>
    </Modal>
  );
}
