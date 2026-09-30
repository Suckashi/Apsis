import React, { useEffect, useId, useRef, useState } from "react";
import type { ModelConnection } from "../shared/types.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export type ModelOption = { value: string; label: string; group?: string };
export function connectionModelOptions(
  connections: ModelConnection[],
): ModelOption[] {
  return connections.flatMap((c) =>
    (c.models || [c.model]).map((model) => ({
      value: JSON.stringify([c.id, model]),
      label: c.modelSettings?.[model]?.displayName || model,
      group: c.name,
    })),
  );
}

/** Searchable, keyboard-accessible model selection. Selection commits only after save. */
export function ModelPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const locale = useSettingsLocale();
  const en = locale === "en";
  const id = useId();
  const ref = useRef<HTMLDetailsElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    `${o.group || ""} ${o.label}`.toLowerCase().includes(query.toLowerCase()),
  );
  const close = () => {
    if (ref.current) ref.current.open = false;
    ref.current?.querySelector("summary")?.focus({ preventScroll: true });
  };
  const choose = async (next: string) => {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      await onChange(next);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      ref={ref}
      className="model-picker composer-popover"
      name="composer-controls"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) {
          setQuery("");
          setActive(0);
          setError("");
        }
      }}
      onBlur={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          e.currentTarget.open = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current?.open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <summary
        aria-label={label}
        aria-disabled={disabled || busy}
        title={
          selected ? `${selected.group || ""} · ${selected.label}` : placeholder
        }
        onClick={(e) => {
          if (disabled || busy) e.preventDefault();
        }}
      >
        <span>
          {busy
            ? en
              ? "Saving…"
              : "儲存中…"
            : selected?.label ||
              placeholder ||
              (en ? "Choose model" : "選擇模型")}
        </span>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      {open && (
        <div className="composer-popover-content">
          <input
            ref={searchRef}
            className="model-picker-search"
            type="search"
            role="combobox"
            aria-label={en ? "Search models" : "搜尋模型"}
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={id}
            aria-activedescendant={
              filtered.length
                ? `${id}-${Math.min(active, filtered.length - 1)}`
                : undefined
            }
            placeholder={en ? "Search model or provider" : "搜尋模型或供應商"}
            value={query}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              let next = active;
              if (e.key === "ArrowDown")
                next = Math.min(active + 1, filtered.length - 1);
              else if (e.key === "ArrowUp") next = Math.max(active - 1, 0);
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = filtered.length - 1;
              else if (e.key === "Enter") {
                e.preventDefault();
                if (filtered[active]) void choose(filtered[active].value);
                return;
              } else return;
              e.preventDefault();
              setActive(Math.max(next, 0));
              document
                .getElementById(`${id}-${next}`)
                ?.scrollIntoView({ block: "nearest" });
            }}
          />
          <div
            id={id}
            className="model-picker-options"
            role="listbox"
            aria-label={label}
            aria-busy={busy}
          >
            {filtered.map((option, index) => (
              <React.Fragment key={option.value}>
                {option.group &&
                  (index === 0 ||
                    filtered[index - 1].group !== option.group) && (
                    <div className="model-picker-group" role="presentation">
                      {option.group}
                    </div>
                  )}
                <button
                  type="button"
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  data-active={index === active}
                  disabled={busy}
                  onClick={() => void choose(option.value)}
                >
                  <span>{option.label}</span>
                  {option.value === value && <span aria-hidden="true">✓</span>}
                </button>
              </React.Fragment>
            ))}
            {!filtered.length && (
              <p>{en ? "No matching model" : "找不到符合的模型"}</p>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
