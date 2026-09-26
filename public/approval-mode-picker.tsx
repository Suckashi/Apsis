import React, { useId } from "react";
import type { ApprovalMode } from "../shared/settings.ts";
import { uiText } from "./settings-dictionary.ts";

export const approvalModes = [
  {
    value: "manual",
    label: "一般核准",
    description: "唯讀及符合條件的 Git 工作區寫入自動放行，其他操作要求核准。",
  },
  {
    value: "yolo",
    label: "需要時詢問",
    description:
      "一般操作直接執行；命中危險、敏感路徑或詢問規則時要求核准。無法分析的命令也會放行。",
  },
  {
    value: "auto",
    label: "不要求核准",
    description: "除明確禁止與硬性權限外自動放行，包括危險命令。",
  },
] as const;

export function ApprovalModeIcon({ mode }: { mode: ApprovalMode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === "auto" ? (
        <path d="m13 3-8 10h6l-1 8 9-12h-7z" />
      ) : (
        <>
          <path d="M12 3 4 6v6c0 4 4 7 8 9 4-2 8-5 8-9V6z" />
          {mode === "yolo" && (
            <>
              <path d="M10 9a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3" />
              <path d="M12 15h.01" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

export function ApprovalModePicker({
  value,
  disabled = false,
  label,
  describedBy,
  onChange,
}: {
  value?: ApprovalMode;
  disabled?: boolean;
  label: string;
  describedBy?: string;
  onChange: (mode: ApprovalMode) => void;
}) {
  return (
    <div
      className="approval-mode-picker"
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      onKeyDown={(event) => {
        const keys = [
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ];
        if (!keys.includes(event.key)) return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const current = items.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (current +
                  (event.key === "ArrowUp" || event.key === "ArrowLeft"
                    ? -1
                    : 1) +
                  items.length) %
                items.length;
        // Move focus first; Enter/Space commits an explicit permission change.
        items[next]?.focus();
      }}
    >
      {approvalModes.map((mode, index) => (
        <button
          key={mode.value}
          type="button"
          role="radio"
          className={`approval-mode-option mode-${mode.value}`}
          aria-checked={value === mode.value}
          data-mode={mode.value}
          tabIndex={value === mode.value || (!value && index === 0) ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(mode.value)}
        >
          <ApprovalModeIcon mode={mode.value} />
          <span>{uiText(mode.label)}</span>
          {value === mode.value && (
            <svg
              className="mode-check"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m5 12 4 4L19 6" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

export function ApprovalModeHelp() {
  const id = useId();
  return (
    <details className="approval-mode-details">
      <summary aria-controls={id}>{uiText("模式說明")}</summary>
      <dl id={id}>
        {approvalModes.map((mode) => (
          <React.Fragment key={mode.value}>
            <dt>{uiText(mode.label)}</dt>
            <dd>{uiText(mode.description)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  );
}
