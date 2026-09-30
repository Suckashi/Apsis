import { api } from "./chat-api.ts";

import { uiText } from "./settings-dictionary.ts";
import { useEffect, useState } from "react";

import { Modal } from "./bot-ui.tsx";
import type { Snapshot } from "../shared/api.ts";

import { ProviderSettings } from "./provider-settings.tsx";
import { ExecutionSettings } from "./settings-controls.tsx";
import { TemplateSettings } from "./settings-templates.tsx";
import { settingsText as t, useSettingsLocale } from "./settings-locale.ts";

import { Icon } from "./chat-visuals.tsx";

export function Settings({
  state,
  close,
  refresh,
}: {
  state: Snapshot;
  close: () => void;
  refresh: () => Promise<void>;
  report: (text: string) => void;
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
    <Modal label={t("settings")} close={guardedClose}>
      <section className="modal settings-modal">
        <header>
          <div>
            <h2>{t("settings")}</h2>
            <p>{uiText("模型和工具供所有 Bots 使用。")}</p>
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
          <nav className="settings-tabs">
            {[
              ["general", t("general")],
              ["models", t("models")],
              ["templates", t("templates")],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                aria-current={tab === id ? "true" : undefined}
                onClick={() => {
                  if (id !== tab && canLeave()) setTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <>
                <ExecutionSettings api={api} onDirtyChange={setDirty} />

                {!!state.skillDiagnostics?.length && (
                  <details className="settings-advanced">
                    <summary>{uiText("技能載入問題")}</summary>
                    {state.skillDiagnostics.map((issue) => (
                      <p key={issue.path}>
                        {issue.path}：{issue.message}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
            {tab === "templates" && (
              <TemplateSettings
                api={api}
                refresh={refresh}
                onDirtyChange={setDirty}
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
