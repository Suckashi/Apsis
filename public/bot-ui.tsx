import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { botAvatars } from "../shared/bot-avatars.ts";

export function BrandMark({
  size = 26,
  avatar = "orbit",
}: {
  size?: number;
  avatar?: string;
}) {
  const preset = botAvatars.find((item) => item.id === avatar) || botAvatars[0];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      data-avatar={preset.id}
    >
      <g fill={preset.color}>
        {preset.id === "orbit" && <circle cx="16" cy="16" r="14" />}
        {preset.id === "cloud" && (
          <path d="M8 28a7 7 0 0 1-4-13 8 8 0 0 1 13-9 8 8 0 0 1 11 9 7 7 0 0 1-4 13Z" />
        )}
        {preset.id === "bean" && (
          <path d="M25 3C14-2 2 8 2 19c0 9 9 14 17 10 5-3 4-7 7-10 6-6 6-13-1-16Z" />
        )}
        {preset.id === "spark" && (
          <path d="m16 1 5 8 9 2-5 9 1 10-10-4-10 4 1-10-5-9 9-2Z" />
        )}
        {preset.id === "bloom" && (
          <path d="M16 5C23-3 33 7 27 14c9 6 1 19-8 13C12 35 0 27 5 19-4 12 5 0 13 5Z" />
        )}
        {preset.id === "cube" && (
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx="8"
            transform="rotate(-8 16 16)"
          />
        )}
      </g>
      <ellipse
        cx="11.5"
        cy="14.5"
        rx="1.9"
        ry="4.3"
        transform="rotate(17 11.5 14.5)"
        fill="#201333"
      />
      <ellipse
        cx="20.5"
        cy="14.5"
        rx="1.9"
        ry="4.3"
        transform="rotate(-17 20.5 14.5)"
        fill="#201333"
      />
    </svg>
  );
}

export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="avatar-picker">
      <legend>Bot 圖示</legend>
      <div>
        {botAvatars.map((avatar) => (
          <label key={avatar.id} title={avatar.label}>
            <input
              type="radio"
              name="bot-avatar"
              value={avatar.id}
              checked={value === avatar.id}
              onChange={() => onChange(avatar.id)}
            />
            <span>
              <BrandMark avatar={avatar.id} size={36} />
              <span className="avatar-label">{avatar.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
      onClick={(event) => {
        if (event.target === event.currentTarget) {
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
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
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
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);
}

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("複製");
  useEffect(() => {
    if (status === "複製") return;
    const timer = setTimeout(() => setStatus("複製"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStatus("已複製");
        } catch {
          setStatus("複製失敗");
        }
      }}
      aria-live="polite"
    >
      {status}
    </button>
  );
}
