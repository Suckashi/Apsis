import { useEffect, useRef, useState } from "react";
import type { Job, Routine } from "../shared/product.ts";
import type { RunRecord } from "../shared/task-progress.ts";
import { api } from "./chat-api.ts";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { uiText } from "./settings-dictionary.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import { taskStatus } from "./task-locale.ts";

export function RoutineHistoryEntry({
  history,
  job,
  botId,
  timezone,
}: {
  history: Routine["history"][number];
  job?: Job;
  botId: string;
  timezone: string;
}) {
  const locale = useSettingsLocale();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const region = useRef<HTMLDivElement>(null);
  const pending = job?.status === "queued" || job?.status === "running";
  const runId = job?.runId;
  useEffect(() => {
    if (!open || !runId || pending) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
    ]);
    setResult(undefined);
    setError("");
    void api<RunRecord>(
      `/bots/${encodeURIComponent(botId)}/runs/${encodeURIComponent(runId)}`,
      "GET",
      undefined,
      { signal },
    )
      .then((record) => {
        if (!controller.signal.aborted) setResult(record.run.text);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason.name === "TimeoutError"
              ? uiText("讀取逾時，請再試一次。")
              : reason.message,
          );
      });
    return () => controller.abort();
  }, [botId, runId, pending, open, retry]);
  const reply = runId ? result : job?.result;
  const partial =
    job?.status !== "completed" &&
    job?.error &&
    reply?.trimEnd().endsWith(job.error)
      ? reply.trimEnd().slice(0, -job.error.length).trimEnd()
      : reply;
  return (
    <details
      className="routine-history-entry"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <time dateTime={history.at}>
          {new Date(history.at).toLocaleString(locale, { timeZone: timezone })}
        </time>
        <span>
          {job ? taskStatus(locale, job.status) : uiText("紀錄無法取得")}
        </span>
        <Icon name="chevron-right" size={14} />
      </summary>
      {job ? (
        <div
          className="routine-history-result"
          role="region"
          aria-label={uiText("排程執行結果")}
          tabIndex={0}
          ref={region}
        >
          <h3>{uiText("交辦內容")}</h3>
          <p className="routine-history-prompt">{job.prompt}</p>
          {job.error && <p className="routine-run-error">{job.error}</p>}
          {pending ? (
            <p>{uiText("結果會在執行結束後更新。")}</p>
          ) : error ? (
            <div>
              <p role="alert">{error}</p>
              <button
                type="button"
                onClick={() => {
                  region.current?.focus();
                  setRetry((value) => value + 1);
                }}
              >
                {uiText("重新載入")}
              </button>
            </div>
          ) : runId && result === undefined ? (
            <p role="status">{uiText("載入中…")}</p>
          ) : (
            <>
              {!runId && (
                <p>{uiText("完整回覆目前無法取得，以下為保存的摘要。")}</p>
              )}
              {partial ? (
                <>
                  <h3>{uiText(runId ? "回覆" : "回覆摘要")}</h3>
                  <Markdown text={partial} />
                </>
              ) : (
                <p>{uiText("這次執行沒有文字回覆。")}</p>
              )}
            </>
          )}
        </div>
      ) : (
        <p>{uiText("目前無法取得這次任務的紀錄。")}</p>
      )}
    </details>
  );
}
