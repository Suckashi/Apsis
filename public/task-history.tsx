import { renderMarkdown } from "./markdown.ts";
import React, { useEffect, useState } from "react";
import { approvalReason } from "../shared/approval.ts";
import {
  type DelegationRecord,
  type RunRecord,
  type RunSummary,
} from "../shared/task-progress.ts";
import type { ToolOperation } from "../shared/types.ts";
import {
  currentWorkStatus,
  operationGroupLabel,
  runOutcome,
} from "../shared/work-presentation.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import { ActivityMark } from "./activity-feedback.tsx";
import {
  taskText,
  taskStatus,
  taskProgress,
  taskWarning,
  taskOperation,
  taskElapsed,
  taskCount,
  taskEarlier,
} from "./task-locale.ts";

export function RunStats({ summary }: { summary: RunSummary }) {
  const locale = useSettingsLocale();
  const outcome = runOutcome(summary);
  if (outcome.quiet) return <>{taskText(locale, outcome.label)}</>;
  return (
    <>
      {taskText(locale, outcome.label)}{" "}
      {summary.operationCount > 0 &&
        ` · ${taskCount(locale, summary.operationCount, "operations")}`}
      {summary.botCount > 0 &&
        ` · ${taskCount(locale, summary.botCount, "bots")}`}
      {summary.endedAt &&
        Date.parse(summary.endedAt) - Date.parse(summary.createdAt) >= 1000 &&
        ` · ${locale === "en" ? "Took" : "耗時"} ${taskElapsed(locale, summary.createdAt, summary.endedAt)}`}
      {summary.warning && (
        <span className="task-warning">
          {" "}
          · {taskWarning(locale, summary.warning)}
        </span>
      )}
    </>
  );
}

