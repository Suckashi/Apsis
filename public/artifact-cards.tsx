import { uiText } from "./settings-dictionary.ts";
import { useState } from "react";

import type { Artifact, Draft } from "../shared/product.ts";
import { artifactDeliveries } from "../shared/artifact-deliveries.ts";

import { Icon } from "./chat-visuals.tsx";

export function ArtifactDeliveries({
  artifacts,
  compact,
  contextId,
  preview,
}: {
  artifacts: Artifact[];
  compact?: boolean;
  contextId?: string;
  preview: (artifact: Artifact) => void;
}) {
  if (!artifacts.length) return null;
  const current = contextId
    ? artifacts.filter((a) => a.workContextId === contextId)
    : artifacts;
  const other = contextId
    ? artifacts.filter((a) => a.workContextId !== contextId)
    : [];
  const deliveries = artifactDeliveries(current);
  return (
    <>
      {contextId && (
        <p className="artifact-scope-label">{uiText("此話題的附件與成果")}</p>
      )}
      {!deliveries.length ? (
        <p className="artifact-scope-empty">
          {uiText("此話題尚無附件或成果。")}
        </p>
      ) : (
        <ul
          className={`artifact-deliveries ${compact ? "compact" : ""}`}
          role="list"
          aria-label={uiText("附件與成果")}
        >
          {deliveries.map(({ key, latest, previous }) => (
            <li className="artifact-series" key={key}>
              <ArtifactCard
                artifact={latest}
                compact={compact}
                showRevision={
                  previous.length > 0 || (latest.document?.revision || 0) > 1
                }
                preview={() => preview(latest)}
              />
              {previous.length > 0 && (
                <details className="artifact-previous">
                  <summary
                    aria-label={uiText("{0} 的先前版本（{1}）", [
                      latest.name,
                      previous.length,
                    ])}
                  >
                    {uiText("先前版本（{0}）", [previous.length])}
                  </summary>
                  <ul
                    role="list"
                    aria-label={uiText("先前版本（{0}）", [previous.length])}
                  >
                    {previous.map((artifact) => (
                      <li key={artifact.id}>
                        <ArtifactCard
                          artifact={artifact}
                          compact={compact}
                          showRevision
                          preview={() => preview(artifact)}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {other.length > 0 && (
        <details className="artifact-other-topics" key={contextId}>
          <summary>{uiText("其他附件與成果")}</summary>
          <ArtifactDeliveries
            artifacts={other}
            compact={compact}
            preview={preview}
          />
        </details>
      )}
    </>
  );
}

export function ArtifactCard({
  artifact: a,
  compact = false,
  preview,
  showRevision = false,
}: {
  artifact: Artifact;
  compact?: boolean;
  preview: () => void;
  showRevision?: boolean;
}) {
  const revision =
    showRevision && a.document
      ? uiText("第 {0} 版", [a.document.revision])
      : "";
  const accessibleName = revision ? `${a.name} · ${revision}` : a.name;
  return (
    <div className={`artifact-delivery ${compact ? "compact" : ""}`}>
      <button
        type="button"
        className={`artifact-card ${compact ? "compact" : ""}`}
        onClick={preview}
        aria-label={uiText(
          a.kind === "attachment" ? "預覽附件 {0}" : "預覽成果 {0}",
          [accessibleName],
        )}
        title={a.name}
      >
        <span className="file-icon">
          <Icon name="file" size={20} />
        </span>
        <span>
          <strong>{a.name.split(/[\\/]/).at(-1) || a.name}</strong>
          <small>
            {a.bundle
              ? uiText("網頁應用")
              : a.kind === "attachment"
                ? uiText("附件")
                : uiText("成果")}{" "}
            · {a.path.split(".").at(-1)?.toUpperCase()}
            {a.bundle && (
              <> · {uiText("{0} 個檔案", [a.bundle.files.length])}</>
            )}
            {revision && <> · {revision}</>}
            {a.document?.pageCount !== undefined && (
              <>
                {" "}
                ·{" "}
                {uiText(a.document.pageCount === 1 ? "1 頁" : "{0} 頁", [
                  a.document.pageCount,
                ])}
              </>
            )}
          </small>
        </span>
        <span className="run-file-action file-preview-hint" aria-hidden="true">
          {uiText("預覽")} <Icon name="chevron-right" size={14} />
        </span>
      </button>
      <a
        className="artifact-download"
        href={`/api/v2/artifacts/${a.id}`}
        download={a.bundle ? a.name.replace(/\.html?$/i, "") + ".zip" : a.name}
        aria-label={uiText(
          a.kind === "attachment" ? "下載附件 {0}" : "下載成果 {0}",
          [accessibleName],
        )}
        title={uiText("下載")}
      >
        <Icon name="download" size={16} />
      </a>
    </div>
  );
}
export function DraftCard({
  draft,
  save,
}: {
  draft: Draft;
  save: (body: unknown) => Promise<void>;
}) {
  const [args, setArgs] = useState(draft.arguments);
  const [busy, setBusy] = useState(false);
  const send = async (action: string) => {
    setBusy(true);
    try {
      await save({ action, arguments: args });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="draft-card">
      <div className="section-title">
        <h3>
          <Icon name="file" size={17} />
          {draft.title}
        </h3>
        <span>
          {
            {
              draft: uiText("草稿"),
              sending: uiText("傳送中"),
              sent: uiText("已傳送"),
              discarded: uiText("已捨棄"),
              unknown: uiText("結果待確認"),
            }[draft.status]
          }
        </span>
      </div>
      <p className="muted">
        {draft.tool} · {draft.connectorId}
      </p>
      {draft.status === "draft" ? (
        <>
          <label>
            {uiText("編輯操作內容")}
            <textarea
              rows={7}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <div className="approval-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void send("discard")}
            >
              {uiText("捨棄")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void send("send")}
            >
              {uiText("確認並傳送")}
            </button>
          </div>
        </>
      ) : (
        <>
          <pre>{draft.arguments}</pre>
          {draft.result && (
            <details>
              <summary>{uiText("操作結果")}</summary>
              <pre>{draft.result}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
