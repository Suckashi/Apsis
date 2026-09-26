import {
  ApprovalModeHelp,
  ApprovalModeIcon,
  ApprovalModePicker,
  approvalModes,
} from "./approval-mode-picker.tsx";
import { ComposerPopover } from "./composer-popover.tsx";
import React, { useId, useRef, useState } from "react";
import type { ApprovalMode, Settings } from "../shared/settings.ts";
import type { SettingsRequest } from "./settings-controls.tsx";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export function ApprovalModeControl({
  settings,
  api,
  onSaved,
  onReload,
}: {
  settings?: Settings;
  api: SettingsRequest;
  onSaved: (settings: Settings) => void;
  onReload: () => Promise<void>;
}) {
  useSettingsLocale();
  const id = useId();
  const saving = useRef(false);
  const popover = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <div className="approval-mode-control" data-mode={settings?.approvalMode}>
      <ComposerPopover
        detailsRef={popover}
        className={settings ? `mode-${settings.approvalMode}` : ""}
        label={
          <>
            {settings && <ApprovalModeIcon mode={settings.approvalMode} />}
            {!settings
              ? uiText("載入中…")
              : busy
                ? uiText("儲存中…")
                : uiText(
                    approvalModes.find(
                      (mode) => mode.value === settings.approvalMode,
                    )!.label,
                  )}
            <span aria-hidden="true"> ▾</span>
          </>
        }
      >
        <ApprovalModePicker
          label={uiText("對話核准模式")}
          describedBy={id + "-scope"}
          disabled={!settings || busy}
          value={settings?.approvalMode}
          onChange={async (approvalMode: ApprovalMode) => {
            if (!settings || saving.current) return;
            const close = () => {
              if (!popover.current?.open) return;
              const restoreFocus =
                popover.current.contains(document.activeElement) ||
                document.activeElement === document.body;
              popover.current.open = false;
              if (restoreFocus)
                popover.current.querySelector("summary")?.focus();
            };
            if (approvalMode === settings.approvalMode) {
              close();
              return;
            }
            saving.current = true;
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const next = await api<Settings>("/settings", "PATCH", {
                revision: settings.revision,
                approvalMode,
              });
              onSaved(next);
              close();
              setNotice(uiText("已切換，下次工具操作生效。"));
            } catch (reason) {
              setError(
                (reason as { status?: number }).status === 409
                  ? uiText("設定已變更，已重新讀取，請再次選擇模式。")
                  : (reason as Error).message,
              );
              await onReload().catch(() => {});
            } finally {
              saving.current = false;
              setBusy(false);
            }
          }}
        />
        <p id={`${id}-scope`} className="approval-mode-scope">
          {uiText("所有 Bot · 下次操作生效")}
        </p>
        <ApprovalModeHelp />
      </ComposerPopover>
      <span role="status" className="visually-hidden">
        {busy ? uiText("儲存中…") : notice}
      </span>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