export function ProgressStrip({
  summary,
  connected,
  open,
  toggle,
  approve,
}: {
  summary: RunSummary;
  connected: boolean;
  open: boolean;
  toggle: () => void;
  approve: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const progress = summary.progress;
  const current = currentWorkStatus({ connected, active: summary });
  const phase = current.phase;
  const updatedAt = progress?.updatedAt || summary.createdAt;
  return (
    <section
      className={`task-progress phase-${connected ? phase : "disconnected"}`}
      aria-label={t("目前任務進度")}
    >
      <div className="task-progress-main">
        <span className="task-progress-label" role="status" aria-live="polite">
          <ActivityMark state={connected ? phase : "disconnected"} />
          <span className="task-current-label">
            {taskProgress(locale, current.label)}
          </span>
        </span>
        <span className="task-elapsed">
          {locale === "en" ? "Elapsed" : "已執行"}{" "}
          {taskElapsed(locale, summary.createdAt, now)}
        </span>
      </div>
      <div className="task-progress-actions">
        <span
          className="task-progress-note"
          title={
            !connected
              ? t("目前顯示最後收到的狀態，任務可能仍在執行。")
              : undefined
          }
        >
          {!connected
            ? t("即時更新中斷，正在重新連線")
            : phase === "approval"
              ? t("核准或拒絕後，任務才會繼續。")
              : phase === "queued"
                ? t("等待 Bot 開始")
                : `${t("距上次更新")} ${taskElapsed(locale, updatedAt, now)}`}
          {summary.warning && (
            <span className="task-warning">
              {" "}
              · {taskWarning(locale, summary.warning)}
            </span>
          )}
        </span>
        <div>
          {progress?.approvalBotId && (
            <button
              className="task-approval-link"
              onClick={() => approve(progress.approvalBotId!)}
            >
              {t("前往核准")}
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`task-record-${summary.id}`}
            onClick={toggle}
          >
            {t(open ? "收合過程" : "查看過程")}
            <span aria-hidden="true"> {open ? "▴" : "▾"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

export function RunOutcome({
  summary,
  reveal,
}: {
  summary: RunSummary;
  reveal: () => void;
}) {
  const locale = useSettingsLocale();
  const outcome = runOutcome(summary);
  return (
    <button
      type="button"
      onClick={reveal}
      className={`run-outcome outcome-${summary.status}${outcome.quiet ? " is-quiet" : ""}`}
    >
      <span role="status">
        <ActivityMark
          state={
            summary.warning
              ? "interrupted"
              : summary.status === "completed"
                ? "finished"
                : summary.status
          }
        />
        <span>
          <RunStats summary={summary} />
        </span>
      </span>
      <span className="outcome-link">
        {taskText(locale, outcome.quiet ? "查看回覆" : "查看結果")}{" "}
        <span aria-hidden="true">↗</span>
      </span>
    </button>
  );
}

function OperationRow({ operation }: { operation: ToolOperation }) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  return (
    <details className="task-row">
      <summary>
        <span
          className={`operation-dot ${operation.status}`}
          aria-hidden="true"
        />
        <span className="task-row-title">
          {taskOperation(locale, operation)}
        </span>
        <span className="task-row-state">
          {taskStatus(locale, operation.status)}
        </span>
      </summary>
      <div className="task-row-body">
        <p className="muted">
          {t("工具：")}
          {operation.name}
        </p>
        {(operation.evidence?.command || operation.target) && (
          <pre>{operation.evidence?.command || operation.target}</pre>
        )}
        {operation.error && <p className="task-warning">{operation.error}</p>}
        {operation.authorization && (
          <p className="muted">
            {approvalReason(
              operation.authorization.reason,
              locale,
              operation.authorization.dangerousCommand,
            )}
          </p>
        )}
        {operation.evidence?.output && <pre>{operation.evidence.output}</pre>}
        {operation.evidence?.patch && <pre>{operation.evidence.patch}</pre>}
        {operation.evidence?.truncated && (
          <p className="muted">{t("輸出過長，紀錄已截短。")}</p>
        )}
      </div>
    </details>
  );
}

function DelegationRow({
  job,
  select,
  available,
}: {
  job: DelegationRecord;
  select: (id: string) => void;
  available: Set<string>;
}) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  return (
    <details className="task-row">
      <summary>
        <span
          className={`operation-dot ${job.status === "completed" ? "succeeded" : job.status}`}
          aria-hidden="true"
        />
        <span className="task-row-title">
          <span className="task-peer">
            {t(job.outgoing ? "交給" : "來自")} {job.peerName}
          </span>
          <span className="task-row-description">{job.prompt}</span>
        </span>
        <span className="task-row-state">
          {job.waitingApproval
            ? t("等待你的核准")
            : taskStatus(locale, job.status)}
        </span>
      </summary>
      <div className="task-row-body">
        <p>{job.prompt}</p>
        {job.progress && (
          <p className="muted">{taskProgress(locale, job.progress.label)}</p>
        )}
        {job.error && <p className="task-warning">{job.error}</p>}
        {job.result && (
          <>
            <strong>{t("結果")}</strong>
            <p>{job.result}</p>
          </>
        )}
        <button
          disabled={!available.has(job.peerId)}
          onClick={() => select(job.peerId)}
        >
          {t(
            job.waitingApproval && job.outgoing ? "前往核准" : "開啟 Bot 對話",
          )}
          <span aria-hidden="true"> →</span>
        </button>
        {!available.has(job.peerId) && (
          <span className="muted">{t("此 Bot 已無法開啟")}</span>
        )}
      </div>
    </details>
  );
}

export function LegacyDelegations({
  jobs,
  select,
  available,
}: {
  jobs: DelegationRecord[];
  select: (id: string) => void;
  available: Set<string>;
}) {
  const [count, setCount] = useState(10);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  if (!jobs.length) return null;
  return (
    <details className="task-history legacy-history">
      <summary>
        {t("較早協作紀錄")} · {taskCount(locale, jobs.length, "records")}
      </summary>
      <section aria-label={t("較早協作紀錄")}>
        {jobs.slice(-count).map((job) => (
          <DelegationRow
            key={job.id}
            job={job}
            select={select}
            available={available}
          />
        ))}
        {jobs.length > count && (
          <button
            className="task-load-more"
            onClick={() => setCount((c) => c + 10)}
          >
            {t("顯示更早紀錄")}
          </button>
        )}
      </section>
    </details>
  );
}

export function RunArchive({
  botId,
  summaries,
  expandedRuns,
  toggleRun,
  select,
  available,
}: {
  botId: string;
  summaries: RunSummary[];
  expandedRuns: Record<string, boolean>;
  toggleRun: (id: string) => void;
  select: (id: string) => void;
  available: Set<string>;
}) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [open, setOpen] = useState(false);
  const needsAttention = summaries.filter(
    (s) => s.status === "failed" || s.status === "interrupted" || !!s.warning,
  ).length;
  const revealed = summaries
    .filter((s) => expandedRuns[s.id])
    .map((s) => s.id)
    .join(",");
  useEffect(() => {
    if (revealed) setOpen(true);
  }, [revealed]);
  if (!summaries.length) return null;
  return (
    <details
      className="task-history run-archive"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {t("其他執行紀錄")} · {taskCount(locale, summaries.length, "records")}
        {needsAttention > 0 && (
          <span className="task-warning">
            {" "}
            · {t("需留意")} {needsAttention}
          </span>
        )}
      </summary>
      <div>
        {summaries.map((summary) => (
          <RunHistory
            key={summary.id}
            botId={botId}
            summary={summary}
            open={!!expandedRuns[summary.id]}
            toggle={() => toggleRun(summary.id)}
            select={select}
            available={available}
          />
        ))}
      </div>
    </details>
  );
}

export function RunHistory({
  botId,
  summary,
  open,
  toggle,
  select,
  available,
  record: suppliedRecord,
}: {
  botId: string;
  summary: RunSummary;
  open: boolean;
  toggle: () => void;
  select: (id: string) => void;
  available: Set<string>;
  /** Task workspaces already have their run journal; main chats load it on demand. */
  record?: RunRecord;
}) {
  const [loadedRecord, setRecord] = useState<RunRecord>();
  const record = suppliedRecord || loadedRecord;
  const [error, setError] = useState(false);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [retry, setRetry] = useState(0);
  const [count, setCount] = useState(5);
  const live = summary.status === "running";
  const recordVersion = live ? "live" : summary.revision;
  useEffect(() => {
    if (!open || suppliedRecord) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(false);
    const load = async () => {
      try {
        const response = await fetch(
          `/api/v2/bots/${botId}/runs/${summary.id}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("無法讀取任務紀錄，請重試。");
        const next = (await response.json()) as RunRecord;
        if (!controller.signal.aborted) {
          setRecord(next);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (live && !controller.signal.aborted)
          timer = setTimeout(() => void load(), 1000);
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [botId, summary.id, recordVersion, live, open, retry, !!suppliedRecord]);
  const combinedOperations =
    record?.run.operations.filter(
      (operation) =>
        operation.name === "delegate_task" &&
        operation.status === "succeeded" &&
        record.delegations.some(
          (job) => job.outgoing && job.botId === operation.target,
        ),
    ) || [];
  const timelineEntries = new Map(
    record?.run.timeline?.map((entry, index) => [
      entry.id,
      { ...entry, index },
    ]),
  );
  const entries = record
    ? [
        ...record.run.operations
          .filter((operation) => !combinedOperations.includes(operation))
          .map((operation) => ({
            id: `operation-${operation.id}`,
            at:
              timelineEntries.get(`operation-${operation.id}`)?.at ||
              operation.startedAt,
            operation,
            job: undefined as DelegationRecord | undefined,
            commentary: undefined as string | undefined,
          })),
        ...record.delegations.map((job) => ({
          id: `job-${job.id}`,
          at: job.createdAt,
          operation: undefined as ToolOperation | undefined,
          job,
          commentary: undefined as string | undefined,
        })),
        ...(record.run.timeline || [])
          .filter((entry) => entry.kind === "commentary")
          .map((entry) => ({
            id: entry.id,
            at: entry.at,
            commentary: entry.text,
            operation: undefined as ToolOperation | undefined,
            job: undefined as DelegationRecord | undefined,
          })),
      ].sort(
        (a, b) =>
          a.at.localeCompare(b.at) ||
          (timelineEntries.get(a.id)?.index ?? -1) -
            (timelineEntries.get(b.id)?.index ?? -1) ||
          a.id.localeCompare(b.id),
      )
    : [];
  const groups: { id: string; entries: typeof entries }[] = [];
  const visibleEntries = new Set(
    entries.slice(-count).map((entry) => entry.id),
  );
  // Group before paging so the same work keeps its DOM key when older entries
  // are revealed. Native details retain the user's expanded state on updates.
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (entry.operation && previous?.entries[0].operation)
      previous.entries.push(entry);
    else groups.push({ id: entry.id, entries: [entry] });
  }
  return (
    <section
      className={`task-history ${record?.run.timeline?.some((entry) => entry.kind === "commentary") ? "has-commentary" : ""}${runOutcome(summary).quiet ? " is-quiet" : ""}`}
      id={`task-${summary.id}`}
      aria-label={t("任務紀錄")}
    >
      <button
        className="task-summary"
        aria-expanded={open}
        aria-controls={`task-record-${summary.id}`}
        onClick={toggle}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>
          <RunStats summary={summary} />
        </span>
      </button>
      <div id={`task-record-${summary.id}`} hidden={!open}>
        <>
          {error ? (
            <p role="alert">
              {t("無法讀取任務紀錄，請重試。")}{" "}
              <button
                className="task-load-more"
                onClick={() => setRetry((r) => r + 1)}
              >
                {t("重新載入")}
              </button>
            </p>
          ) : (
            !record && <p role="status">{t("正在讀取紀錄…")}</p>
          )}
          {record && (
            <>
              <div className="work-timeline">
                {groups
                  .filter((group) =>
                    group.entries.some((entry) => visibleEntries.has(entry.id)),
                  )
                  .map((group) => {
                    const first = group.entries[0];
                    if (first.commentary !== undefined)
                      return (
                        <div className="work-commentary" key={group.id}>
                          <div
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(first.commentary),
                            }}
                          />
                          <time dateTime={first.at}>
                            {taskElapsed(locale, summary.createdAt, first.at)}
                          </time>
                        </div>
                      );
                    if (first.job)
                      return (
                        <DelegationRow
                          key={group.id}
                          job={first.job}
                          select={select}
                          available={available}
                        />
                      );
                    const operations = group.entries
                      .filter((entry) => visibleEntries.has(entry.id))
                      .map((entry) => entry.operation!);
                    const working = operations.some(
                      (operation) => operation.status === "started",
                    );
                    const failed = operations.some((operation) =>
                      ["failed", "unknown"].includes(operation.status),
                    );
                    return (
                      <details className="task-tool-group" key={group.id}>
                        <summary>
                          <ActivityMark
                            state={
                              working
                                ? "working"
                                : failed
                                  ? "failed"
                                  : "completed"
                            }
                          />
                          <span>
                            {operationGroupLabel(operations)
                              .slice(0, 3)
                              .map(
                                ({ label, count }) =>
                                  `${t(label)}${count > 1 ? ` × ${count}` : ""}`,
                              )
                              .join(" · ")}
                          </span>
                          <small>
                            {taskCount(locale, operations.length, "operations")}
                          </small>
                        </summary>
                        {operations.map((operation) => (
                          <OperationRow
                            key={operation.id}
                            operation={operation}
                          />
                        ))}
                      </details>
                    );
                  })}
              </div>
              {entries.length > count && (
                <button
                  className="task-load-more"
                  onClick={() => setCount((c) => c + 10)}
                >
                  {taskEarlier(locale, entries.length - count)}
                </button>
              )}
              {!entries.length && (
                <p className="muted">
                  {t(
                    live
                      ? "尚未收到工具操作，模型回報後會顯示在這裡。"
                      : "這次任務沒有工具操作或 Bot 協作。",
                  )}
                </p>
              )}
              {!!combinedOperations.length && (
                <details className="task-raw-activity">
                  <summary>{t("派工工具詳情")}</summary>
                  {combinedOperations.map((operation) => (
                    <OperationRow key={operation.id} operation={operation} />
                  ))}
                </details>
              )}
              {!!record.run.activity.length && (
                <details className="task-raw-activity">
                  <summary>{t("原始活動紀錄")}</summary>
                  <pre>{record.run.activity.join("\n")}</pre>
                </details>
              )}
            </>
          )}
        </>
      </div>
    </section>
  );
}
