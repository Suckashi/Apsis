import React, { useCallback, useLayoutEffect, useRef, useState } from "react";

export function ComposerFrame({
  as = "form",
  children,
  className = "",
  onSubmit,
}: {
  as?: "form" | "div";
  children: React.ReactNode;
  className?: string;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
}) {
  const classes = `work-composer conversation-composer ${className}`;
  return as === "div" ? (
    <div className={classes}>{children}</div>
  ) : (
    <form className={classes} onSubmit={onSubmit}>
      {children}
    </form>
  );
}

export function useAutoGrowTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 180,
  ready = true,
) {
  const grow = useCallback(() => {
    const input = ref.current;
    if (!input) return;
    const max = Math.min(maxHeight, window.innerHeight * 0.25);
    // Desktop can shrink below the browser's default two-row textarea height.
    // Preserve the existing mobile measurement and CSS minimum touch target.
    const desktop = window.innerWidth > 768;
    input.style.height = desktop ? "0px" : "auto";
    input.style.height = `${Math.min(max, Math.max(44, input.scrollHeight))}px`;
    const overflowing = desktop
      ? input.scrollHeight > input.clientHeight
      : input.scrollHeight > max;
    input.style.overflowY = overflowing ? "auto" : "hidden";
  }, [maxHeight, ref]);
  useLayoutEffect(() => {
    if (!ready) return;
    grow();
  }, [value, grow, ready]);
  useLayoutEffect(() => {
    if (!ready) return;
    const input = ref.current;
    if (!input) return;
    let width: number | undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) return;
      width = next;
      if (window.innerWidth > 768) grow();
    });
    observer.observe(input);
    window.addEventListener("resize", grow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", grow);
    };
  }, [grow, ref, ready]);
}

/** A conversation follows new content only while the reader is at its end. */
export function useConversationScroll(storageKey: string, revision: string) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const previousRevision = useRef(revision);
  const [hasNewContent, setHasNewContent] = useState(false);
  const save = useCallback(() => {
    if (!viewport.current) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          top: viewport.current.scrollTop,
          following: following.current,
        }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  }, [storageKey]);
  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      // React detaches the old key's callback before attaching the new viewport.
      // Persist here, rather than an effect cleanup that might see the new node.
      if (!node) save();
      viewport.current = node;
      if (!node) return;
      let saved: { top: number; following: boolean } | undefined;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          saved =
            typeof parsed === "number"
              ? { top: parsed, following: false }
              : parsed;
        }
      } catch {
        /* Start at latest when storage is unavailable. */
      }
      following.current = saved?.following ?? true;
      node.scrollTop = following.current ? node.scrollHeight : saved?.top || 0;
      // Expansion and image/layout changes must not move the reader. Only a
      // new server revision below follows the tail of the conversation.
    },
    [storageKey, save],
  );
  useLayoutEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    if (following.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
    else setHasNewContent(true);
  }, [revision]);
  const onScroll = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (following.current) setHasNewContent(false);
    save();
  }, [save]);
  const jumpToLatest = useCallback(() => {
    following.current = true;
    if (viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
    setHasNewContent(false);
    save();
  }, [save]);
  return { viewportRef, onScroll, jumpToLatest, hasNewContent };
}

export function useInspectorWidth(
  storageKey: string,
  initial = 380,
): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      return Math.min(
        640,
        Math.max(300, Number(localStorage.getItem(storageKey)) || initial),
      );
    } catch {
      return initial;
    }
  });
  return [
    width,
    (next) => {
      const clamped = Math.min(640, Math.max(300, next));
      setWidth(clamped);
      try {
        localStorage.setItem(storageKey, String(clamped));
      } catch {
        /* Keep this session usable. */
      }
    },
  ];
}

export function InspectorResize({
  value,
  onChange,
  label = "調整檢視區寬度",
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const start = useRef<{ x: number; width: number } | undefined>(undefined);
  return (
    <div
      className="inspector-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={300}
      aria-valuemax={640}
      aria-valuenow={value}
      onKeyDown={(event) => {
        const next =
          event.key === "ArrowLeft"
            ? value + 24
            : event.key === "ArrowRight"
              ? value - 24
              : event.key === "Home"
                ? 300
                : event.key === "End"
                  ? 640
                  : undefined;
        if (next !== undefined) {
          event.preventDefault();
          onChange(next);
        }
      }}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current)
          onChange(start.current.width + start.current.x - event.clientX);
      }}
      onPointerUp={(event) => {
        start.current = undefined;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        start.current = undefined;
      }}
    />
  );
}
