import { useEffect, useRef, useState } from "react";
import type {
  WorkContext,
  WorkLocation,
  WorkspaceFile,
} from "../shared/types.ts";
import { Modal } from "./bot-ui.tsx";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { uiText as t } from "./settings-dictionary.ts";
import { FilePreviewHeader } from "./file-preview-header.tsx";
import { DocumentReading } from "./document-reading.tsx";
import type { DocumentReadingPreview } from "../shared/document-preview.ts";

type API = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type FileContent = {
  content: string;
  revision: string;
  editable: boolean;
  previewUrl?: string;
};

function FileIcon({ folder = false }: { folder?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d={folder ? "M3 6h7l2 2h9v12H3Z" : "M5 3h9l5 5v13H5ZM14 3v6h5"} />
    </svg>
  );
}

/** Location selection is separate from browsing; opening this dialog never changes cwd. */
export function WorkFolder({
  botId,
  context,
  api,
  refresh,
}: {
  botId: string;
  context: WorkContext;
  api: API;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="work-folder-trigger"
        aria-label={t("工作資料夾")}
        title={context.location?.path}
        onClick={() => setOpen(true)}
      >
        <FileIcon folder />
        <span>
          {context.location?.kind === "task"
            ? t("自動資料夾")
            : context.location?.name || t("工作資料夾")}
        </span>
      </button>
      {open && (
        <Modal label={t("工作資料夾")} close={() => setOpen(false)}>
          <FolderDialog
            key={context.id}
            botId={botId}
            context={context}
            api={api}
            refresh={refresh}
            close={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

function FolderDialog({
  botId,
  context,
  api,
  refresh,
  close,
}: {
  botId: string;
  context: WorkContext;
  api: API;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [path, setPath] = useState("");
  const [worktree, setWorktree] = useState(false);
  const [branch, setBranch] = useState("");
  const [dirty, setDirty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (context.locationLockedAt) return;
    let current = true;
    api<WorkLocation[]>("/work-locations")
      .then((result) => {
        if (current) {
          const choices = new Map<string, WorkLocation>();
          for (const location of result) {
            // A linked folder can share a path with a registered project;
            // keep the explicit project choice and its original identity.
            if (!choices.has(location.path) || location.kind === "project")
              choices.set(location.path, location);
          }
          setLocations([...choices.values()]);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [api, context.locationLockedAt]);
  async function select(folder: string, projectId?: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/bots/${botId}/work-location`, "PUT", {
        contextId: context.id,
        worktree,
        branch,
        dirty: dirty || undefined,
        ...(projectId ? { projectId } : { path: folder }),
      });
      await refresh();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="folder-dialog">
      <div className="file-heading">
        <strong>{t("工作資料夾")}</strong>
        <button
          disabled={busy}
          onClick={close}
          aria-label={t("關閉")}
          title={t("關閉")}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="folder-current">
        <span className="folder-current-label">{t("目前資料夾")}</span>
        <p>{context.location?.path || t("自動資料夾")}</p>
      </div>
      {context.locationLockedAt ? (
        <p>{t("工作位置已固定；變更位置請建立新話題。")}</p>
      ) : (
        <>
          <p className="muted">
            {t("不需設定即可交辦；只有使用既有檔案時才需要選擇。")}
          </p>
          <ul className="file-tree folder-choices">
            {locations
              .filter((l) => l.kind !== "task" && l.id !== context.location?.id)
              .map((location) => (
                <li key={location.id}>
                  <button
                    disabled={busy}
                    title={location.path}
                    onClick={() =>
                      void select(location.path, location.projectId)
                    }
                  >
                    <FileIcon folder />
                    <span className="folder-choice-copy">
                      <strong>{location.name}</strong>
                      <small>{location.path}</small>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void select(path.trim());
            }}
          >
            <label>
              {t("主機資料夾完整路徑")}
              <input
                autoFocus
                required
                value={path}
                disabled={busy}
                onChange={(event) => setPath(event.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !path.trim()}>
              {t("使用此資料夾")}
            </button>
          </form>
          <details className="folder-advanced">
            <summary>
              {worktree ? t("使用隔離的 Git 工作區") : t("Git 工作區選項")}
            </summary>
            <label className="folder-worktree-choice">
              <input
                type="checkbox"
                checked={worktree}
                onChange={(e) => setWorktree(e.target.checked)}
              />
              {t("使用隔離的 Git 工作區")}
            </label>
            {worktree && (
              <>
                <label>
                  {t("起始分支（留空使用目前分支）")}
                  <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </label>
                <label>
                  {t("未提交修改")}
                  <select
                    value={dirty}
                    onChange={(e) => setDirty(e.target.value)}
                  >
                    <option value="">{t("有修改時詢問")}</option>
                    <option value="include">{t("接續目前修改")}</option>
                    <option value="exclude">{t("從最後提交開始")}</option>
                  </select>
                </label>
              </>
            )}
          </details>
        </>
      )}
      {error && (
        <p className="file-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Load only expanded directories and ignore responses from stale requests. */
function Directory({
  base,
  path,
  api,
  version,
  openFile,
  gitStatus,
}: {
  base: string;
  path: string;
  api: API;
  version: string;
  openFile: (path: string) => void;
  gitStatus?: Record<string, string>;
}) {
  const [entries, setEntries] = useState<WorkspaceFile[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [next, setNext] = useState<number>();
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const tree = useRef<HTMLUListElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setOffset(0);
  }, [version]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api<{ entries: WorkspaceFile[]; next?: number }>(
      `${base}/files?path=${encodeURIComponent(path)}&offset=${offset}`,
    )
      .then((result) => {
        if (current) {
          setEntries((old) =>
            offset ? [...old, ...result.entries] : result.entries,
          );
          setNext(result.next);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [api, base, path, version, offset, retry]);
  return (
    <ul
      className="file-tree"
      aria-label={path || t("檔案清單")}
      ref={tree}
      tabIndex={-1}
    >
      {entries.map((entry) => {
        const full = [path, entry.name].filter(Boolean).join("/");
        const folder = entry.type === "directory",
          isOpen = expanded.includes(full);
        return (
          <li key={entry.name}>
            <button
              aria-expanded={folder ? isOpen : undefined}
              onClick={() =>
                folder
                  ? setExpanded((old) =>
                      isOpen ? old.filter((p) => p !== full) : [...old, full],
                    )
                  : openFile(full)
              }
            >
              {folder && (
                <span
                  className={`file-chevron ${isOpen ? "expanded" : ""}`}
                  aria-hidden="true"
                >
                  <Icon name="chevron-right" size={12} />
                </span>
              )}
              <FileIcon folder={folder} />
              <span>{entry.name}</span>
              {gitStatus?.[full] && (
                <small className="cw-tag">{gitStatus[full]}</small>
              )}
            </button>
            {folder && (
              <div hidden={!isOpen}>
                {isOpen && (
                  <Directory
                    base={base}
                    path={full}
                    api={api}
                    version={version}
                    openFile={openFile}
                    gitStatus={gitStatus}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
      {loading && (
        <li className="file-status" role="status">
          {t("載入中")}
        </li>
      )}
      {error && (
        <li className="file-error">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => {
              tree.current?.focus();
              setRetry((value) => value + 1);
            }}
          >
            {t("重新載入")}
          </button>
        </li>
      )}
      {!loading && !error && !entries.length && (
        <li className="file-status">{t("此資料夾尚無檔案。")}</li>
      )}
      {next !== undefined && !loading && (
        <li>
          <button onClick={() => setOffset(next)}>{t("載入更多")}</button>
        </li>
      )}
    </ul>
  );
}

export function FilePanel({
  context,
  api,
  updateKey,
  reference,
  gitStatus,
  storageKey,
  initialPath,
}: {
  context: WorkContext;
  api: API;
  updateKey: string;
  gitStatus?: Record<string, string>;
  storageKey?: string;
  initialPath?: string;
  reference: (ref: {
    locationId: string;
    path: string;
    revision: string;
  }) => void;
}) {
  const readPath = () => {
    try {
      return storageKey ? sessionStorage.getItem(storageKey) || "" : "";
    } catch {
      return "";
    }
  };
  const [selection, setSelection] = useState(() => ({
    key: storageKey,
    path: initialPath ?? readPath(),
  }));
  const path = selection.key === storageKey ? selection.path : readPath();
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, path);
    } catch {
      /* Browsing works without storage. */
    }
  }, [storageKey, path]);
  const setPath = (next: string) => {
    setSelection({ key: storageKey, path: next });
  };
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const location = context.location;
  const version = `${updateKey}:${reload}`;
  const base = `/work-locations/${encodeURIComponent(location?.id || "")}`;
  const content = (
    <section
      className={`file-panel${path ? " file-preview" : ""}${expanded ? " file-panel-expanded" : ""}`}
      aria-label={t("工作資料與檔案")}
    >
      {!path && (
        <div className="file-heading">
          <strong title={location?.path}>
            {location?.kind === "task"
              ? t("任務資料夾")
              : location?.name || t("任務資料夾")}
          </strong>
          <div className="file-actions">
            <button
              aria-label={t("重新整理")}
              title={t("重新整理")}
              onClick={() => setReload((old) => old + 1)}
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </div>
      )}
      <div hidden={!!path}>
        {location && (
          <Directory
            base={base}
            path=""
            api={api}
            version={version}
            openFile={setPath}
            gitStatus={gitStatus}
          />
        )}
      </div>
      {path && location && (
        <Preview
          key={path}
          base={base}
          path={path}
          api={api}
          version={version}
          expanded={expanded}
          toggleExpanded={() => setExpanded(!expanded)}
          refresh={() => setReload((old) => old + 1)}
          back={() => {
            setPath("");
            setExpanded(false);
          }}
          reference={(revision) =>
            reference({ locationId: location.id, path, revision })
          }
        />
      )}
    </section>
  );
  return (
    <Modal
      inline
      open={expanded}
      label={t("檔案預覽")}
      close={() => setExpanded(false)}
    >
      {content}
    </Modal>
  );
}

function Preview({
  base,
  path,
  api,
  version,
  reference,
  expanded,
  toggleExpanded,
  refresh,
  back,
}: {
  base: string;
  path: string;
  api: API;
  version: string;
  reference: (revision: string) => void;
  expanded: boolean;
  toggleExpanded: () => void;
  refresh: () => void;
  back: () => void;
}) {
  const [data, setData] = useState<FileContent>();
  const [text, setText] = useState("");
  const [documentPreview, setDocumentPreview] =
    useState<DocumentReadingPreview>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState(false);
  const formatted = /\.(md|html?)$/i.test(path);
  useEffect(() => {
    let current = true;
    setData(undefined);
    setText("");
    setDocumentPreview(undefined);
    setError("");
    setNotice("");
    Promise.all([
      api<FileContent>(`${base}/content?path=${encodeURIComponent(path)}`),
      /\.(docx|xlsx)$/i.test(path)
        ? api<{ text: unknown } & Partial<DocumentReadingPreview>>(
            `${base}/preview?path=${encodeURIComponent(path)}`,
          )
        : Promise.resolve(undefined),
    ])
      .then(([content, document]) => {
        if (!current) return;
        setData(content);
        if (document)
          setText(
            typeof document.text === "string"
              ? document.text
              : JSON.stringify(document.text, null, 2),
          );
        if (document && typeof document.text === "string")
          setDocumentPreview({
            text: document.text,
            document: document.document,
            truncated: !!document.truncated,
          });
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [api, base, path, version]);
  const url = (action: string) =>
    `/api/v2${base}/${action}?path=${encodeURIComponent(path)}&revision=${encodeURIComponent(data?.revision || "")}`;
  return (
    <>
      <FilePreviewHeader
        name={path}
        back={back}
        expanded={expanded}
        toggleExpanded={toggleExpanded}
        refresh={refresh}
      >
        {data?.editable && formatted && (
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
          href={url("download")}
          download
          aria-label={t("下載")}
          title={t("下載")}
        >
          <Icon name="download" size={16} />
        </a>
        <button
          disabled={!data}
          onClick={() => {
            if (data) {
              reference(data.revision);
              setNotice(t("已加入訊息引用"));
            }
          }}
        >
          {t("引用給 Bot")}
        </button>
      </FilePreviewHeader>
      <div
        className="file-content"
        role="group"
        aria-label={t("檔案內容")}
        tabIndex={0}
      >
        {notice && <p role="status">{notice}</p>}
        {documentPreview?.truncated && (
          <p className="muted">{t("預覽僅顯示部分內容，完整內容請下載。")}</p>
        )}
        {error ? (
          <p className="file-error" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p role="status">{t("載入中")}</p>
        ) : data.editable ? (
          data.previewUrl ? (
            <>
              <p className="html-preview-note muted" hidden={source}>
                {t(
                  "預覽不保存網頁資料；保存功能需在瀏覽器開啟原始網頁後確認。",
                )}
              </p>
              <iframe
                hidden={source}
                key={version}
                className="file-html"
                title={path}
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
                src={`${data.previewUrl}?revision=${encodeURIComponent(data.revision)}`}
              />
              <pre className="file-document" hidden={!source}>
                {data.content}
              </pre>
            </>
          ) : !source && /\.md$/i.test(path) ? (
            <Markdown text={data.content} />
          ) : (
            <pre className="file-document">{data.content}</pre>
          )
        ) : /\.(png|jpe?g)$/i.test(path) ? (
          <img className="file-image" src={url("preview")} alt={path} />
        ) : /\.pdf$/i.test(path) ? (
          <iframe className="file-pdf" title={path} src={url("preview")} />
        ) : documentPreview?.document ? (
          <>
            <p className="muted">
              {t("此預覽保留文件結構；圖片與列印版面請下載查看。")}
            </p>
            <DocumentReading nodes={documentPreview.document} />
          </>
        ) : text ? (
          <pre className="file-document file-readable-document">{text}</pre>
        ) : (
          <p>{t("此格式或大小不支援預覽，請下載檔案。")}</p>
        )}
      </div>
    </>
  );
}
