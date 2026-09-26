import React, { useEffect, useState } from "react";
import { approvalReason } from "../shared/approval.ts";
import {
  type DelegationRecord,
  type RunRecord,
  type RunSummary,
} from "../shared/task-progress.ts";
import type { ToolOperation } from "../shared/types.ts";
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
  return (
    <>
      {summary.warning && summary.status === "completed"
        ? taskText(locale, "已結束")
        : taskStatus(locale, summary.status)}{" "}
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
  const phase = !connected
    ? "disconnected"
    : progress?.approvalBotId
      ? "approval"
      : progress?.phase || "waiting";
  const updatedAt = progress?.updatedAt || summary.createdAt;
  const quiet =
    connected &&
    phase !== "approval" &&
    phase !== "queued" &&
    now - Date.parse(updatedAt) >= 30000;
  const phaseLabel = {
    disconnected: "重新連線",
    approval: "需要你處理",
    queued: "排隊中",
    waiting: "等待模型",
    working: "執行中",
    reply: "回覆中",
    delegating: "Bot 協作中",
  }[phase];
  return (
    <section
      className={`task-progress phase-${phase}`}
      aria-label={t("目前任務進度")}
    >
      <div className="task-progress-main">
        <span className="task-progress-label" role="status" aria-live="polite">
          <ActivityMark state={phase} />
          <span className="task-phase">{t(phaseLabel)}</span>
          <span className="task-current-label" key={progress?.label + phase}>
            {connected
              ? taskProgress(locale, progress?.label || "等待模型回應")
              : t("連線中斷，正在重新連線")}
          </span>
        </span>
        <span className="task-elapsed">
          {locale === "en" ? "Elapsed" : "已執行"}{" "}
          {taskElapsed(locale, summary.createdAt, now)}
        </span>
      </div>
      <p className={`task-progress-hint ${quiet ? "is-quiet" : ""}`}>
        {phase === "approval" ? (
          t("核准或拒絕後，任務才會繼續。")
        ) : phase === "disconnected" ? (
          t("目前顯示最後收到的狀態，任務可能仍在執行。")
        ) : quiet ? (
          <>
            {t("暫未收到新進度；你可以繼續等待，或停止任務。")}{" "}
            <span className="task-elapsed">
              {t("距上次進度")} {taskElapsed(locale, updatedAt, now)}
            </span>
          </>
        ) : phase === "queued" ? (
          t("等待協作 Bot 開始後會自動更新。")
        ) : phase === "reply" ? (
          t("回覆會持續出現在對話中。")
        ) : (
          t("進度會隨模型與工具回報更新，你可以隨時補充指示。")
        )}
      </p>
      <div className="task-progress-actions">
        <span>
          {summary.botCount > 0
            ? `${taskCount(locale, summary.botCount, "bots")} · ${taskCount(locale, summary.completedBotCount, "completed")}`
            : taskCount(locale, summary.operationCount, "operations")}
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
  return (
    <button
      type="button"
      onClick={reveal}
      className={`run-outcome outcome-${summary.status}`}
    >
      <span role="status">
        <ActivityMark
          state={summary.warning ? "interrupted" : summary.status}
        />
        <span>
          <RunStats summary={summary} />
        </span>
      </span>
      <span className="outcome-link">{taskText(locale, "查看結果")} ↗</span>
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

export function RunHistory({
  botId,
  summary,
  open,
  toggle,
  select,
  available,
}: {
  botId: string;
  summary: RunSummary;
  open: boolean;
  toggle: () => void;
  select: (id: string) => void;
  available: Set<string>;
}) {
  const [record, setRecord] = useState<RunRecord>();
  const [error, setError] = useState(false);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [retry, setRetry] = useState(0);
  const [count, setCount] = useState(10);
  const live = summary.status === "running";
  const recordVersion = live ? "live" : summary.revision;
  useEffect(() => {
    if (!open) return;
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
  }, [botId, summary.id, recordVersion, live, open, retry]);
  const entries = record
    ? [
        ...record.run.operations.map((operation) => ({
          id: `operation-${operation.id}`,
          at: operation.startedAt,
          operation,
          job: undefined as DelegationRecord | undefined,
        })),
        ...record.delegations.map((job) => ({
          id: `job-${job.id}`,
          at: job.createdAt,
          operation: undefined as ToolOperation | undefined,
          job,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    : [];
  return (
    <section
      className="task-history"
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
        {open && (
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
                {entries
                  .slice(-count)
                  .map((entry) =>
                    entry.operation ? (
                      <OperationRow
                        key={entry.id}
                        operation={entry.operation}
                      />
                    ) : (
                      <DelegationRow
                        key={entry.id}
                        job={entry.job!}
                        select={select}
                        available={available}
                      />
                    ),
                  )}
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
                {!!record.run.activity.length && (
                  <details className="task-raw-activity">
                    <summary>{t("原始活動紀錄")}</summary>
                    <pre>{record.run.activity.join("\n")}</pre>
                  </details>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
