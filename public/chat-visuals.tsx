import { uiText } from "./settings-dictionary.ts";
import React from "react";

import { renderMarkdown } from "./markdown.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    moon: <path d="M20 14a8.5 8.5 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="m5 12 7-7 7 7M12 5v14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    pin: <path d="m16 3 5 5-3 1-2 4-2 2-5-5 2-2 4-2 1-3ZM9 15l-5 5" />,
    settings: (
      <>
        <path d="M 19.825 10.337 L 21.781 9.921 A 10 10 0 0 1 21.781 14.079 L 19.825 13.663 A 8 8 0 0 1 18.709 16.357 L 20.387 17.446 A 10 10 0 0 1 17.446 20.387 L 16.357 18.709 A 8 8 0 0 1 13.663 19.825 L 14.079 21.781 A 10 10 0 0 1 9.921 21.781 L 10.337 19.825 A 8 8 0 0 1 7.643 18.709 L 6.554 20.387 A 10 10 0 0 1 3.613 17.446 L 5.291 16.357 A 8 8 0 0 1 4.175 13.663 L 2.219 14.079 A 10 10 0 0 1 2.219 9.921 L 4.175 10.337 A 8 8 0 0 1 5.291 7.643 L 3.613 6.554 A 10 10 0 0 1 6.554 3.613 L 7.643 5.291 A 8 8 0 0 1 10.337 4.175 L 9.921 2.219 A 10 10 0 0 1 14.079 2.219 L 13.663 4.175 A 8 8 0 0 1 16.357 5.291 L 17.446 3.613 A 10 10 0 0 1 20.387 6.554 L 18.709 7.643 A 8 8 0 0 1 19.825 10.337 Z" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M15 4v16" />
      </>
    ),
    focus: <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />,
    minimize: <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </>
    ),
    monitor: (
      <>
        <rect x="3" y="3" width="18" height="13" rx="2" />
        <path d="M12 16v5M8 21h8" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4M17 3v4M3 11h18M7 15h2M15 15h2" />
      </>
    ),
    memory: (
      <>
        <path d="M12 7c-3-2-6-3-9-2v15c3-1 6 0 9 2 3-2 6-3 9-2V5c-3-1-6 0-9 2ZM12 7v15" />
      </>
    ),
    folder: <path d="M3 6h7l2 2h9v12H3Z" />,
    file: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z M14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    attach: (
      <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M6 15l9-9" />
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="m14 6-6 6 6 6" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-up": <path d="m6 15 6-6 6 6" />,
    "chevron-right": <path d="m9 6 6 6-6 6" />,
    refresh: <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    spark: (
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" />
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
export const Markdown = React.memo(function Markdown({
  text,
}: {
  text: string;
}) {
  // Locale changes must still regenerate code controls and accessible labels.
  useSettingsLocale();
  return (
    <div
      className="markdown"
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey ||
          !["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key) ||
          !(target instanceof HTMLElement) ||
          !target.matches('.code-block > pre[tabindex="0"]')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        target.scrollTo({
          left:
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? target.scrollWidth - target.clientWidth
                : target.scrollLeft + (event.key === "ArrowRight" ? 40 : -40),
          behavior: "instant",
        });
      }}
      onClick={async (event) => {
        const root = event.currentTarget;
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-copy-code]",
        );
        if (
          button &&
          root.contains(button) &&
          button.getAttribute("aria-busy") !== "true"
        ) {
          const block = button.closest(".code-block");
          const code = block?.querySelector("pre code");
          const feedback = block?.querySelector(".code-copy-feedback");
          if (!code || !feedback) return;
          button.setAttribute("aria-busy", "true");
          button.textContent = uiText("複製中…");
          feedback.textContent = "";
          feedback.classList.add("visually-hidden");
          try {
            await navigator.clipboard.writeText(code.textContent || "");
            // A streamed update or a closed preview can replace this block
            // while clipboard access is pending. Never label new code copied.
            if (!button.isConnected || !root.contains(button)) return;
            button.textContent = uiText("已複製");
            feedback.textContent = uiText("程式碼已複製");
          } catch {
            if (!button.isConnected || !root.contains(button)) return;
            button.textContent = uiText("複製失敗");
            feedback.classList.remove("visually-hidden");
            feedback.textContent = uiText("無法複製，請選取程式碼後手動複製。");
          } finally {
            button.removeAttribute("aria-busy");
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
});
