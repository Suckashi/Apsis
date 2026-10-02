import { useEffect, useState } from "react";
import { BrandMark } from "./avatar-mark.tsx";
import { uiText } from "./settings-dictionary.ts";
import { taskText } from "./task-locale.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import type { TaskProgress } from "../shared/task-progress.ts";

/** Motion describes observed state; it is never evidence of continued execution. */
export function AssistantPresence({
  avatar,
  status,
  progress,
  connected,
  background = false,
}: {
  avatar: string;
  status: string;
  progress?: TaskProgress;
  connected: boolean;
  background?: boolean;
}) {
  const locale = useSettingsLocale();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const active = status === "running";
  const stale =
    active &&
    progress?.updatedAt &&
    now - Date.parse(progress.updatedAt) > 60000;
  const state = !connected
    ? "disconnected"
    : progress?.phase === "approval" && active
      ? "approval"
      : stale
        ? "stale"
        : status;
  const label =
    state === "disconnected"
      ? uiText("連線中斷，工作狀態尚未確認")
      : state === "stale"
        ? uiText("尚無新進度，等待更新")
        : state === "approval"
          ? uiText("等待你的核准")
          : active
            ? taskText(locale, progress?.label || "等待模型回應")
            : {
                completed: uiText("已完成"),
                failed: uiText("失敗"),
                interrupted: uiText("工作已中斷"),
                cancelled: uiText("已停止"),
                queued: uiText("排隊中"),
                idle: uiText("準備好了"),
              }[state] || state;
  return (
    <div
      className={`assistant-presence presence-${state}`}
      data-presence={state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="presence-avatar">
        <BrandMark avatar={avatar} size={32} />
      </span>
      <span>
        <small>{background ? uiText("背景工作") : uiText("目前對話")}</small>
        <span>{label}</span>
      </span>
    </div>
  );
}
