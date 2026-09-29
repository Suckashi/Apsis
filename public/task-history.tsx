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
  nativeSubagents,
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
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const progress = summary.progress;
  const current = currentWorkStatus({ connected, active: summary });
  const phase = current.phase;
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
                : ""}
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
        {open &&
          summaries.map((summary) => (
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
  /** Load execution evidence independently of which disclosure is expanded. */
  record?: RunRecord;
}) {
  const [loadedRecord, setRecord] = useState<RunRecord>();
  const record = suppliedRecord || loadedRecord;
  const [error, setError] = useState(false);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [retry, setRetry] = useState(0);
  const live = summary.status === "running";
  const recordVersion = live ? "live" : summary.revision;
  useEffect(() => {
    if (suppliedRecord) return;
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
  }, [botId, summary.id, recordVersion, live, retry, !!suppliedRecord]);
  const timeline = record?.run.timeline || [];
  const subagents = record ? nativeSubagents(record.run) : [];
  const working = subagents.filter((c) => c.status === "running").length;
  const completed = subagents.filter((c) => c.status === "completed").length;
  const childLabel =
    working === subagents.length
      ? `${working} 個子代理正在協作`
      : working
        ? `${completed} 個子代理已完成，${working} 個仍在協作`
        : completed === subagents.length
          ? `${completed} 個子代理完成`
          : `${subagents.length} 個子代理已停止`;
  const notes = timeline.filter((e) => e.kind === "commentary");
  const plan = timeline.findLast((e) => e.kind === "planning" && !e.subagentId);
  const todos = plan?.kind === "planning" ? plan.todos : [];
  const current = notes.at(-1);
  return (
    <section
      className="task-history execution-evidence"
      id={`task-${summary.id}`}
      aria-label={t("執行過程")}
    >
      {live && current?.kind === "commentary" && (
        <p className="execution-current" role="status">
          {current.text.slice(0, 240)}
        </p>
      )}
      {!live && summary.status === "cancelled" && <p role="status">已停止</p>}
      {(notes.length > 0 || todos.length > 0) && (
        <details className="execution-thinking">
          <summary>{locale === "en" ? "Thinking" : "思考過程"}</summary>
          <p className="muted">
            {locale === "en"
              ? "Public progress and planning"
              : "公開進度與工作計畫"}
          </p>
          {todos.length > 0 && (
            <ul>
              {todos.map((todo, i) => (
                <li key={i}>
                  {todo.status === "completed"
                    ? "✓"
                    : todo.status === "in_progress"
                      ? "●"
                      : "○"}{" "}
                  {todo.content}
                </li>
              ))}
            </ul>
          )}
          {notes.map(
            (note) =>
              note.kind === "commentary" && (
                <div
                  className="work-commentary"
                  key={note.id}
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(note.text),
                  }}
                />
              ),
          )}
        </details>
      )}
      {subagents.length > 0 && (
        <details className="execution-subagents">
          <summary>
            {locale === "en"
              ? `${subagents.length} subagents · ${working} working · ${completed} completed`
              : childLabel}
          </summary>
          <div aria-label="子代理">
            {subagents.map((child) => (
              <section className="subagent-activity" key={child.id}>
                <strong>
                  {child.status === "completed"
                    ? "✓"
                    : child.status === "running"
                      ? "●"
                      : "○"}{" "}
                  {child.name === "general-purpose"
                    ? child.task.split("\n")[0].slice(0, 100)
                    : child.name || child.task}
                </strong>
                <p>{child.task}</p>
                <p>
                  {child.status === "cancelled"
                    ? "已停止"
                    : child.status === "failed"
                      ? "失敗"
                      : child.status === "completed"
                        ? "已完成"
                        : "正在處理"}
                </p>
                {(child.resultSummary || child.progress) && (
                  <p>
                    {(child.resultSummary || child.progress)!.slice(0, 600)}
                  </p>
                )}
                {timeline
                  .filter(
                    (e) => e.kind === "planning" && e.subagentId === child.id,
                  )
                  .slice(-1)
                  .map(
                    (e) =>
                      e.kind === "planning" && (
                        <ul key={e.id}>
                          {e.todos.map((todo, i) => (
                            <li key={i}>
                              {todo.status === "completed"
                                ? "✓"
                                : todo.status === "in_progress"
                                  ? "●"
                                  : "○"}{" "}
                              {todo.content}
                            </li>
                          ))}
                        </ul>
                      ),
                  )}
                <details>
                  <summary>子代理工作詳情</summary>
                  {record?.run.operations
                    .filter((o) => o.subagentId === child.id)
                    .map((operation) => (
                      <OperationRow key={operation.id} operation={operation} />
                    ))}
                  <details>
                    <summary>原始子代理紀錄</summary>
                    <pre>
                      {JSON.stringify(
                        timeline.filter(
                          (e) =>
                            e.kind === "subagent" && e.activity.id === child.id,
                        ),
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </details>
              </section>
            ))}
          </div>
        </details>
      )}
      {record?.delegations.map((job) => (
        <details className="execution-delegation" key={job.id}>
          <summary>
            {job.peerName}{" "}
            {job.status === "completed"
              ? "已完成協助"
              : job.status === "running" || job.status === "queued"
                ? "正在協助"
                : taskStatus(locale, job.status)}
          </summary>
          <DelegationRow job={job} select={select} available={available} />
        </details>
      ))}
      <details
        id={`task-record-${summary.id}`}
        className="execution-tools"
        open={open}
        onToggle={(event) => {
          if (event.currentTarget.open !== open) toggle();
        }}
      >
        <summary>{locale === "en" ? "Work details" : "工作詳情"}</summary>
        {error && (
          <p role="alert">
            {t("無法讀取任務紀錄，請重試。")}{" "}
            <button onClick={() => setRetry((r) => r + 1)}>
              {t("重新載入")}
            </button>
          </p>
        )}
        {!record && !error && <p role="status">{t("正在讀取紀錄…")}</p>}
        {record?.run.operations
          .filter((o) => !o.subagentId)
          .map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
        <details className="task-raw-activity">
          <summary>原始執行紀錄</summary>
          <pre>{JSON.stringify(record?.run, null, 2)}</pre>
        </details>
      </details>
    </section>
  );
}
