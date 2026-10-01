import { useEffect, useRef, useState } from "react";
import type { BotDetail } from "../shared/api.ts";
import { uiText } from "./settings-dictionary.ts";
import { taskText, taskWarning } from "./task-locale.ts";
import { useSettingsLocale } from "./settings-locale.ts";

/** Announce a newly arrived reply, never initial history, pagination or streaming chunks. */
export function ReplyAnnouncement({
  selected,
  detail,
}: {
  selected: string | null;
  detail?: BotDetail;
}) {
  const locale = useSettingsLocale();
  const seen = useRef<{ botId: string; sequence: number } | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState<{
    id: string;
    bot: string;
    outcome: string;
    warning?: string;
  }>();
  const latest = detail?.session.messages.findLast(
    (message) => message.role === "assistant",
  );
  const sequence = latest?.sequence || 0;
  const summary = detail?.runSummaries.find((run) => run.id === latest?.runId);
  const status = summary?.status;
  const warning = summary?.warning;
  const botId = detail?.bot.id;
  const botName = detail?.bot.name;
  const messageId = latest?.id;
  const failed = latest?.status === "error";
  const separator = locale === "en" ? ". " : "。";
  useEffect(() => {
    if (!selected || botId !== selected) {
      seen.current = undefined;
      setNotice(undefined);
      return;
    }
    if (!seen.current || seen.current.botId !== botId) {
      seen.current = { botId, sequence };
      setNotice(undefined);
      return;
    }
    if (sequence <= seen.current.sequence || !messageId) return;
    seen.current.sequence = sequence;
    const outcome =
      status === "cancelled"
        ? "已停止執行"
        : status === "interrupted"
          ? "這次執行已中斷"
          : failed || status === "failed"
            ? "這次執行未完成"
            : "已收到新的回覆";
    setNotice({ id: messageId, bot: botName || "Bot", outcome, warning });
  }, [selected, botId, botName, sequence, messageId, status, failed, warning]);
  return (
    <div
      className="visually-hidden reply-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {notice && (
        <span key={notice.id}>
          {notice.bot}
          {locale === "en" ? ": " : "："}
          {taskText(locale, notice.outcome)}
          {separator}
          {notice.warning &&
            `${taskWarning(locale, notice.warning)}${separator}`}
          {uiText("可在對話中檢閱結果。")}
        </span>
      )}
    </div>
  );
}
