import { useEffect, useState } from "react";
import type {
  WorkContext,
  WorkLocation,
  WorkspaceFile,
} from "../shared/types.ts";
import { Modal } from "./bot-ui.tsx";
import { renderMarkdown } from "./markdown.ts";
import { uiText as t } from "./settings-dictionary.ts";

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
        if (current)
          setLocations(
            result.filter(
              (location, index) =>
                result.findIndex((other) => other.path === location.path) ===
                index,
            ),
          );
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
        <button disabled={busy} onClick={close}>
          {t("關閉")}
        </button>
      </div>
      <p className="folder-current">
        {context.location?.path || t("自動資料夾")}
      </p>
      {context.locationLockedAt ? (
        <p>{t("工作位置已固定；變更位置請建立新話題。")}</p>
      ) : (
        <>
          <p className="muted">
            {t("不需設定即可交辦；只有使用既有檔案時才需要選擇。")}
          </p>
          <label>
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
          <ul className="file-tree folder-choices">
            {locations
              .filter((l) => l.id !== context.location?.id)
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
                    <span>{location.name}</span>
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
  }, [api, base, path, version, offset]);
  return (
    <ul className="file-tree" aria-label={path || t("檔案清單")}>
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
                <span className="file-chevron" aria-hidden="true">
                  {isOpen ? "⌄" : "›"}
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
        <li className="file-error" role="alert">
          {error}
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
}: {
  context: WorkContext;
  api: API;
  updateKey: string;
  gitStatus?: Record<string, string>;
  storageKey?: string;
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
    path: readPath(),
  }));
  const path = selection.key === storageKey ? selection.path : readPath();
  const setPath = (next: string) => {
    setSelection({ key: storageKey, path: next });
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, next);
      } catch {
        /* Keep file browsing available without storage. */
      }
    }
  };
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const location = context.location;
  const version = `${updateKey}:${reload}`;
  const base = `/work-locations/${encodeURIComponent(location?.id || "")}`;
  const content = (
    <section
      className={`file-panel ${expanded ? "file-panel-expanded" : ""}`}
      aria-label={t("工作資料與檔案")}
    >
      <div className="file-heading">
        {path ? (
          <button
            onClick={() => {
              setPath("");
              setExpanded(false);
            }}
          >
            {t("返回檔案")}
          </button>
        ) : (
          <strong title={location?.path}>
            {location?.kind === "task"
              ? t("任務資料夾")
              : location?.name || t("任務資料夾")}
          </strong>
        )}
        <div className="file-actions">
          {path && (
            <button onClick={() => setExpanded(!expanded)}>
              {t(expanded ? "收合" : "展開預覽")}
            </button>
          )}
          <button
            aria-label={t("重新整理")}
            title={t("重新整理")}
            onClick={() => setReload((old) => old + 1)}
          >
            ↻
          </button>
        </div>
      </div>
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
          reference={(revision) =>
            reference({ locationId: location.id, path, revision })
          }
        />
      )}
    </section>
  );
  return expanded ? (
    <Modal label={t("檔案預覽")} close={() => setExpanded(false)}>
      {content}
    </Modal>
  ) : (
    content
  );
}

function Preview({
  base,
  path,
  api,
  version,
  reference,
}: {
  base: string;
  path: string;
  api: API;
  version: string;
  reference: (revision: string) => void;
}) {
  const [data, setData] = useState<FileContent>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState(false);
  const formatted = /\.(md|html?)$/i.test(path);
  useEffect(() => {
    let current = true;
    setData(undefined);
    setText("");
    setError("");
    setNotice("");
    Promise.all([
      api<FileContent>(`${base}/content?path=${encodeURIComponent(path)}`),
      /\.(docx|xlsx)$/i.test(path)
        ? api<{ text: unknown }>(
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
    <div className="file-content">
      <strong className="file-preview-path">{path}</strong>
      <div className="file-actions">
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
        <a href={url("download")} download>
          {t("下載")}
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
      </div>
      {notice && <p role="status">{notice}</p>}
      {error ? (
        <p className="file-error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p role="status">{t("載入中")}</p>
      ) : data.editable ? (
        !source && data.previewUrl ? (
          <iframe
            key={version}
            className="file-html"
            title={path}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            src={`${data.previewUrl}?revision=${encodeURIComponent(data.revision)}`}
          />
        ) : !source && /\.md$/i.test(path) ? (
          <div
            className="markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(data.content) }}
          />
        ) : (
          <pre className="file-document">{data.content}</pre>
        )
      ) : /\.(png|jpe?g)$/i.test(path) ? (
        <img className="file-image" src={url("preview")} alt={path} />
      ) : /\.pdf$/i.test(path) ? (
        <iframe className="file-pdf" title={path} src={url("preview")} />
      ) : text ? (
        <pre className="file-document">{text}</pre>
      ) : (
        <p>{t("此格式或大小不支援預覽，請下載檔案。")}</p>
      )}
    </div>
  );
}
