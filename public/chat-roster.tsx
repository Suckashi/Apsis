import { BrandMark } from "./bot-ui.tsx";
import { uiText } from "./settings-dictionary.ts";
import { getSettingsLocale } from "./settings-locale.ts";
import type { ProductService } from "../server/product.ts";
const time = (at: string) => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const daysAgo = Math.round((day(now) - day(date)) / 86_400_000);
  if (daysAgo === 0)
    return date.toLocaleTimeString(getSettingsLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  if (daysAgo === 1) return uiText("昨天");
  if (daysAgo > 1 && daysAgo < 7)
    return date.toLocaleDateString(getSettingsLocale(), { weekday: "short" });
  return date.toLocaleDateString(getSettingsLocale(), {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
  });
};
const chatPreview = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

export function ChatRoster({
  bots,
  selected,
  select,
  hidden,
  query,
}: {
  bots: ReturnType<ProductService["snapshot"]>["bots"];
  selected: string | null;
  select: (id: string) => void;
  hidden: boolean;
  query: string;
}) {
  return (
    <nav className="roster" aria-label={uiText("Bot 名單")}>
      {bots.map((b) => {
        const preview =
          b.status === "waiting"
            ? uiText("等待你的核准")
            : b.status === "working"
              ? uiText("正在處理…")
              : b.status === "error"
                ? `${uiText("處理失敗")} · ${chatPreview(b.lastMessage)}`
                : chatPreview(b.lastMessage);
        return (
          <div className="bot-entry" key={b.id}>
            <button
              aria-current={selected === b.id ? "page" : undefined}
              title={b.name}
              className={`bot-row ${selected === b.id ? "selected" : ""} ${b.unread ? "has-unread" : ""} status-${b.status}`}
              onClick={() => select(b.id)}
            >
              <span className={`avatar tone-${b.id.charCodeAt(0) % 4}`}>
                <BrandMark size={24} avatar={b.avatar} />
                <i className={b.status} />
              </span>
              <span className="bot-summary">
                <span className="bot-line">
                  <span className="bot-name">
                    <strong>{b.name}</strong>
                    {b.pinned && (
                      <span className="pin" title={uiText("已釘選")}>
                        <span aria-hidden="true">•</span>
                        <span className="visually-hidden">
                          {uiText("已釘選")}
                        </span>
                      </span>
                    )}
                  </span>
                  <time dateTime={b.updatedAt}>{time(b.updatedAt)}</time>
                </span>
                <span className="bot-preview-line">
                  <span className="preview" title={preview}>
                    {preview}
                  </span>
                </span>
              </span>
            </button>
          </div>
        );
      })}
      {!bots.length && (
        <p className="roster-empty">
          {query
            ? uiText("找不到符合的 Bot")
            : hidden
              ? uiText("沒有隱藏的 Bot")
              : uiText("為你的工作新增一位幫手。")}
        </p>
      )}
    </nav>
  );
}
