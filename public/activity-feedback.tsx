import React from "react";
import { useSettingsLocale } from "./settings-locale.ts";
import { taskText } from "./task-locale.ts";

// Decorative movement always has a visible text equivalent alongside it.
export function ActivityMark({ state = "working" }: { state?: string }) {
  return (
    <span className={`activity-mark is-${state}`} aria-hidden="true">
      {state === "approval" || state === "queued" ? (
        <svg viewBox="0 0 20 20">
          <path d="M7 5v10M13 5v10" />
        </svg>
      ) : state === "completed" ? (
        <svg viewBox="0 0 20 20">
          <path d="m4 10 4 4 8-8" />
        </svg>
      ) : ["failed", "interrupted", "cancelled", "disconnected"].includes(
          state,
        ) ? (
        <svg viewBox="0 0 20 20">
          <path d="M10 4v7m0 4v1" />
        </svg>
      ) : (
        <span className="activity-orbit" />
      )}
    </span>
  );
}

export function ActionFeedback({
  label,
  pending = false,
}: {
  label: string;
  pending?: boolean;
}) {
  const locale = useSettingsLocale();
  return (
    <div className="action-feedback" role="status">
      <ActivityMark state={pending ? "working" : "completed"} />
      <span>{taskText(locale, label)}</span>
    </div>
  );
}

export function ConversationLoading() {
  const locale = useSettingsLocale();
  return (
    <div
      className="conversation-loading"
      aria-label={taskText(locale, "正在載入對話")}
    >
      <ActionFeedback label="正在載入對話" pending />
      <div className="conversation-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
