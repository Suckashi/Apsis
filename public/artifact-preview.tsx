import { useEffect, useRef, useState } from "react";
import type { Artifact } from "../shared/product.ts";
import type { ArtifactPreview as PreviewData } from "../shared/api.ts";
import { api } from "./chat-api.ts";
import { Modal } from "./bot-ui.tsx";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { FilePreviewHeader } from "./file-preview-header.tsx";
import { DocumentReading } from "./document-reading.tsx";
import { uiText as t, uiError } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";

export function ArtifactPreview({
  artifact,
  back,
  reference,
}: {
  artifact: Artifact;
  back: () => void;
  reference: () => Promise<boolean>;
}) {
  const locale = useSettingsLocale();
  const [data, setData] = useState<PreviewData>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState(false);
  const [referencing, setReferencing] = useState(false);
  const [referenceFailed, setReferenceFailed] = useState(false);
  const reading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    api<PreviewData>(
      `/artifacts/${encodeURIComponent(artifact.id)}/preview`,
      "GET",
      undefined,
      {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause.name === "TimeoutError"
              ? t("讀取逾時，請再試一次。")
              : cause.message,
          );
      });
    return () => {
      controller.abort();
    };
  }, [artifact.id, retry]);
  const url = `/api/v2/artifacts/${encodeURIComponent(artifact.id)}`;
  const formatted = data?.kind === "html" || data?.kind === "markdown";
  const content = (
    <section
      className={`file-panel file-preview artifact-preview${expanded ? " file-panel-expanded" : ""}`}
      aria-label={t(artifact.kind === "attachment" ? "附件預覽" : "成果預覽")}
    >
      <FilePreviewHeader
        name={artifact.name}
        back={back}
        expanded={expanded}
        toggleExpanded={() => setExpanded(!expanded)}
        metadata={
          <p className="artifact-version">
            {artifact.document && (
              <>{t("第 {0} 版", [artifact.document.revision])} · </>
            )}
            {t(
              !artifact.snapshotPath
                ? "檔案"
                : artifact.kind === "attachment"
                  ? "上傳時的版本"
                  : "發布時的版本",
            )}{" "}
            ·{" "}
            <time dateTime={artifact.createdAt}>
              {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-TW", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(artifact.createdAt))}
            </time>
            {artifact.bundle && (
              <>
                <br />
                {t("已包含 {0} 個檔案", [artifact.bundle.files.length])}
              </>
            )}
          </p>
        }
      >
        {formatted && (
          <div
            className="file-view-switch"
            role="group"
            aria-label={t("檔案檢視方式")}
          >
            <button aria-pressed={!source} onClick={() => setSource(false)}>
              {t("預覽")}
            </button>
            <button aria-pressed={source} onClick={() => setSource(true)}>
              {t("原始碼")}
            </button>
          </div>
        )}
        <a
          href={url}
          aria-label={t(artifact.bundle ? "下載完整網頁" : "下載")}
          title={t(artifact.bundle ? "下載完整網頁" : "下載")}
          download={
            artifact.bundle
              ? artifact.name.replace(/\.html?$/i, "") + ".zip"
              : artifact.name
          }
        >
          <Icon name="download" size={16} />
        </a>
        <button
          disabled={referencing}
          onClick={async () => {
            setReferencing(true);
            setNotice(false);
            setReferenceFailed(false);
            try {
              const added = await reference();
              setNotice(added);
              setReferenceFailed(!added);
            } finally {
              setReferencing(false);
            }
          }}
        >
          {t(referencing ? "正在加入引用…" : "引用給 Bot")}
        </button>
      </FilePreviewHeader>
      <div
        className="file-content"
        ref={reading}
        role="group"
        aria-label={t("檔案內容")}
        tabIndex={0}
      >
        {notice && <p role="status">{t("已加入訊息引用")}</p>}
        {referenceFailed && <p role="alert">{t("無法加入引用，請重試。")}</p>}
        {error ? (
          <div className="file-error" role="alert">
            <p>{uiError(error)}</p>
            <button
              type="button"
              onClick={() => {
                reading.current?.focus();
                setRetry((value) => value + 1);
              }}
            >
              {t("重新載入")}
            </button>
          </div>
        ) : !data ? (
          <p role="status">{t("載入中")}</p>
        ) : data.kind === "download" ? (
          <p>{t("此格式或大小不支援預覽，請下載檔案。")}</p>
        ) : data.kind === "image" ? (
          <img className="file-image" src={`${url}/view`} alt={artifact.name} />
        ) : data.kind === "pdf" ? (
          <iframe
            className="file-pdf"
            title={artifact.name}
            src={`${url}/view`}
          />
        ) : (
          <>
            {data.kind === "document" && (
              <p className="muted">
                {t(
                  data.document
                    ? "此預覽保留文件結構；圖片與列印版面請下載查看。"
                    : "文件以文字預覽，版面與完整內容請下載。",
                )}
              </p>
            )}
            {"truncated" in data && data.truncated && (
              <p className="muted">
                {t("預覽僅顯示部分內容，完整內容請下載。")}
              </p>
            )}
            {data.kind === "html" ? (
              <>
                <p className="html-preview-note muted" hidden={source}>
                  {t(
                    artifact.bundle
                      ? "預覽不保存網頁資料；請下載完整網頁後確認保存功能。"
                      : "預覽不保存網頁資料；保存功能需在瀏覽器開啟原始網頁後確認。",
                  )}
                </p>
                {!artifact.bundle && (
                  <p className="muted" hidden={source}>
                    {t(
                      "網頁預覽使用這份檔案；另存的圖片、樣式與外部資源不包含在內。",
                    )}
                  </p>
                )}
                <iframe
                  className="file-html"
                  hidden={source}
                  title={artifact.name}
                  sandbox="allow-scripts allow-forms"
                  referrerPolicy="no-referrer"
                  src={data.previewUrl || `${url}/view`}
                />
                <pre className="file-document" hidden={!source}>
                  {data.content}
                </pre>
              </>
            ) : data.kind === "document" && data.document ? (
              <DocumentReading nodes={data.document} />
            ) : data.kind === "markdown" && !source ? (
              <Markdown text={data.content} />
            ) : (
              <pre
                className={`file-document${data.kind === "document" ? " file-readable-document" : ""}`}
              >
                {data.content}
              </pre>
            )}
          </>
        )}
      </div>
    </section>
  );
  return (
    <Modal
      inline
      open={expanded}
      label={t(artifact.kind === "attachment" ? "附件預覽" : "成果預覽")}
      close={() => setExpanded(false)}
    >
      {content}
    </Modal>
  );
}
