import React, { useEffect, useRef, useState, useMemo } from "react";
import { diffLines } from "diff";
import type { CodingTask, GitOverview, GitChange } from "../shared/coding.ts";
import type { CodingTasks } from "../server/coding-tasks.ts";
import type { Project, Skill, TaskRun } from "../shared/types.ts";
import type { Settings } from "../shared/settings.ts";
import {
  operationLabel,
  type RunSummary,
  type RunRecord,
} from "../shared/task-progress.ts";
import { BrandMark, Modal, useMedia } from "./bot-ui.tsx";
import {
  compactTaskTitle,
  planSummary,
  planStartVersion,
} from "./task-display.ts";
import { FilePanel } from "./file-panel.tsx";
import { renderMarkdown } from "./markdown.ts";
import { ProgressStrip, RunHistory } from "./task-history.tsx";
import { WorkApproval } from "./work-approval.tsx";
import { CodingVerification } from "./coding-verification.tsx";
import { ApprovalModeControl } from "./approval-mode-control.tsx";
import { getSettingsLocale, useSettingsLocale } from "./settings-locale.ts";
import { uiText } from "./settings-dictionary.ts";
import { attentionSummary } from "../shared/work-presentation.ts";
import {
  ComposerFrame,
  InspectorResize,
  useAutoGrowTextarea,
  useConversationScroll,
  useInspectorWidth,
} from "./workspace-primitives.tsx";

type API = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Detail = ReturnType<CodingTasks["detail"]>;
const labels: Record<CodingTask["phase"], string> = {
  queued: "排隊中",
  working: "執行中",
  planning: "規劃中",
  "plan-ready": "等你確認計畫",
  review: "待你檢查成果",
  blocked: "需要你協助",
  stopped: "已停止",
  done: "已完成",
};
const words: Record<string, string> = {
  需處理: "Needs attention",
  執行中: "Working",
  未讀: "Unread",
  任務: "Tasks",
  獨立任務: "Independent task",
  工作位置: "Work location",
  一般對話: "Conversation",
  起始分支: "Starting branch",
  模式: "Mode",
  直接執行: "Execute",
  先規劃: "Plan first",
  排隊中: "Queued",
  規劃中: "Planning",
  等你確認計畫: "Review plan",
  待你檢查成果: "Review results",
  需要你協助: "Needs attention",
  已停止: "Stopped",
  已完成: "Completed",
  查看變更: "View changes",
  開啟任務: "Open task",
  檔案: "Files",
  變更: "Changes",
  你: "You",
  回到最新: "Jump to latest",
  補充指示: "Add instructions",
  排入下一項: "Queue next",
  待採用: "Queued",
  已採用: "Adopted",
  "補充會在目前執行完成後接續。":
    "Your instructions will run after the current work finishes.",
  "補充想法，或輸入 / 選用 Skill": "Add instructions, or type / to use a skill",
  "Enter 傳送 · Shift + Enter 換行":
    "Enter to send · Shift + Enter for a new line",
  點選按鈕傳送: "Tap the button to send",
  尚未驗證: "Not verified",
  "有操作失敗，請查看紀錄。": "An operation failed. Review the record.",
  "有操作結果不明，請查看紀錄。":
    "An operation has an unknown result. Review the record.",
  其他執行紀錄: "Other run records",
  回覆結束: "Response ended",
  "尚無交辦紀錄。輸入訊息開始工作。": "No work yet. Send a message to begin.",
  調整檢視區寬度: "Resize inspector",
  工作內容: "Work content",
  關閉工具返回討論: "Close inspector and return to discussion",
  "連線中斷，目前顯示最後收到的狀態。":
    "Connection lost. Showing the last known state.",
  重新連線: "Reconnect",
  無法載入任務: "Unable to load task",
  重新載入: "Reload",
  切換至新的任務分支: "Switch to a task branch",
  選擇分支或輸入新名稱: "Choose a branch or enter a new name",
  切換分支: "Switch branch",
  標記完成: "Mark complete",
  停止: "Stop",
  關閉: "Close",
  "Bot 正在整理計畫，完成後可在這裡確認。":
    "The Bot is preparing a plan. Review it here when ready.",
  開始實作: "Start implementation",
  計畫文件: "Plan document",
  "此任務沒有 Git 專案。可從「檔案」查看成果。":
    "This task has no Git project. Open Files to review the results.",
  分支與提交紀錄: "Branches and commits",
  調整PR目標: "Change PR target",
  "調整 PR 目標": "Change PR target",
  套用: "Apply",
  Git分支圖: "Git graph",
  "Git 分支圖": "Git graph",
  "目前沒有修改檔案。": "No changed files yet.",
  "二進位或超過 1 MiB 的檔案，請從檔案面板下載查看。":
    "Download binary files or files over 1 MiB from the Files panel.",
  "引用程式碼，請 Bot 修改": "Ask Bot to change selected code",
  "計畫已有新版本，草稿保留；請比較後重新載入。":
    "A new plan version is available. Your draft is preserved; compare it before reloading.",
  儲存計畫: "Save plan",
  "此檔案差異較大，請從檔案面板下載查看。":
    "This diff is too large. Download the file from the Files panel.",
  修改前: "Before",
  修改後: "After",
  行內比較: "Inline diff",
  左右比較: "Side-by-side diff",
  任務工具: "Task tools",
  專案任務: "Project task",
  獨立工作資料夾: "Task folder",
  任務計畫: "Task plan",
  已採用的計畫: "Adopted plan",
  編輯計畫: "Edit plan",
  查看計畫文件: "View plan document",
  "調整計畫後儲存，再開始實作。":
    "Save your plan changes before starting implementation.",
  "捨棄草稿並載入最新計畫？": "Discard your draft and load the latest plan?",
  "持續跟進 CI 與 Review；正式核准及合併回 Git 平台。":
    "Following CI and reviews. Approve and merge on your Git platform.",
};
const text = (source: string) =>
  getSettingsLocale() === "en" ? words[source] || uiText(source) : source;
const phaseLabel = (phase: CodingTask["phase"]) => text(labels[phase]);

