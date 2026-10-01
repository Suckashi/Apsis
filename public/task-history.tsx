import { useEffect, useState } from "react";
import { approvalReason } from "../shared/approval.ts";
import {
  type DelegationRecord,
  type RunRecord,
  type RunSummary,
} from "../shared/task-progress.ts";
import type { ToolOperation } from "../shared/types.ts";
import { nativeSubagents, runOutcome } from "../shared/work-presentation.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import { ActivityMark } from "./activity-feedback.tsx";
import { changedRunFiles, type RunFile } from "../shared/run-files.ts";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { useNearViewport } from "./use-near-viewport.ts";
import { useMedia } from "./bot-ui.tsx";
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
      <span>
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
        <Icon name="chevron-right" size={14} />
      </span>
    </button>
  );
}

function OperationError({ error }: { error: string }) {
  const desktop = useMedia("(min-width: 769px)");
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  if (!desktop || (!error.includes("\n") && error.length <= 240))
    return <p className="task-warning">{error}</p>;
  const firstLine = error.trim().split("\n", 1)[0];
  const parameterError = error.includes(
    "Received tool input did not match expected schema",
  );
  return (
    <>
      <p className="task-warning">
        {parameterError
          ? t("工具參數不符合要求，詳情中保留原始錯誤。")
          : firstLine && firstLine.length <= 240
            ? firstLine
            : t("操作發生錯誤，請展開查看完整原因。")}
      </p>
      <details className="operation-error-details">
        <summary>{t("錯誤詳情")}</summary>
        <pre
          className="task-evidence-text"
          role="region"
          aria-label={t("完整錯誤內容")}
          tabIndex={0}
        >
          {error}
        </pre>
      </details>
    </>
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
        <Icon name="chevron-right" size={14} />
      </summary>
      <div className="task-row-body">
        <p className="muted">
          {t("工具：")}
          {operation.name}
        </p>
        {(operation.evidence?.command || operation.target) && (
          <pre
            className="task-evidence-text"
            role="region"
            aria-label={t("執行目標")}
            tabIndex={0}
          >
            {operation.evidence?.command || operation.target}
          </pre>
        )}
        {operation.error && <OperationError error={operation.error} />}
        {operation.authorization && (
          <p className="muted">
            {approvalReason(
              operation.authorization.reason,
              locale,
              operation.authorization.dangerousCommand,
            )}
          </p>
        )}
        {operation.evidence?.output && (
          <pre
            className="task-evidence-text"
            role="region"
            aria-label={t("工具輸出")}
            tabIndex={0}
          >
            {operation.evidence.output}
          </pre>
        )}
        {operation.evidence?.patch && (
          <pre
            className="task-evidence-text"
            role="region"
            aria-label={t("檔案變更")}
            tabIndex={0}
          >
            {operation.evidence.patch}
          </pre>
        )}
        {operation.evidence?.truncated && (
          <p className="muted">{t("輸出過長，紀錄已截短。")}</p>
        )}
      </div>
    </details>
  );
}

