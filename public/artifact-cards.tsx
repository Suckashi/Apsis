import { uiText } from "./settings-dictionary.ts";
import { useState } from "react";

import type { Artifact, Draft } from "../shared/product.ts";

import { Icon } from "./chat-visuals.tsx";

export function ArtifactCard({
  artifact: a,
  compact = false,
  reference,
}: {
  artifact: Artifact;
  compact?: boolean;
  reference?: () => void;
}) {
  return (
    <div className="artifact-delivery">
      <a
        className={`artifact-card ${compact ? "compact" : ""}`}
        href={`/api/v2/artifacts/${a.id}`}
        download={a.name}
      >
        <span className="file-icon">
          <Icon name="file" size={compact ? 18 : 24} />
        </span>
        <span>
          <strong>{a.name}</strong>
          <small>
            {a.kind === "attachment" ? uiText("附件") : uiText("成果")} ·{" "}
            {a.path.split(".").at(-1)?.toUpperCase()}
          </small>
        </span>
        <span className="download-arrow">↓</span>
      </a>
      {reference && (
        <button className="text-button" onClick={reference}>
          {uiText("引用給 Bot")}
        </button>
      )}
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
