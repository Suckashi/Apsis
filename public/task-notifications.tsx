import React, { useEffect, useRef, useState } from "react";
import type { CodingTask } from "../shared/coding.ts";

const preference = "apsis.task-notifications";
const meaningful: Partial<Record<CodingTask["phase"], string>> = {
  "plan-ready": "計畫等你確認",
  review: "工作已交付，等你 Review",
  blocked: "需要你協助",
  done: "任務已完成",
};

export function useTaskNotifications(
  tasks: CodingTask[] | undefined,
  open: (id: string) => void,
) {
  const previous = useRef<Map<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!tasks) return;
    const next = new Map(
      tasks.map((t) => [t.id, `${t.phase}:${t.replyVersion}`]),
    );
    if (
      previous.current &&
      "Notification" in window &&
      Notification.permission === "granted" &&
      localStorage.getItem(preference) === "on" &&
      document.visibilityState === "hidden"
    ) {
      for (const task of tasks) {
        if (
          !meaningful[task.phase] ||
          previous.current.get(task.id) === next.get(task.id)
        )
          continue;
        const notice = new Notification(meaningful[task.phase]!, {
          body: task.title,
          tag: `apsis-task-${task.id}`,
        });
        notice.onclick = () => {
          window.focus();
          open(task.id);
          notice.close();
        };
      }
    }
    previous.current = next;
  }, [tasks]);
}

export function TaskNotificationSettings() {
  const [enabled, setEnabled] = useState(
    localStorage.getItem(preference) === "on",
  );
  const [message, setMessage] = useState("");
  const available = "Notification" in window && window.isSecureContext;
  return (
    <section className="settings-advanced">
      <h3>任務通知</h3>
      <p>離開頁面時，通知交付、待確認計畫與需要你協助的事件。</p>
      <button
        disabled={!available}
        onClick={async () => {
          try {
            if (enabled) {
              localStorage.removeItem(preference);
              setEnabled(false);
              return;
            }
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              localStorage.setItem(preference, "on");
              setEnabled(true);
              setMessage("");
            } else setMessage("通知未啟用，可在瀏覽器的網站權限中調整。");
          } catch {
            setMessage("此瀏覽器目前無法啟用通知。");
          }
        }}
      >
        {enabled ? "關閉通知" : "啟用通知"}
      </button>
      {(!available || message) && (
        <p role="status">
          {message || "請使用支援通知的瀏覽器，並透過 HTTPS 或本機網址開啟。"}
        </p>
      )}
    </section>
  );
}