function RunFileRow({
  file,
  previewFile,
}: {
  file: RunFile;
  previewFile: (file: RunFile) => void;
}) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [available, setAvailable] = useState<boolean>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const base = `/api/v2/work-locations/${encodeURIComponent(file.location.id)}`;
  const query = `path=${encodeURIComponent(file.path)}`;
  useEffect(() => {
    const controller = new AbortController();
    setAvailable(undefined);
    setError(false);
    fetch(`${base}/status?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("File status unavailable");
        const status = (await response.json()) as { available: boolean };
        if (!controller.signal.aborted) setAvailable(status.available);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [base, query, retry]);
  return (
    <li>
      <button
        type="button"
        className="run-file-open"
        title={file.path}
        disabled={!available}
        aria-label={`${t("預覽檔案")} ${file.path}`}
        onClick={() => previewFile(file)}
      >
        <span className="file-icon">
          <Icon name="file" size={20} />
        </span>
        <span className="run-file-copy">
          <strong>{file.path.split("/").at(-1)}</strong>
          <small>
            {file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : t("工作資料夾")}
          </small>
        </span>
        <span className="run-file-action">
          {error ? (
            t("無法確認檔案")
          ) : available === false ? (
            t("已移動或移除")
          ) : available ? (
            <span className="file-preview-hint" aria-hidden="true">
              {t("預覽")} <Icon name="chevron-right" size={14} />
            </span>
          ) : (
            t("確認中…")
          )}
        </span>
      </button>
      {available ? (
        <a
          aria-label={`${t("下載檔案")} ${file.path}`}
          title={t("下載檔案")}
          href={`${base}/download?${query}`}
          download={file.path.split("/").at(-1)}
        >
          <Icon name="download" size={16} />
        </a>
      ) : (
        <button
          className="run-file-recheck"
          aria-label={`${t("重新確認檔案")} ${file.path}`}
          onClick={() => setRetry((value) => value + 1)}
        >
          <Icon name="refresh" size={18} />
        </button>
      )}
    </li>
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
        <Icon name="chevron-right" size={14} />
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

export function UnlinkedDelegations({
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
    <details className="task-history unlinked-history">
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
  previewFile,
  deliveredPaths = [],
  compactReply = false,
}: {
  botId: string;
  summary: RunSummary;
  open: boolean;
  toggle: () => void;
  select: (id: string) => void;
  available: Set<string>;
  /** Load execution evidence independently of which disclosure is expanded. */
  record?: RunRecord;
  previewFile?: (file: RunFile) => void;
  deliveredPaths?: string[];
  compactReply?: boolean;
}) {
  const [loadedRecord, setRecord] = useState<RunRecord>();
  const record = suppliedRecord || loadedRecord;
  const [error, setError] = useState(false);
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  const [retry, setRetry] = useState(0);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const { ref, near } = useNearViewport();
  const live = summary.status === "running";
  const quiet = compactReply && runOutcome(summary).quiet;
  const shouldLoad = live || open || (!quiet && near);
  const recordVersion = live ? "live" : summary.revision;
  useEffect(() => {
    if (suppliedRecord || !shouldLoad) return;
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
  }, [
    botId,
    summary.id,
    recordVersion,
    live,
    retry,
    !!suppliedRecord,
    shouldLoad,
  ]);
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
  const completedTodos = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const activeTodos = todos.filter((todo) => todo.status === "in_progress");
  const planCurrent =
    activeTodos.length === 1
      ? activeTodos[0].content
      : activeTodos.length > 1
        ? locale === "en"
          ? `${activeTodos.length} steps in progress`
          : `${activeTodos.length} 項正在進行`
        : undefined;
  const current = notes.at(-1);
  const operations = record?.run.operations.filter((o) => !o.subagentId) || [];
  const changedFiles =
    !live && record && previewFile
      ? changedRunFiles(record.run).filter(
          (file) => !deliveredPaths.includes(file.path),
        )
      : [];
  return (
    <section
      className={`task-history execution-evidence${quiet ? " compact-reply" : ""}${open ? " is-open" : ""}`}
      role="group"
      ref={ref}
      id={`task-${summary.id}`}
      aria-label={t("執行過程")}
    >
      {live && current?.kind === "commentary" && (
        <p className="execution-current" role="status">
          {current.text.slice(0, 240)}
        </p>
      )}
      {live && current?.kind !== "commentary" && (
        <p className="execution-current execution-waiting" role="status">
          <ActivityMark state={summary.progress?.phase || "waiting"} />
          <span>
            {summary.progress?.label
              ? taskProgress(locale, summary.progress.label)
              : t("等待模型回應")}
          </span>
        </p>
      )}
      {live &&
        summary.progress?.approvalBotId &&
        summary.progress.approvalBotId !== botId && (
          <button
            className="secondary task-approval-link"
            disabled={!available.has(summary.progress.approvalBotId)}
            onClick={() => select(summary.progress!.approvalBotId!)}
          >
            {t("前往核准")}
          </button>
        )}
      {live && !open && operations.length > 0 && (
        <ol className="execution-recent" aria-label={t("最近操作")}>
          {operations.slice(-4).map((operation) => (
            <li key={operation.id}>
              <span
                className={`operation-dot ${operation.status}`}
                aria-hidden="true"
              />
              <span className="execution-step-label">
                {taskOperation(locale, operation)}
              </span>
              <span className="task-row-state">
                {taskStatus(locale, operation.status)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!live && summary.status === "cancelled" && <p>{t("已停止")}</p>}
      {changedFiles.length > 0 && (
        <details
          className="run-files"
          role="group"
          aria-label={t("修改的檔案")}
        >
          <summary className="run-files-heading">
            {t("修改的檔案")} · {changedFiles.length}
          </summary>
          <ul role="list">
            {(showAllFiles ? changedFiles : changedFiles.slice(0, 3)).map(
              (file) => (
                <RunFileRow
                  key={file.path}
                  file={file}
                  previewFile={previewFile!}
                />
              ),
            )}
          </ul>
          {changedFiles.length > 3 && (
            <button
              className="run-files-more"
              onClick={() => setShowAllFiles((shown) => !shown)}
            >
              {locale === "en"
                ? showAllFiles
                  ? "Show fewer files"
                  : `Show ${changedFiles.length - 3} more files`
                : showAllFiles
                  ? "收合檔案"
                  : `顯示其餘 ${changedFiles.length - 3} 個檔案`}
            </button>
          )}
          <small className="run-files-note">{t("開啟檔案目前的內容")}</small>
        </details>
      )}
      <details
        id={`task-record-${summary.id}`}
        className="execution-tools"
        open={open}
        onToggle={(event) => {
          if (event.currentTarget.open !== open) {
            toggle();
            if (
              quiet &&
              !event.currentTarget.open &&
              window.matchMedia("(min-width: 769px)").matches
            )
              document
                .getElementById(`reply-record-${summary.id}`)
                ?.focus({ preventScroll: true });
          }
        }}
      >
        <summary>
          {live ? t("工作詳情") : <RunStats summary={summary} />}
          {todos.length > 0 && (
            <span className="execution-plan-count">
              {locale === "en"
                ? `${completedTodos}/${todos.length} steps done`
                : `${completedTodos}/${todos.length} 項完成`}
            </span>
          )}
          {live && planCurrent && (
            <span className="execution-plan-current" title={planCurrent}>
              {planCurrent}
            </span>
          )}
          {subagents.length > 0 && (
            <span className="execution-collaboration-count">
              {locale === "en"
                ? `${subagents.length} subagents · ${working} working · ${completed} completed`
                : childLabel}
            </span>
          )}
        </summary>
        {error && (
          <p role="alert">
            {t("無法讀取任務紀錄，請重試。")}{" "}
            <button onClick={() => setRetry((r) => r + 1)}>
              {t("重新載入")}
            </button>
          </p>
        )}
        {!record && !error && <p role="status">{t("正在讀取紀錄…")}</p>}
        {todos.length > 0 && (
          <section className="execution-thinking">
            <h2 className="execution-section-title">{t("工作計畫")}</h2>
            <p className="muted">
              {locale === "en"
                ? "The Bot’s reported plan. Completed steps do not mean the result is verified."
                : "Bot 更新的工作計畫。項目完成不代表成果已通過驗證。"}
            </p>
            {todos.length > 0 && (
              <ul className="execution-plan-list" aria-label={t("工作計畫")}>
                {todos.map((todo, i) => (
                  <li
                    key={i}
                    data-state={
                      !live && todo.status !== "completed"
                        ? "unconfirmed"
                        : todo.status
                    }
                  >
                    <span className="execution-plan-state">
                      {todo.status === "completed"
                        ? locale === "en"
                          ? "Done"
                          : "已完成"
                        : !live
                          ? t("未確認完成")
                          : todo.status === "in_progress"
                            ? locale === "en"
                              ? "Working"
                              : "進行中"
                            : locale === "en"
                              ? "Pending"
                              : "待開始"}
                    </span>
                    <span>{todo.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {notes.length > 0 && (
          <details className="execution-updates">
            <summary>
              {t("進度回報")}
              <span className="execution-update-count"> · {notes.length}</span>
            </summary>
            {notes.map(
              (note) =>
                note.kind === "commentary" && (
                  <div className="work-commentary" key={note.id}>
                    <Markdown text={note.text} />
                  </div>
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
                                  : child.status !== "running"
                                    ? t("未確認完成")
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
                        <OperationRow
                          key={operation.id}
                          operation={operation}
                        />
                      ))}
                    <details>
                      <summary>原始子代理紀錄</summary>
                      <pre>
                        {JSON.stringify(
                          timeline.filter(
                            (e) =>
                              e.kind === "subagent" &&
                              e.activity.id === child.id,
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
        {operations.length > 0 && (
          <h2 className="execution-section-title">{t("工具操作")}</h2>
        )}
        {record?.run.operations
          .filter((o) => !o.subagentId)
          .map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
        <details className="task-raw-activity">
          <summary>{t("原始執行紀錄")}</summary>
          <pre
            className="task-evidence-text"
            role="region"
            aria-label={t("原始執行紀錄")}
            tabIndex={0}
          >
            {JSON.stringify(record?.run, null, 2)}
          </pre>
        </details>
      </details>
    </section>
  );
}
