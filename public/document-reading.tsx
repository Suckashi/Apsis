import React, { useId } from "react";
import type { DocumentNode } from "../shared/document-preview.ts";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

/** Render a constrained reading tree as React elements; never inject document HTML. */
export const DocumentReading = React.memo(function DocumentReading({
  nodes,
}: {
  nodes: DocumentNode[];
}) {
  useSettingsLocale();
  const prefix = useId();
  const render = (node: DocumentNode, key: string): React.ReactNode => {
    if (typeof node === "string") return node;
    const children = node.children.map((child, index) =>
      render(child, `${key}-${index}`),
    );
    const href = node.href?.startsWith("#")
      ? `#${prefix}-${node.href.slice(1)}`
      : node.href;
    const element = React.createElement(
      node.tag,
      {
        key,
        ...(node.id ? { id: `${prefix}-${node.id}` } : {}),
        ...(node.tag === "a"
          ? {
              href,
              ...(href?.startsWith("#")
                ? {}
                : { target: "_blank", rel: "noreferrer noopener" }),
            }
          : {}),
        ...(node.start ? { start: node.start } : {}),
        ...(node.colSpan ? { colSpan: node.colSpan } : {}),
        ...(node.rowSpan ? { rowSpan: node.rowSpan } : {}),
        ...(node.tag === "pre" ? { tabIndex: 0 } : {}),
      },
      node.tag === "br" ? undefined : children,
    );
    return node.tag === "table" ? (
      <div
        key={key}
        className="markdown-table"
        role="group"
        tabIndex={0}
        aria-label={uiText("表格，可左右捲動")}
      >
        {element}
      </div>
    ) : (
      element
    );
  };
  return (
    <div className="markdown document-reading">
      {nodes.map((node, index) => render(node, String(index)))}
    </div>
  );
});
