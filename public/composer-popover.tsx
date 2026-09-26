import React, { useEffect, useRef } from "react";

// Native disclosure semantics; Tab reaches the ordinary controls inside.
export function ComposerPopover({
  label,
  children,
  className = "",
  detailsRef,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  detailsRef?: React.RefObject<HTMLDetailsElement | null>;
}) {
  const internalRef = useRef<HTMLDetailsElement>(null);
  const ref = detailsRef ?? internalRef;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [ref]);
  return (
    <details
      ref={ref}
      name="composer-controls"
      className={`composer-popover ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          event.currentTarget.open = false;
      }}
    >
      <summary>{label}</summary>
      <div className="composer-popover-content">{children}</div>
    </details>
  );
}
