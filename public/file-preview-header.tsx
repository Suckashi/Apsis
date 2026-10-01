import type { ReactNode } from "react";
import { Icon } from "./chat-visuals.tsx";
import { uiText as t } from "./settings-dictionary.ts";

/** Shared reading controls stay available while the file content scrolls. */
export function FilePreviewHeader({
  name,
  back,
  expanded,
  toggleExpanded,
  refresh,
  metadata,
  children,
}: {
  name: string;
  back: () => void;
  expanded: boolean;
  toggleExpanded: () => void;
  refresh?: () => void;
  metadata?: ReactNode;
  children: ReactNode;
}) {
  const parts = name.split(/[\\/]/);
  const filename = parts.at(-1) || name;
  const directory = parts.slice(0, -1).join("/");
  return (
    <div className="file-preview-header">
      <div className="file-heading">
        <button
          type="button"
          aria-label={t("返回檔案")}
          title={t("返回檔案")}
          onClick={back}
        >
          <Icon name="back" size={18} />
        </button>
        <strong className="file-preview-path" title={name}>
          <span className="file-preview-fullname">{name}</span>
          <span className="file-preview-identity">
            <span>{filename}</span>
            {directory && <small>{directory}</small>}
          </span>
        </strong>
        {(metadata || directory) && (
          <details
            className={`file-preview-info${!metadata ? " file-preview-path-info" : ""}`}
            onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
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
            <summary aria-label={t("檔案資訊")} title={t("檔案資訊")}>
              <Icon name="info" size={18} />
            </summary>
            <div tabIndex={0} role="group" aria-label={t("檔案資訊")}>
              {directory && <p className="file-preview-location">{name}</p>}
              {metadata}
            </div>
          </details>
        )}
        {refresh && (
          <button
            type="button"
            aria-label={t("重新整理")}
            title={t("重新整理")}
            onClick={refresh}
          >
            <Icon name="refresh" size={18} />
          </button>
        )}
        <button
          type="button"
          aria-label={t(expanded ? "收合" : "展開預覽")}
          title={t(expanded ? "收合" : "展開預覽")}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          <Icon name={expanded ? "minimize" : "focus"} size={18} />
        </button>
      </div>
      <div className="file-actions file-preview-actions">{children}</div>
    </div>
  );
}
