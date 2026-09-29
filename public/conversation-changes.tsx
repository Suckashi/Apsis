import { CodingVerification } from "./coding-verification.tsx";
import { useEffect, useState } from "react";
import type { WorkContext } from "../shared/types.ts";
import type { GitOverview } from "../shared/coding.ts";
import { uiText as t } from "./settings-dictionary.ts";

export function ConversationChanges({
  botId,
  context,
  api,
}: {
  botId: string;
  context: WorkContext;
  api: Api;
}) {
  const [overview, setOverview] = useState<GitOverview>();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setOverview(undefined);
    setError("");
    if (context.git)
      void api<GitOverview>(
        `/bots/${botId}/changes?context=${encodeURIComponent(context.id)}&path=${encodeURIComponent(path)}`,
      )
        .then((value) => {
          if (current) setOverview(value);
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [botId, context.id, context.git?.baseCommit, path, revision, api]);
  if (!context.git)
    return (
      <>
        <p>{t("選擇 Git 工作資料夾後，可在這裡查看修改。")}</p>
        <CodingVerification botId={botId} contextId={context.id} api={api} />
      </>
    );
  const file = overview?.files.find((f) => f.path === path);
  return (
    <section className="conversation-changes">
      <CodingVerification botId={botId} contextId={context.id} api={api} />
      <button onClick={() => setRevision((n) => n + 1)}>{t("重新整理")}</button>
      {context.pullRequest && (
        <p>
          <a href={context.pullRequest.url} target="_blank" rel="noreferrer">
            {t("開啟 PR")}
          </a>{" "}
          · {context.pullRequest.status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!overview && !error && <p role="status">{t("載入中…")}</p>}
      {overview && (
        <>
          <p>{overview.branch}</p>
          {!overview.files.length && <p>{t("尚無修改")}</p>}
          <ul className="file-tree">
            {overview.files.map((f) => (
              <li key={f.path}>
                <button
                  aria-pressed={path === f.path}
                  onClick={() => setPath(f.path)}
                >
                  {f.status} {f.path}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {file && (
        <>
          <h3>{file.path}</h3>
          {file.binary || file.truncated ? (
            <p>{t("此檔案無法顯示文字差異，請從檔案面板下載。")}</p>
          ) : (
            <>
              <details>
                <summary>{t("修改前")}</summary>
                <pre>{file.before}</pre>
              </details>
              <details open>
                <summary>{t("修改後")}</summary>
                <pre>{file.after}</pre>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}

type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
