import { memo, useId, useMemo, useRef, useState } from "react";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function overview(text: string) {
  let count = 0,
    prefix = "";
  for (const { segment } of segments.segment(text)) {
    if (count < 160) prefix += segment;
    if (++count > 320) break;
  }
  return {
    long: count > 320 || text.split("\n", 9).length > 8,
    excerpt: prefix.replace(/\s+/g, " ").trim() + (count > 160 ? "…" : ""),
  };
}

/** Native disclosure preserves the original Markdown, links and copy payload. */
export const UserMessageText = memo(function UserMessageText({
  text,
  storageKey,
  initiallyOpen,
  syncReadingPosition,
}: {
  text: string;
  storageKey: string;
  initiallyOpen: boolean;
  syncReadingPosition: () => void;
}) {
  useSettingsLocale();
  const preview = useMemo(() => overview(text), [text]);
  const [expanded, setExpanded] = useState(() => {
    if (!preview.long) return false;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved === "true" || saved === "false") return saved === "true";
    } catch {
      /* The current view still works without storage. */
    }
    return initiallyOpen;
  });
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const excerptId = useId();
  if (!preview.long) return <Markdown text={text} />;
  return (
    <details
      className="request-disclosure"
      ref={details}
      open={expanded}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === expanded) return;
        setExpanded(next);
        try {
          sessionStorage.setItem(storageKey, String(next));
        } catch {
          /* Optional view preference. */
        }
        syncReadingPosition();
      }}
    >
      <summary
        ref={summary}
        aria-label={uiText(expanded ? "收合訊息" : "展開完整訊息")}
        aria-describedby={expanded ? undefined : excerptId}
      >
        <span className="request-excerpt" id={excerptId}>
          {preview.excerpt}
        </span>
        <span className="request-toggle">
          {uiText(expanded ? "收合訊息" : "展開完整訊息")}
          <Icon name="chevron-down" size={16} />
        </span>
      </summary>
      <Markdown text={text} />
      <button
        type="button"
        className="request-collapse"
        onClick={() => {
          details.current!.open = false;
          summary.current?.focus({ preventScroll: true });
          summary.current?.scrollIntoView({
            block: "nearest",
            behavior: "instant",
          });
        }}
      >
        {uiText("收合訊息")}
        <Icon name="chevron-up" size={16} />
      </button>
    </details>
  );
});