function taskRunSummary(run: TaskRun, detail: Detail): RunSummary {
  const approval = detail.approvals.find((a) => a.runId === run.id);
  const active = run.operations.filter(
    (operation) => operation.status === "started",
  );
  const operation = active.at(-1);
  const lastOperationAt = run.operations.reduce((latest, op) => {
    const at = op.endedAt || op.startedAt;
    return at > latest ? at : latest;
  }, run.createdAt);
  const parent = detail.jobs.find((job) => job.runId === run.id);
  const children = detail.delegations.filter(
    (job) => job.parentJobId === parent?.id,
  );
  const bots = new Set(children.map((job) => job.botId));
  const failed = children.filter((job) =>
    ["failed", "cancelled", "interrupted"].includes(job.status),
  );
  return {
    id: run.id,
    status: run.status,
    createdAt: run.createdAt,
    endedAt: run.endedAt,
    operationCount: run.operations.length,
    delegationCount: children.length,
    botCount: bots.size,
    completedBotCount: [...bots].filter((id) =>
      children
        .filter((job) => job.botId === id)
        .every((job) => job.status === "completed"),
    ).length,
    warning: failed.length
      ? `${failed.length} 項協作未成功`
      : run.operations.some((op) => op.status === "unknown")
        ? "有操作結果不明"
        : run.operations.some((op) => op.status === "failed")
          ? "有操作失敗"
          : undefined,
    progress:
      run.status !== "running"
        ? undefined
        : approval
          ? {
              phase: "approval",
              label: "等待你的核准",
              updatedAt: approval.createdAt,
              approvalBotId: approval.botId,
            }
          : operation
            ? {
                phase: "working",
                label: `正在${operationLabel(operation)}`,
                updatedAt: operation.startedAt,
              }
            : run.progress && run.progress.updatedAt >= lastOperationAt
              ? {
                  phase: run.progress.kind === "reply" ? "reply" : "working",
                  label:
                    run.progress.kind === "reply"
                      ? "正在產生回覆"
                      : run.progress.text || "等待模型回應",
                  updatedAt: run.progress.updatedAt,
                }
              : {
                  phase: "waiting",
                  label: "等待模型回應",
                  updatedAt: lastOperationAt,
                },
    revision: JSON.stringify([
      run.status,
      run.endedAt,
      run.progress,
      run.operations.map((operation) => [
        operation.id,
        operation.status,
        operation.endedAt,
      ]),
      run.timeline?.length,
    ]),
  };
}
export function TaskTags({
  tasks,
  chat,
}: {
  tasks: CodingTask[];
  chat?: {
    approvalCount?: number;
    needsInput?: boolean;
    failed?: boolean;
    running?: boolean;
    unread?: boolean;
  };
}) {
  useSettingsLocale();
  const summary = attentionSummary([
    ...tasks.map((task) => ({
      needsInput: ["plan-ready", "review", "blocked"].includes(task.phase),
      running: ["working", "planning", "queued"].includes(task.phase),
      unread: task.replyVersion > task.readVersion,
    })),
    ...(chat ? [chat] : []),
  ]);
  return (
    <span className="cw-tags">
      {summary.count > 0 && (
        <span
          className={
            summary.kind === "attention"
              ? "cw-wait"
              : summary.kind === "running"
                ? "cw-running"
                : ""
          }
        >
          {text(summary.label)} {summary.count}
        </span>
      )}
    </span>
  );
}
export function BotTaskList({
  tasks,
  botName,
  activeTask,
  expanded,
  toggle,
  open,
}: {
  tasks: CodingTask[];
  botName: string;
  activeTask?: string;
  expanded: boolean;
  toggle: () => void;
  open: (id: string) => void;
}) {
  const locale = useSettingsLocale();
  if (!tasks.length) return null;
  return (
    <div className="bot-task-list">
      <button
        className="bot-task-toggle"
        aria-expanded={expanded}
        aria-label={
          locale === "en"
            ? `${botName}'s tasks · ${tasks.length}`
            : `${botName} 的任務 · ${tasks.length}`
        }
        onClick={toggle}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {text("任務")}{" "}
        <span>{tasks.length}</span>
      </button>
      {expanded && (
        <div
          className="bot-task-items"
          role="group"
          aria-label={
            locale === "en" ? `${botName}'s tasks` : `${botName} 的任務清單`
          }
        >
          {tasks.map((task) => (
            <button
              key={task.id}
              className="bot-task-link"
              title={task.title}
              aria-current={activeTask === task.id ? "page" : undefined}
              onClick={() => open(task.id)}
            >
              <span className="bot-task-name" title={task.title}>
                {compactTaskTitle(task.title)}
              </span>
              <span className="bot-task-status">
                {task.replyVersion > task.readVersion && (
                  <span className="bot-task-unread">{text("未讀")} · </span>
                )}
                {phaseLabel(task.phase)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskCard({
  task,
  open,
  api,
  onRead,
}: {
  task: CodingTask;
  open: (id: string, panel?: string) => void;
  api: API;
  onRead: () => void;
}) {
  useSettingsLocale();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || task.replyVersion <= task.readVersion) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        clearTimeout(timer);
        if (entries[0].isIntersecting && entries[0].intersectionRatio >= 0.6)
          timer = setTimeout(() => {
            if (document.visibilityState === "visible")
              void api(`/coding-tasks/${task.id}/read`, "POST", {
                version: task.replyVersion,
              })
                .then(onRead)
                .catch(() => {});
          }, 800);
      },
      { threshold: [0.6] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [task.id, task.replyVersion, task.readVersion]);
  return (
    <article ref={ref} className="cw-card cw-task-row" data-task-id={task.id}>
      <div className="cw-card-top">
        <span>{task.git?.branch || text("獨立任務")}</span>
        <span className={`cw-tag phase-${task.phase}`}>
          {phaseLabel(task.phase)}
        </span>
      </div>
      <button className="cw-card-title" onClick={() => open(task.id)}>
        {compactTaskTitle(task.title)}
      </button>
      {task.error && <p role="alert">{task.error}</p>}
      {task.summary ? (
        <div
          className="markdown cw-task-summary"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(task.summary) }}
        />
      ) : (
        <p className="cw-task-summary">{task.prompt}</p>
      )}
      <footer>
        <button onClick={() => open(task.id, task.git ? "changes" : "files")}>
          {text(task.git ? "查看變更" : "檔案")}
        </button>
        <button onClick={() => open(task.id)}>{text("開啟任務")} →</button>
      </footer>
    </article>
  );
}
export function ProjectControls({
  projects,
  projectId,
  setProject,
  branch,
  setBranch,
  mode,
  setMode,
  api,
  hideMode = false,
  showLabels = false,
}: {
  projects: Project[];
  projectId: string;
  setProject: (v: string) => void;
  branch: string;
  setBranch: (v: string) => void;
  mode: string;
  setMode: (v: string) => void;
  api: API;
  hideMode?: boolean;
  showLabels?: boolean;
}) {
  useSettingsLocale();
  const previousProject = useRef(projectId);
  const [branches, setBranches] = useState<string[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const initial = previousProject.current === projectId;
    previousProject.current = projectId;
    setError("");
    setBranches([]);
    if (projectId)
      void api<{ branch: string; branches: string[] }>(
        `/projects/${projectId}/git`,
      )
        .then((r) => {
          if (live) {
            setBranches(r.branches);
            setBranch(
              initial && r.branches.includes(branch) ? branch : r.branch,
            );
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    else setBranch("");
    return () => {
      live = false;
    };
  }, [projectId]);
  return (
    <div className="cw-project-controls">
      <label>
        <span className={showLabels ? "" : "visually-hidden"}>
          {text("工作位置")}
        </span>
        <select
          aria-label={text("工作位置")}
          value={projectId}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">{text("一般對話")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {projectId && (
        <label>
          <span className={showLabels ? "" : "visually-hidden"}>
            {text("起始分支")}
          </span>
          <select
            aria-label={text("起始分支")}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      )}
      {!hideMode && (
        <label>
          <span className={showLabels ? "" : "visually-hidden"}>
            {text("模式")}
          </span>
          <select
            aria-label={text("模式")}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="work">{text("直接執行")}</option>
            <option value="plan">{text("先規劃")}</option>
          </select>
        </label>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
export function CodingWorkspace({
  id,
  initialPanel,
  api,
  refresh,
  avatar,
  name,
  skills,
  back,
  connected = true,
  availableBots,
  selectBot,
  settings,
  onSettingsSaved,
  onSettingsReload,
  modelIssue,
  onModelSettings,
  botNames,
}: {
  id: string;
  initialPanel?: string;
  api: API;
  refresh: () => Promise<void>;
  avatar?: string;
  name: string;
  skills: Skill[];
  back: () => void;
  connected?: boolean;
  availableBots?: Set<string>;
  selectBot?: (id: string) => void;
  settings?: Settings;
  onSettingsSaved?: (settings: Settings) => void;
  onSettingsReload?: () => Promise<void>;
  modelIssue?: string;
  onModelSettings?: () => void;
  botNames?: Record<string, string>;
}) {
  const locale = useSettingsLocale();
  const phone = useMedia("(max-width: 640px)");
  const overlayInspector = useMedia("(max-width: 1149px)");
  const [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loadFailed, setLoadFailed] = useState(false);
  const [panel, setPanelState] = useState(() => {
      const saved =
        initialPanel || sessionStorage.getItem(`apsis.task-panel.${id}`) || "";
      return saved === "git" ? "changes" : saved === "checks" ? "" : saved;
    }),
    [changes, setChanges] = useState<GitOverview>(),
    [file, setFile] = useState(
      () => sessionStorage.getItem(`apsis.task-file.${id}`) || "",
    ),
    [change, setChange] = useState<GitChange>();
  const [draft, setDraft] = useState(
    () => sessionStorage.getItem(`apsis.task-draft.${id}`) || "",
  );
  const [caret, setCaret] = useState(draft.length);
  const [sendMode, setSendMode] = useState<"steer" | "queue">("steer");
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const retryRequests = useRef(new Map<string, string>());
  const composer = useRef<HTMLTextAreaElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const setPanel = (next: string) => {
    if (!panel && next)
      panelTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setPanelState(next);
  };
  const [inspectorWidth, setInspectorWidth] = useInspectorWidth(
    "apsis.task-inspector-width",
  );
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const scrollRevision = JSON.stringify([
    detail?.session.messages.at(-1)?.id,
    detail?.session.live?.text,
    detail?.runs.map((run) => [
      run.id,
      run.status,
      run.operations.length,
      run.timeline?.length,
    ]),
    detail?.approvals.map((approval) => approval.id),
  ]);
  const scroll = useConversationScroll(
    `apsis.task-scroll.${id}`,
    scrollRevision,
  );
  useAutoGrowTextarea(composer, detail ? draft : "\0");
  const savedPlan = useRef<{ content: string; version: number } | undefined>(
    (() => {
      try {
        return (
          JSON.parse(
            sessionStorage.getItem(`apsis.task-plan.${id}`) || "null",
          ) || undefined
        );
      } catch {
        return undefined;
      }
    })(),
  );
  const [plan, setPlan] = useState(savedPlan.current?.content || ""),
    [version, setVersion] = useState(savedPlan.current?.version || 0),
    [planDirty, setPlanDirty] = useState(!!savedPlan.current),
    [inline, setInline] = useState(false),
    [newBranch, setNewBranch] = useState(""),
    [switcher, setSwitcher] = useState(false);
  const [branchOptions, setBranchOptions] = useState<string[]>([]),
    [target, setTarget] = useState("");
  const [skillIndex, setSkillIndex] = useState(0),
    [slashDismissed, setSlashDismissed] = useState(false);
  const generation = useRef(0),
    read = useRef(0),
    actionLock = useRef(false),
    messageRequest = useRef<
      { prompt: string; action: string; id: string } | undefined
    >(undefined);
  const load = async () => {
    const token = ++generation.current;
    const d = await api<Detail>(`/coding-tasks/${id}`);
    if (token !== generation.current) return;
    setLoadFailed(false);
    setDetail(d);
    if (
      d.task.replyVersion > read.current &&
      document.visibilityState === "visible"
    ) {
      read.current = d.task.replyVersion;
      await api(`/coding-tasks/${id}/read`, "POST", {
        version: d.task.replyVersion,
      });
      void refresh();
    }
  };
  useEffect(() => {
    void load().catch((e) => {
      setError(e.message);
      setLoadFailed(true);
    });
    const timer = setInterval(
      () => void load().catch(() => setLoadFailed(true)),
      1800,
    );
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [id]);
  useEffect(() => {
    if (!panel || !detail) return;
    if (
      !panelTrigger.current?.isConnected ||
      panelTrigger.current === document.body
    )
      panelTrigger.current =
        document.querySelector<HTMLElement>(
          '.cw-header button[aria-pressed="true"]',
        ) || composer.current;
    if (overlayInspector)
      inspector.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (panelTrigger.current?.isConnected) panelTrigger.current.focus();
    };
  }, [!!panel, overlayInspector, !!detail]);
  useEffect(() => {
    sessionStorage.setItem(`apsis.task-draft.${id}`, draft);
  }, [draft, id]);
  useEffect(() => {
    if (detail && !planDirty) {
      setPlan(detail.task.plan);
      setVersion(detail.task.planVersion);
    }
  }, [detail?.task.planVersion]);
  useEffect(() => {
    if (initialPanel)
      setPanel(
        initialPanel === "git"
          ? "changes"
          : initialPanel === "checks"
            ? ""
            : initialPanel,
      );
  }, [initialPanel]);
  useEffect(() => {
    let live = true;
    if (detail?.task.git && ["changes", "git", "files"].includes(panel))
      void api<GitOverview>(`/coding-tasks/${id}/changes`)
        .then((r) => {
          if (live) {
            setChanges(r);
            if (!r.files.some((f) => f.path === file))
              setFile(r.files[0]?.path || "");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [panel, id, detail?.task.updatedAt]);
  useEffect(() => {
    let live = true;
    setChange(undefined);
    if (file)
      void api<GitOverview>(
        `/coding-tasks/${id}/changes?path=${encodeURIComponent(file)}`,
      )
        .then((r) => {
          if (live) setChange(r.files.find((f) => f.path === file));
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [file, detail?.task.updatedAt]);
  useEffect(() => {
    if (switcher)
      void api<{ branches: string[] }>(`/coding-tasks/${id}/branches`)
        .then((r) => setBranchOptions(r.branches))
        .catch((e) => setError(e.message));
  }, [switcher, id]);
  useEffect(() => {
    sessionStorage.setItem(`apsis.task-panel.${id}`, panel);
    sessionStorage.setItem(`apsis.task-file.${id}`, file);
  }, [id, panel, file]);
  useEffect(() => {
    if (planDirty)
      sessionStorage.setItem(
        `apsis.task-plan.${id}`,
        JSON.stringify({ content: plan, version }),
      );
    else sessionStorage.removeItem(`apsis.task-plan.${id}`);
  }, [id, planDirty, plan, version]);
  const act = async (action: string, body: unknown = {}) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<{
        delivery?: { state: "pending" | "applied" | "not-applied" };
      }>(`/coding-tasks/${id}/${action}`, "POST", body);
      if (action === "steer" && receipt.delivery?.state === "not-applied") {
        // An explicit rejection is final for this id; transport errors keep it
        // so retrying an uncertain response cannot enqueue a duplicate.
        messageRequest.current = undefined;
        throw new Error(
          locale === "en"
            ? "The instructions were not adopted. Your draft is preserved."
            : "補充未採用，草稿已保留。請重新送出。",
        );
      }
      await load();
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || modelIssue || busy) return;
    const inProgress = detail?.jobs.some((job) => job.status === "running");
    const action = inProgress && sendMode === "steer" ? "steer" : "message";
    if (
      messageRequest.current?.prompt !== prompt ||
      messageRequest.current.action !== action
    )
      messageRequest.current = { prompt, action, id: crypto.randomUUID() };
    if (await act(action, { prompt, requestId: messageRequest.current.id })) {
      messageRequest.current = undefined;
      setDraft((current) => (current.trim() === prompt ? "" : current));
      scroll.jumpToLatest();
    }
  };
  const retryUnexecuted = async (jobId: string) => {
    if (!retryRequests.current.has(jobId))
      retryRequests.current.set(jobId, crypto.randomUUID());
    if (
      await act("retry", { jobId, requestId: retryRequests.current.get(jobId) })
    )
      scroll.jumpToLatest();
  };
  const match = /(^|\s)\/([^\s/]*)$/.exec(draft.slice(0, caret));
  const suggestions =
    !slashDismissed && match
      ? skills
          .filter((s) =>
            (s.name + " " + s.description)
              .toLowerCase()
              .includes(match[2].toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const choose = (skill: Skill) => {
    const prefix =
      draft.slice(0, caret - (match?.[2].length || 0) - 1) + `/${skill.name} `;
    setDraft(prefix + draft.slice(caret));
    setCaret(prefix.length);
    requestAnimationFrame(() => {
      composer.current?.focus();
      composer.current?.setSelectionRange(prefix.length, prefix.length);
    });
    setSlashDismissed(true);
  };
  if (!detail)
    return (
      <section className="cw-workspace">
        <button onClick={back}>
          ← {locale === "en" ? "Back to Bot" : "返回 Bot"}
        </button>
        <p role="status">
          {error || (locale === "en" ? "Loading task…" : "正在載入任務…")}
        </p>
        {error && (
          <button onClick={() => void load().catch((e) => setError(e.message))}>
            {text("重新載入")}
          </button>
        )}
      </section>
    );
  const t = detail.task,
    running = detail.jobs.some((j) => ["queued", "running"].includes(j.status));
  const summaries = new Map(
    detail.runs.map((run) => [run.id, taskRunSummary(run, detail)]),
  );
  const activeRun = detail.runs.findLast((run) => run.status === "running");
  const toggleRun = (runId: string) =>
    setExpandedRuns((current) => ({ ...current, [runId]: !current[runId] }));
  const runRecord = (run: TaskRun): RunRecord => {
    const parent = detail.jobs.find((job) => job.runId === run.id);
    return {
      run,
      delegations: detail.delegations
        .filter((job) => job.parentJobId === parent?.id)
        .map((job) => ({
          ...job,
          targetName:
            botNames?.[job.botId] ||
            (locale === "en" ? "Collaborating Bot" : "協作 Bot"),
          peerId: job.botId,
          peerName:
            botNames?.[job.botId] ||
            (locale === "en" ? "Collaborating Bot" : "協作 Bot"),
          outgoing: true,
          waitingApproval: detail.approvals.some(
            (approval) => approval.runId === job.runId,
          ),
        })),
    };
  };
  const renderHistory = (run: TaskRun) => (
    <RunHistory
      key={run.id}
      botId={t.botId}
      summary={summaries.get(run.id)!}
      record={runRecord(run)}
      open={!!expandedRuns[run.id]}
      toggle={() => toggleRun(run.id)}
      select={selectBot || (() => {})}
      available={availableBots || new Set()}
    />
  );
  const renderedRuns = new Set(
    detail.session.messages
      .filter((message) => message.role === "assistant")
      .map((message) => message.runId),
  );
  const unmatchedRuns = detail.runs.filter(
    (run) => run.status !== "running" && !renderedRuns.has(run.id),
  );
  const focusApprovals = () => {
    const card = document.getElementById(`cw-approvals-${id}`);
    card?.scrollIntoView({ block: "nearest" });
    card?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  return (
    <section
      className={`cw-workspace ${panel ? "cw-panel-open" : ""}`}
      style={
        { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties
      }
    >
      <header className="cw-header" inert={!!panel && overlayInspector}>
        <button onClick={back}>
          ← {locale === "en" ? `${name}'s conversation` : `${name} 的對話`}
        </button>
        <span className={`cw-tag phase-${t.phase}`}>
          {detail.approvals.length ? text("需處理") : phaseLabel(t.phase)}
        </span>
        <div className="cw-title-row">
          <h1 title={t.title}>{compactTaskTitle(t.title)}</h1>
          <button
            className="cw-rename"
            aria-label={locale === "en" ? "Rename task" : "重新命名任務"}
            onClick={() => {
              setTitleDraft(Array.from(t.title).slice(0, 80).join(""));
              setRenaming(true);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5" />
            </svg>
          </button>
        </div>
        <div className="cw-meta">
          <BrandMark avatar={avatar} size={24} />
          <span>{name}</span>
          {t.git && (
            <button
              disabled={running}
              onClick={() => setSwitcher(!switcher)}
              title={t.location.path}
            >
              ⑂ {changes?.branch || t.git.branch}
            </button>
          )}
          <small title={t.location.path}>
            {text(t.projectId ? "專案任務" : "獨立工作資料夾")}
          </small>
        </div>
        {switcher && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act("branch", { branch: newBranch }).then((ok) => {
                if (ok) setSwitcher(false);
              });
            }}
          >
            <label>
              {text("切換至新的任務分支")}
              <input
                list="task-branches"
                value={newBranch}
                placeholder={text("選擇分支或輸入新名稱")}
                onChange={(e) => setNewBranch(e.target.value)}
              />
              <datalist id="task-branches">
                {branchOptions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <button disabled={busy}>{text("切換分支")}</button>
          </form>
        )}
        {t.pullRequest && (
          <div className="cw-pr">
            <a href={t.pullRequest.url} target="_blank" rel="noreferrer">
              PR · {t.pullRequest.status} ↗
            </a>
            <small>
              {t.pullRequest.error ||
                text("持續跟進 CI 與 Review；正式核准及合併回 Git 平台。")}
            </small>
          </div>
        )}
        <nav aria-label={text("任務工具")}>
          {[
            ["changes", "查看變更"],
            ["files", "檔案"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={panel === key}
              onClick={() => setPanel(panel === key ? "" : key)}
            >
              {text(label)}
              {key === "changes" && changes ? ` ${changes.files.length}` : ""}
            </button>
          ))}
          {!running && t.phase !== "done" && (
            <button disabled={busy} onClick={() => void act("complete")}>
              {text("標記完成")}
            </button>
          )}
        </nav>
      </header>
      {error && (
        <div className="cw-error" role="alert">
          {error}
          <button onClick={() => setError("")}>{text("關閉")}</button>
        </div>
      )}
      <div className="cw-body">
        <div
          className="cw-discussion conversation-shell"
          inert={!!panel && overlayInspector}
        >
          <div
            className="cw-messages"
            ref={scroll.viewportRef}
            onScroll={scroll.onScroll}
          >
            <div className="cw-message-content">
              {(t.mode === "plan" || t.plan) && (
                <article className="cw-plan-card">
                  <header>
                    <strong>
                      {text(t.mode === "plan" ? "任務計畫" : "已採用的計畫")}
                    </strong>
                    <span className="cw-muted">v{t.planVersion}</span>
                  </header>
                  {t.plan ? (
                    <details className="cw-plan-preview">
                      <summary>{planSummary(t.plan)}</summary>
                      <div
                        className="markdown"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(t.plan),
                        }}
                      />
                    </details>
                  ) : (
                    <p>{text("Bot 正在整理計畫，完成後可在這裡確認。")}</p>
                  )}
                  <footer>
                    <button onClick={() => setPanel("plan")}>
                      {text(t.mode === "plan" ? "編輯計畫" : "查看計畫文件")}
                      {planDirty
                        ? locale === "en"
                          ? " · Draft"
                          : " · 有草稿"
                        : ""}
                    </button>
                    {t.mode === "plan" && (
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          running ||
                          planDirty ||
                          t.phase !== "plan-ready"
                        }
                        onClick={() => void act("start", { version })}
                      >
                        {text("開始實作")}
                      </button>
                    )}
                  </footer>
                </article>
              )}
              {!connected || loadFailed ? (
                <div className="cw-connection-notice" role="status">
                  <span>{text("連線中斷，目前顯示最後收到的狀態。")}</span>
                  <button
                    onClick={() => void load().catch(() => setLoadFailed(true))}
                  >
                    {text("重新連線")}
                  </button>
                </div>
              ) : null}
              {!detail.session.messages.length && !running && (
                <p className="cw-muted">
                  {text("尚無交辦紀錄。輸入訊息開始工作。")}
                </p>
              )}
              {detail.session.messages.map((message) => {
                const startVersion =
                  message.role === "user"
                    ? planStartVersion(message.content)
                    : undefined;
                const run =
                  message.role === "assistant"
                    ? detail.runs.find((item) => item.id === message.runId)
                    : undefined;
                const artifacts = run
                  ? detail.artifacts.filter(
                      (artifact) =>
                        artifact.runId === run.id && artifact.kind === "result",
                    )
                  : [];
                const runWarning = run?.operations.some(
                  (operation) => operation.status === "unknown",
                )
                  ? "有操作結果不明，請查看紀錄。"
                  : run?.operations.some(
                        (operation) => operation.status === "failed",
                      )
                    ? "有操作失敗，請查看紀錄。"
                    : undefined;
                const job =
                  message.role === "user" && message.runId
                    ? detail.jobs.find(
                        (item) =>
                          item.runId === message.runId &&
                          item.status === "running",
                      )
                    : undefined;
                return (
                  <article
                    key={message.id}
                    className={`cw-message ${message.role}`}
                  >
                    <strong>
                      {message.role === "user" ? text("你") : name}
                    </strong>
                    {run && renderHistory(run)}
                    {startVersion ? (
                      <details className="cw-plan-message">
                        <summary>
                          {locale === "en"
                            ? `Start implementation from plan v${startVersion}`
                            : `依計畫 v${startVersion} 開始實作`}
                        </summary>
                        <div
                          className="markdown"
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(message.content),
                          }}
                        />
                      </details>
                    ) : (
                      <div
                        className="markdown"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(message.content),
                        }}
                      />
                    )}
                    {message.delivery ? (
                      <small
                        className="message-delivery"
                        data-state={message.delivery.state}
                        title={
                          locale === "en"
                            ? "Adopted means included in a model turn, not completed."
                            : "已採用表示帶入模型回合，不代表工作完成。"
                        }
                      >
                        {message.delivery.state === "applied"
                          ? text("已採用")
                          : message.delivery.state === "not-applied"
                            ? locale === "en"
                              ? "Not adopted"
                              : "未採用"
                            : text("待採用")}
                      </small>
                    ) : (
                      job && (
                        <small className="cw-adopted">{text("已採用")}</small>
                      )
                    )}
                    {run && run.operations.length > 0 && (
                      <div className="cw-outcome-note">
                        {runWarning && <span>{text(runWarning)}</span>}
                        <button
                          onClick={() => setPanel(t.git ? "changes" : "files")}
                        >
                          {text(t.git ? "查看變更" : "檔案")}
                        </button>
                      </div>
                    )}
                    {artifacts.map((artifact) => (
                      <a
                        className="artifact-card"
                        key={artifact.id}
                        href={`/api/v2/artifacts/${artifact.id}`}
                        download={artifact.name}
                      >
                        {artifact.name} ↓
                      </a>
                    ))}
                  </article>
                );
              })}
              {activeRun && (
                <article className="cw-message assistant live">
                  <strong>{name}</strong>
                  <ProgressStrip
                    summary={summaries.get(activeRun.id)!}
                    connected={connected && !loadFailed}
                    open={!!expandedRuns[activeRun.id]}
                    toggle={() => toggleRun(activeRun.id)}
                    approve={focusApprovals}
                  />
                  {expandedRuns[activeRun.id] && renderHistory(activeRun)}
                  {detail.session.live?.text && (
                    <div
                      className="markdown"
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdown(detail.session.live.text),
                      }}
                    />
                  )}
                </article>
              )}
              {running && !activeRun && (
                <p className="cw-queued-message" role="status">
                  {text("排隊中")}
                </p>
              )}
              {detail.jobs
                .filter((job) => job.status === "queued")
                .map((job) => (
                  <article className="cw-queued-message" key={job.id}>
                    <strong>{text("待採用")}</strong>
                    <p>{job.prompt}</p>
                    <small>{text("補充會在目前執行完成後接續。")}</small>
                  </article>
                ))}
              {detail.jobs
                .filter(
                  (job) =>
                    !job.runId &&
                    ["interrupted", "cancelled", "failed"].includes(job.status),
                )
                .map((job) => {
                  const retried = detail.jobs.some(
                    (attempt) => attempt.retryOf === job.id,
                  );
                  const promptCharacters = Array.from(job.prompt);
                  return (
                    <article
                      key={job.id}
                      className="cw-unexecuted-message"
                      data-job-id={job.id}
                    >
                      <strong>
                        {retried
                          ? locale === "en"
                            ? "Instructions resent"
                            : "補充已重新送出"
                          : locale === "en"
                            ? "Instructions did not run"
                            : "補充尚未執行"}
                      </strong>
                      <p>
                        {promptCharacters.length > 160
                          ? promptCharacters.slice(0, 159).join("") + "…"
                          : job.prompt}
                      </p>
                      {promptCharacters.length > 160 && (
                        <details>
                          <summary>
                            {locale === "en"
                              ? "Original instructions"
                              : "完整原始指示"}
                          </summary>
                          <p>{job.prompt}</p>
                        </details>
                      )}
                      <small>
                        {job.error ||
                          (job.status === "cancelled"
                            ? locale === "en"
                              ? "Work was stopped before these instructions started."
                              : "工作已停止，這則補充尚未開始執行。"
                            : locale === "en"
                              ? "This queued work ended before a run started."
                              : "這則排隊工作在開始執行前已結束。")}
                      </small>
                      {!retried && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy || !!modelIssue}
                          onClick={() => void retryUnexecuted(job.id)}
                        >
                          {locale === "en" ? "Send again" : "重新送出"}
                        </button>
                      )}
                    </article>
                  );
                })}
              {unmatchedRuns.length > 0 && (
                <details className="cw-run-log">
                  <summary>
                    {text("其他執行紀錄")} · {unmatchedRuns.length}
                  </summary>
                  {unmatchedRuns.map(renderHistory)}
                </details>
              )}
              {detail.artifacts
                .filter(
                  (artifact) =>
                    !artifact.runId || !renderedRuns.has(artifact.runId),
                )
                .map((artifact) => (
                  <a
                    className="artifact-card"
                    key={artifact.id}
                    href={`/api/v2/artifacts/${artifact.id}`}
                    download={artifact.name}
                  >
                    {artifact.name} ↓
                  </a>
                ))}
              <div id={`cw-approvals-${id}`}>
                {detail.approvals.map((approval) => (
                  <WorkApproval
                    key={approval.id}
                    approval={approval}
                    disabled={busy}
                    onDecide={async (approvalId, approved, remember) => {
                      await api(`/approvals/${approvalId}`, "POST", {
                        approved,
                        ...(remember ? { remember } : {}),
                      });
                      await load();
                      await refresh();
                    }}
                  />
                ))}
              </div>
              <CodingVerification
                api={api}
                taskId={id}
                updateKey={t.updatedAt}
              />
            </div>
          </div>
          {scroll.hasNewContent && (
            <button
              className="cw-jump-latest jump-latest"
              onClick={scroll.jumpToLatest}
            >
              {text("回到最新")} ↓
            </button>
          )}
          <ComposerFrame
            className="cw-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {modelIssue && (
              <div className="composer-model-issue" role="status">
                <span>{modelIssue}</span>
                {onModelSettings && (
                  <button type="button" onClick={onModelSettings}>
                    {locale === "en"
                      ? "Fix this Bot's model"
                      : "修正此 Bot 的模型"}
                  </button>
                )}
              </div>
            )}
            {suggestions.length > 0 && (
              <div role="listbox" aria-label="Skills">
                {suggestions.map((s, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === skillIndex}
                    key={s.id}
                    onClick={() => choose(s)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={composer}
              rows={1}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              aria-label={text("補充指示")}
              placeholder={text("補充想法，或輸入 / 選用 Skill")}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCaret(e.target.selectionStart);
                setSlashDismissed(false);
                setSkillIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") setSlashDismissed(true);
                if (
                  suggestions.length &&
                  ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)
                ) {
                  e.preventDefault();
                  if (e.key === "Enter")
                    choose(suggestions[skillIndex] || suggestions[0]);
                  else
                    setSkillIndex(
                      (skillIndex +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        suggestions.length) %
                        suggestions.length,
                    );
                } else if (e.key === "Enter" && !phone && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="cw-compose-toolbar">
              {onSettingsSaved && onSettingsReload && (
                <ApprovalModeControl
                  settings={settings}
                  api={api}
                  onSaved={onSettingsSaved}
                  onReload={onSettingsReload}
                />
              )}
              <small className="cw-compose-hint">
                {running
                  ? sendMode === "queue"
                    ? text("補充會在目前執行完成後接續。")
                    : locale === "en"
                      ? "Instructions join the current work."
                      : "將補充帶入目前工作。"
                  : text(
                      phone
                        ? "點選按鈕傳送"
                        : "Enter 傳送 · Shift + Enter 換行",
                    )}
              </small>
              {running && (
                <select
                  className="cw-send-mode"
                  aria-label={locale === "en" ? "Send mode" : "傳送方式"}
                  value={sendMode}
                  onChange={(event) =>
                    setSendMode(event.target.value as "steer" | "queue")
                  }
                >
                  <option value="steer">
                    {locale === "en" ? "Current work" : "補充目前工作"}
                  </option>
                  <option value="queue">{text("排入下一項")}</option>
                </select>
              )}
              {running && (
                <button
                  type="button"
                  className="cw-stop"
                  disabled={busy}
                  onClick={() => void act("stop")}
                >
                  {locale === "en" ? "Stop" : "停止"}
                </button>
              )}
              <button
                className="primary"
                disabled={busy || !draft.trim() || !!modelIssue}
              >
                {text(
                  running && sendMode === "queue" ? "排入下一項" : "補充指示",
                )}
              </button>
            </div>
          </ComposerFrame>
        </div>
        {panel && overlayInspector && (
          <button
            className="cw-inspector-backdrop"
            tabIndex={-1}
            aria-hidden="true"
            aria-label={text("關閉工具返回討論")}
            onClick={() => setPanel("")}
          />
        )}
        {panel && (
          <aside
            className="cw-inspector"
            ref={inspector}
            role={overlayInspector ? "dialog" : undefined}
            aria-modal={overlayInspector ? true : undefined}
            aria-label={text("工作內容")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setPanel("");
              }
              if (overlayInspector && event.key === "Tab") {
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
                  ),
                ).filter((element) => element.offsetParent !== null);
                const first = items[0],
                  last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <InspectorResize
              value={inspectorWidth}
              onChange={setInspectorWidth}
              label={text("調整檢視區寬度")}
            />
            <header>
              <nav className="cw-panel-tabs" aria-label={text("工作內容")}>
                <button
                  aria-pressed={panel === "files"}
                  onClick={() => setPanel("files")}
                >
                  {text("檔案")}
                </button>
                <button
                  aria-pressed={panel === "changes"}
                  onClick={() => setPanel("changes")}
                >
                  {text("變更")}
                </button>
                {panel === "plan" && <span>{text("計畫文件")}</span>}
              </nav>
              <button
                aria-label={text("關閉工具返回討論")}
                onClick={() => setPanel("")}
              >
                ×
              </button>
            </header>
            {panel === "changes" &&
              (!t.git ? (
                <p>{text("此任務沒有 Git 專案。可從「檔案」查看成果。")}</p>
              ) : (
                <>
                  {t.git && (
                    <details className="cw-git-details">
                      <summary>{text("分支與提交紀錄")}</summary>
                      <p>起始分支：{t.git?.base || "無"}</p>
                      <p>PR 目標：{t.git?.target || "無"}</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("target", { branch: target });
                        }}
                      >
                        <label>
                          {text("調整 PR 目標")}
                          <input
                            value={target}
                            placeholder={t.git?.target}
                            onChange={(e) => setTarget(e.target.value)}
                          />
                        </label>
                        <button disabled={busy || running || !target}>
                          {text("套用")}
                        </button>
                      </form>
                      <pre
                        className="cw-git-graph"
                        aria-label={text("Git 分支圖")}
                      >
                        {changes?.graph}
                      </pre>
                      <ol className="cw-commits">
                        {changes?.commits.map((c) => (
                          <li key={c.hash}>
                            <code>{c.hash.slice(0, 8)}</code> {c.subject}
                            <small>{c.refs}</small>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}

                  <p className="cw-muted">
                    與起始版本 {t.git.baseCommit.slice(0, 8)} 比較
                  </p>
                  <div className="cw-file-list">
                    {changes?.files.map((f) => (
                      <button
                        key={f.path}
                        aria-pressed={file === f.path}
                        onClick={() => setFile(f.path)}
                      >
                        <span>{f.status}</span>
                        {f.path}
                      </button>
                    ))}
                    {changes && !changes.files.length && (
                      <p>{text("目前沒有修改檔案。")}</p>
                    )}
                  </div>
                  {change && (
                    <>
                      <div className="cw-diff-heading">
                        <strong>{change.path}</strong>
                        <button onClick={() => setInline(!inline)}>
                          {text(inline ? "左右比較" : "行內比較")}
                        </button>
                      </div>
                      {change.binary || change.truncated ? (
                        <p>
                          {text(
                            "二進位或超過 1 MiB 的檔案，請從檔案面板下載查看。",
                          )}
                        </p>
                      ) : (
                        <Diff
                          before={change.before || ""}
                          after={change.after || ""}
                          inline={inline}
                        />
                      )}
                      <button
                        className="secondary"
                        onClick={() => {
                          const selection = window.getSelection()?.toString();
                          setDraft(
                            (d) =>
                              d +
                              `\n請調整 ${file}${selection ? `：\n${selection.slice(0, 6000)}` : ""}\n`,
                          );
                          if (overlayInspector) setPanel("");
                          requestAnimationFrame(() =>
                            composer.current?.focus(),
                          );
                        }}
                      >
                        {text("引用程式碼，請 Bot 修改")}
                      </button>
                    </>
                  )}
                </>
              ))}
            {panel === "files" && detail.session.context && (
              <FilePanel
                storageKey={`apsis.task-browser-file.${id}`}
                gitStatus={Object.fromEntries(
                  (changes?.files || []).map((f) => [f.path, f.status]),
                )}
                context={detail.session.context}
                api={api}
                updateKey={t.updatedAt}
                reference={(ref) => {
                  setDraft((d) => d + `\n請查看檔案 ${ref.path}\n`);
                  if (overlayInspector) setPanel("");
                  requestAnimationFrame(() => composer.current?.focus());
                }}
              />
            )}
            {panel === "plan" && (
              <>
                <p>
                  {text(
                    t.mode === "plan"
                      ? "調整計畫後儲存，再開始實作。"
                      : "已採用的計畫",
                  )}{" "}
                  · v{version}
                </p>
                <textarea
                  className="cw-plan"
                  aria-label={text("計畫文件")}
                  value={plan}
                  readOnly={t.mode !== "plan"}
                  onChange={(e) => {
                    setPlan(e.target.value);
                    setPlanDirty(true);
                  }}
                />
                {planDirty && detail.task.planVersion !== version && (
                  <p role="alert">
                    {text("計畫已有新版本，草稿保留；請比較後重新載入。")}
                  </p>
                )}
                {t.mode === "plan" && (
                  <div className="cw-actions">
                    <button
                      disabled={busy || running || !planDirty}
                      onClick={() =>
                        void act("plan", { content: plan, version }).then(
                          (ok) => {
                            if (ok) {
                              setPlanDirty(false);
                              setVersion(version + 1);
                            }
                          },
                        )
                      }
                    >
                      {text("儲存計畫")}
                    </button>
                    <button
                      onClick={() => {
                        if (
                          !planDirty ||
                          confirm(text("捨棄草稿並載入最新計畫？"))
                        ) {
                          setPlan(detail.task.plan);
                          setVersion(detail.task.planVersion);
                          setPlanDirty(false);
                        }
                      }}
                    >
                      {text("重新載入")}
                    </button>
                    <button
                      className="primary"
                      disabled={
                        busy || running || planDirty || t.phase !== "plan-ready"
                      }
                      onClick={() => void act("start", { version })}
                    >
                      {text("開始實作")}
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
      {renaming && (
        <Modal
          label={locale === "en" ? "Rename task" : "重新命名任務"}
          close={() => setRenaming(false)}
        >
          <section className="modal cw-rename-dialog">
            <h2>{locale === "en" ? "Rename task" : "重新命名任務"}</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act("rename", { title: titleDraft.trim() }).then((ok) => {
                  if (ok) setRenaming(false);
                });
              }}
            >
              <label>
                {locale === "en" ? "Task name" : "任務名稱"}
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={160}
                  onChange={(event) =>
                    setTitleDraft(
                      Array.from(event.target.value).slice(0, 80).join(""),
                    )
                  }
                />
              </label>
              {error && (
                <p role="alert" className="cw-error">
                  {error}
                </p>
              )}
              <div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRenaming(false)}
                >
                  {locale === "en" ? "Cancel" : "取消"}
                </button>
                <button
                  className="primary"
                  disabled={busy || !titleDraft.trim()}
                >
                  {locale === "en" ? "Save" : "儲存"}
                </button>
              </div>
            </form>
          </section>
        </Modal>
      )}
    </section>
  );
}
function Diff({
  before,
  after,
  inline,
}: {
  before: string;
  after: string;
  inline: boolean;
}) {
  const rows = useMemo(() => {
    const chunks = diffLines(before, after, { timeout: 250 });
    if (!chunks) return null;
    const left: React.ReactNode[] = [],
      right: React.ReactNode[] = [],
      unified: React.ReactNode[] = [];
    let old = 0,
      next = 0,
      key = 0;
    const lines = (value: string) =>
      value ? value.replace(/\n$/, "").split("\n") : [];
    const row = (n: number | null, line: string, kind = "") => (
      <div key={key++} className={"cw-diff-line " + kind}>
        <span>{n ?? ""}</span>
        <code>{line || " "}</code>
      </div>
    );
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i];
      if (!part.added && !part.removed) {
        for (const line of lines(part.value)) {
          left.push(row(++old, line));
          right.push(row(++next, line));
          unified.push(row(next, line));
        }
        continue;
      }
      const removed = part.removed ? lines(part.value) : [];
      const added = part.added
        ? lines(part.value)
        : chunks[i + 1]?.added
          ? lines(chunks[++i].value)
          : [];
      for (let j = 0; j < Math.max(removed.length, added.length); j++) {
        left.push(
          j < removed.length
            ? row(++old, removed[j], "removed")
            : row(null, "", "empty"),
        );
        right.push(
          j < added.length
            ? row(++next, added[j], "added")
            : row(null, "", "empty"),
        );
      }
      removed.forEach((line, j) =>
        unified.push(row(old - removed.length + j + 1, line, "removed")),
      );
      added.forEach((line, j) =>
        unified.push(row(next - added.length + j + 1, line, "added")),
      );
    }
    return { left, right, unified };
  }, [before, after]);
  if (!rows) return <p>{text("此檔案差異較大，請從檔案面板下載查看。")}</p>;
  return (
    <div className={`cw-diff ${inline ? "inline" : ""}`}>
      <div className="cw-diff-split">
        <section aria-label={text("修改前")}>{rows.left}</section>
        <section aria-label={text("修改後")}>{rows.right}</section>
      </div>
      <div className="cw-diff-unified" aria-label={text("行內比較")}>
        {rows.unified}
      </div>
    </div>
  );
}
