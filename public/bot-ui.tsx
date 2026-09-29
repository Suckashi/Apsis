import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export { BrandMark } from "./avatar-mark.tsx";
export { AvatarPicker } from "./avatar-collection.tsx";

export function useMedia(query: string) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Desktop preferences are independent from temporary drawers and focus mode. */
export function useWorkspaceLayout() {
  const smallScreen = useMedia("(max-width: 640px)");
  const overlayDetails = useMedia("(max-width: 1149px)");
  const mode = smallScreen ? "phone" : overlayDetails ? "tablet" : "desktop";
  const [desktop, setDesktop] = useState<{ list: boolean; panel: boolean }>(
    () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("apsis.layout.v1") || "null",
        );
        return {
          list: typeof saved?.list === "boolean" ? saved.list : true,
          panel: typeof saved?.panel === "boolean" ? saved.panel : false,
        };
      } catch {
        return { list: true, panel: false };
      }
    },
  );
  const [compact, setCompact] = useState({ list: true, panel: false });
  const [mobileList, setMobileList] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("apsis.layout.v1", JSON.stringify(desktop));
    } catch {
      // The current layout still works if browser storage is unavailable.
    }
  }, [desktop]);
  useEffect(() => {
    setCompact({ list: true, panel: false });
    setMobileList(false);
    setFocusMode(false);
  }, [mode]);
  const layout = mode === "desktop" ? desktop : compact;
  const change = (field: "list" | "panel", value: boolean) => {
    setFocusMode(false);
    const update = mode === "desktop" ? setDesktop : setCompact;
    update((previous) => ({ ...previous, [field]: value }));
  };
  return {
    smallScreen,
    overlayDetails,
    mobileList,
    setMobileList,
    focusMode,
    toggleFocus: () => {
      setMobileList(false);
      setFocusMode((previous) => !previous);
    },
    listVisible: smallScreen ? mobileList : !focusMode && layout.list,
    panel: !focusMode && layout.panel,
    setPanel: (value: boolean) => change("panel", value),
    toggleList: () => {
      if (smallScreen) {
        setFocusMode(false);
        setMobileList((previous) => !previous);
      } else change("list", focusMode || !layout.list);
    },
    closeList: () => {
      if (smallScreen) setMobileList(false);
      else change("list", false);
      document.getElementById("roster-toggle")?.focus();
    },
  };
}

export function DetailSection({
  title,
  icon,
  status,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  // Until explicitly toggled, a newly connected computer expands automatically.
  const [expanded, setExpanded] = useState<boolean>();
  const open = expanded ?? defaultOpen;
  return (
    <section className="detail-section">
      <h3>
        <button
          className="detail-section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setExpanded(!open)}
        >
          {icon}
          <span>{title}</span>
          <small>{status}</small>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </h3>
      <div id={id} hidden={!open} className="detail-section-content">
        {children}
      </div>
    </section>
  );
}

/** Native dialog supplies top-layer rendering, inert background and focus trapping. */
export function Modal({
  label,
  close,
  children,
}: {
  label: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected && previous.getClientRects().length)
        previous.focus();
      else document.getElementById("conversation")?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog-shell"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
          ),
        ).filter((node) => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === controls[0]) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === controls.at(-1)
        ) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        backdropDown.current =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
      }}
      onClick={(event) => {
        if (backdropDown.current && event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      {children}
    </dialog>
  );
}

export function useDrawer(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  close: () => void,
) {
  const latestClose = useRef(close);
  latestClose.current = close;
  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ),
      ).filter((node) => node.getClientRects().length);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        latestClose.current();
      }
      if (event.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      if (
        previous?.isConnected &&
        previous.getClientRects().length &&
        !previous.closest("[inert]")
      )
        previous.focus();
      else document.getElementById("conversation")?.focus();
    };
  }, [active, ref]);
}

export function CopyButton({ text }: { text: string }) {
  useSettingsLocale();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
      }}
      aria-live="polite"
    >
      {status === "copied"
        ? uiText("已複製")
        : status === "failed"
          ? uiText("複製失敗")
          : uiText("複製")}
    </button>
  );
}
