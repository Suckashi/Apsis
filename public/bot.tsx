import { ComposerPopover } from "./composer-popover.tsx";
import { ContextPanel } from "./context-panel.tsx";
import { ApprovalModeControl } from "./approval-mode-control.tsx";
import { approvalReason } from "../shared/approval.ts";
import { uiText, uiError } from "./settings-dictionary.ts";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { renderMarkdown } from "./markdown.ts";
import { parseMcpConnectorJson, type McpConnectorInput } from "./mcp-json.ts";
import {
  BrandMark,
  AvatarPicker,
  CopyButton,
  DetailSection,
  Modal,
  useDrawer,
  useWorkspaceLayout,
} from "./bot-ui.tsx";
import type { ProductService } from "../server/product.ts";
import type { Routine, Artifact, Draft } from "../shared/product.ts";
import type { TelegramView } from "../shared/types.ts";
import {
  LegacyDelegations,
  ProgressStrip,
  RunHistory,
  RunStats,
  RunOutcome,
} from "./task-history.tsx";
import {
  ActionFeedback,
  ActivityMark,
  ConversationLoading,
} from "./activity-feedback.tsx";
import { taskText, taskProgress } from "./task-locale.ts";
import { ProviderSettings } from "./provider-settings.tsx";
import {
  BotAccessFields,
  ExecutionSettings,
  PermissionEditor,
} from "./settings-controls.tsx";
import { TemplateSettings } from "./settings-templates.tsx";
import {
  settingsText as t,
  useSettingsLocale,
  setSettingsLocale,
  getSettingsLocale,
} from "./settings-locale.ts";
import type {
  Settings as GlobalSettings,
  PermissionRule,
} from "../shared/settings.ts";

type Snapshot = ReturnType<ProductService["snapshot"]>;
type Detail = ReturnType<ProductService["detail"]>;
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    path.startsWith("/api/") ? path : "/api/v2" + path,
    {
      method,
      headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error ? uiError(data.error) : uiText("操作失敗")),
      {
        status: response.status,
      },
    );
  return data;
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    moon: <path d="M20 14a8.5 8.5 0 0 1-10-10A8.5 8.5 0 1 0 20 14Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    send: <path d="m5 12 7-7 7 7M12 5v14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    pin: <path d="m16 3 5 5-3 1-2 4-2 2-5-5 2-2 4-2 1-3ZM9 15l-5 5" />,
    settings: (
      <>
        <path d="M 19.825 10.337 L 21.781 9.921 A 10 10 0 0 1 21.781 14.079 L 19.825 13.663 A 8 8 0 0 1 18.709 16.357 L 20.387 17.446 A 10 10 0 0 1 17.446 20.387 L 16.357 18.709 A 8 8 0 0 1 13.663 19.825 L 14.079 21.781 A 10 10 0 0 1 9.921 21.781 L 10.337 19.825 A 8 8 0 0 1 7.643 18.709 L 6.554 20.387 A 10 10 0 0 1 3.613 17.446 L 5.291 16.357 A 8 8 0 0 1 4.175 13.663 L 2.219 14.079 A 10 10 0 0 1 2.219 9.921 L 4.175 10.337 A 8 8 0 0 1 5.291 7.643 L 3.613 6.554 A 10 10 0 0 1 6.554 3.613 L 7.643 5.291 A 8 8 0 0 1 10.337 4.175 L 9.921 2.219 A 10 10 0 0 1 14.079 2.219 L 13.663 4.175 A 8 8 0 0 1 16.357 5.291 L 17.446 3.613 A 10 10 0 0 1 20.387 6.554 L 18.709 7.643 A 8 8 0 0 1 19.825 10.337 Z" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M15 4v16" />
      </>
    ),
    focus: <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />,
    monitor: (
      <>
        <rect x="3" y="3" width="18" height="13" rx="2" />
        <path d="M12 16v5M8 21h8" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z M14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    attach: (
      <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M6 15l9-9" />
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="m14 6-6 6 6 6" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    spark: (
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" />
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
const time = (at: string) => {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const daysAgo = Math.round((day(now) - day(date)) / 86_400_000);
  if (daysAgo === 0)
    return date.toLocaleTimeString(getSettingsLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  if (daysAgo === 1) return uiText("昨天");
  if (daysAgo > 1 && daysAgo < 7)
    return date.toLocaleDateString(getSettingsLocale(), { weekday: "short" });
  return date.toLocaleDateString(getSettingsLocale(), {
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "numeric",
    day: "numeric",
  });
};
const chatPreview = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
function Markdown({ text }: { text: string }) {
  return (
    <div
      className="markdown"
      onClick={async (event) => {
        const button = (event.target as HTMLElement).closest(".copy-code");
        if (button) {
          try {
            await navigator.clipboard.writeText(
              button.closest(".code-block")?.querySelector("code")
                ?.textContent || "",
            );
            button.textContent = uiText("已複製");
          } catch {
            button.textContent = uiText("複製失敗");
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

function App() {
  const locale = useSettingsLocale();
  const feedbackText = (text: string) => taskText(locale, text);
  useEffect(() => {
    let cancelled = false;
    void api<GlobalSettings>("/settings")
      .then((settings) => {
        if (!cancelled) setSettingsLocale(settings.locale);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [state, setState] = useState<Snapshot>();
  const [approvalSettings, setApprovalSettings] = useState<GlobalSettings>();
  const acceptApprovalSettings = useCallback((next: GlobalSettings) => {
    setApprovalSettings((old) =>
      !old || next.revision >= old.revision ? next : old,
    );
  }, []);
  const [detail, setDetail] = useState<Detail>();
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem("apsis.bot"),
  );
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("apsis.theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"),
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("apsis.theme", theme);
  }, [theme]);
  const {
    smallScreen,
    overlayDetails,
    mobileList,
    setMobileList,
    listVisible,
    panel,
    setPanel,
    focusMode,
    toggleFocus,
    toggleList,
    closeList,
  } = useWorkspaceLayout();
  const sidebarRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const [sendMode, setSendMode] = useState("queue");
  const draftSelection = useRef({ start: 0, end: 0 });
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [profile, setProfile] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    botId: string;
    label: string;
    pending: boolean;
  }>();
  const [stoppingBot, setStoppingBot] = useState<string>();
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [attachments, setAttachments] = useState<Artifact[]>([]);
  const [retryOf, setRetryOf] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  const [quotedPreview, setQuotedPreview] = useState<{
    id: string;
    content: string;
  }>();
  const [routine, setRoutine] = useState<Routine | "new">();
  const [expanded, setExpanded] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [eventsConnected, setEventsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const listDrawer = smallScreen && mobileList;
  const detailsDrawer =
    overlayDetails && panel && !!selected && !!detail && !listDrawer;
  useDrawer(sidebarRef, listDrawer, () => setMobileList(false));
  useDrawer(detailsRef, detailsDrawer, () => setPanel(false));
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "0px";
      const maximum = parseFloat(getComputedStyle(element).maxHeight);
      element.style.height = `${Math.min(element.scrollHeight, maximum)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [text, selected]);
  const upload = useRef<HTMLInputElement>(null);
  const pendingRequest = useRef<
    { prompt: string; botId: string; id: string } | undefined
  >(undefined);
  const generation = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const id = selectedRef.current;
    const [next, nextSettings] = await Promise.all([
      api<Snapshot>("/state"),
      api<GlobalSettings>("/settings"),
    ]);
    const nextDetail =
      id && next.bots.some((bot) => bot.id === id)
        ? await api<Detail>(`/bots/${id}?view=summary`).catch((error) => {
            if (error.status === 404) return undefined;
            throw error;
          })
        : undefined;
    if (version !== generation.current || id !== selectedRef.current) return;
    setState(next);
    acceptApprovalSettings(nextSettings);
    setDetail((old) => {
      if (!old || !nextDetail || old.bot.id !== nextDetail.bot.id)
        return nextDetail;
      const first = nextDetail.session.messages[0]?.sequence ?? Infinity;
      const earlier = old.session.messages.filter(
        (m) => (m.sequence ?? Infinity) < first,
      );
      return {
        ...nextDetail,
        session: {
          ...nextDetail.session,
          messages: [...earlier, ...nextDetail.session.messages],
          olderCursor: earlier.length
            ? old.session.olderCursor
            : nextDetail.session.olderCursor,
        },
      };
    });
    if (id && !nextDetail) {
      selectedRef.current = null;
      setSelected(null);
      localStorage.removeItem("apsis.bot");
    }
  }, [acceptApprovalSettings]);
  const perform = async (fn: () => Promise<unknown>) => {
    try {
      setError("");
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    let events: EventSource;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const disconnected = () => {
      setEventsConnected(false);
      setConnectionLost(true);
    };
    const connect = () => {
      events?.close();
      events = new EventSource("/api/v2/events");
      events.onopen = () => {
        setEventsConnected(true);
        setConnectionLost(false);
        void refresh().catch((e) => setError(e.message));
      };
      events.onerror = disconnected;
      events.onmessage = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          void refresh().catch((e) => setError(e.message));
        }, 160);
      };
    };
    const offline = () => {
      events?.close();
      clearTimeout(timer);
      timer = undefined;
      disconnected();
    };
    if (navigator.onLine) connect();
    else disconnected();
    window.addEventListener("offline", offline);
    window.addEventListener("online", connect);
    return () => {
      events?.close();
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connect);
    };
  }, [refresh]);
  useEffect(() => {
    setDetail(undefined);
    setText("");
    setSendMode("queue");
    setDismissedSuggestion(false);
    draftSelection.current = { start: 0, end: 0 };
    setAttachments([]);
    setReplyTo(undefined);
    setRetryOf(undefined);
    setProfile(false);
    setAwayFromBottom(false);
    pinnedBottom.current = true;
    if (selected) {
      localStorage.setItem("apsis.bot", selected);
      void api(`/bots/${selected}`, "PATCH", { read: true })
        .then(refresh)
        .catch((e) => setError(e.message));
    }
  }, [selected, refresh]);
  useEffect(() => {
    if (!actionFeedback || actionFeedback.pending) return;
    const timer = setTimeout(() => setActionFeedback(undefined), 5000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);
  useEffect(() => {
    if (pinnedBottom.current)
      bottom.current?.scrollIntoView({ behavior: "instant" });
  }, [detail?.session.messages.length, detail?.session.live?.text, selected]);
  const select = (id: string) => {
    setSelected(id);
    setMobileList(false);
  };
  const newBot = () => {
    setMobileList(false);
    setCreating(true);
  };
  const send = async (steer = false) => {
    if (steer && (retryOf || !text.trim())) return;
    if (!selected || !detail || busy || (!text.trim() && !attachments.length))
      return;
    const prompt = [
      text.trim(),
      ...attachments.map((a) =>
        uiText("附件：{0}，工作區路徑：{1}", [a.name, a.path]),
      ),
    ]
      .filter(Boolean)
      .join("\n");
    if (
      pendingRequest.current?.prompt !== prompt ||
      pendingRequest.current?.botId !== selected
    )
      pendingRequest.current = {
        prompt,
        botId: selected,
        id: crypto.randomUUID(),
      };
    const botId = selected;
    const queued = !!detail?.session.running && !steer;
    setBusy(true);
    setError("");
    setActionFeedback({
      botId,
      label: steer ? "正在送出補充指示…" : "正在送出訊息…",
      pending: true,
    });
    try {
      await api(`/bots/${selected}/${steer ? "steer" : "messages"}`, "POST", {
        prompt,
        requestId: pendingRequest.current.id,
        replyTo,
        retryOf,
      });
      pendingRequest.current = undefined;
      if (selectedRef.current === botId) {
        setText("");
        setSendMode("queue");
        draftSelection.current = { start: 0, end: 0 };
        setAttachments([]);
        setReplyTo(undefined);
        setRetryOf(undefined);
        pinnedBottom.current = true;
      }
      setActionFeedback({
        botId,
        label: steer
          ? "補充指示已送達"
          : queued
            ? "已排入下一個任務"
            : "訊息已送達",
        pending: false,
      });
      await refresh();
    } catch (e) {
      setActionFeedback(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || !selected || busy) return;
    const botId = selected;
    setBusy(true);
    setError("");
    try {
      for (const [index, file] of Array.from(files).entries()) {
        setActionFeedback({
          botId,
          label: `${feedbackText("正在上傳附件")} ${index + 1}/${files.length} · ${file.name}`,
          pending: true,
        });
        if (file.size > 20 * 1024 * 1024)
          throw new Error(uiText("附件上限為 20 MB。"));
        const res = await fetch(`/api/v2/bots/${selected}/attachments`, {
          method: "POST",
          headers: {
            "X-Apsis-Client": "1",
            "X-File-Name": encodeURIComponent(file.name),
            "Content-Type": "application/octet-stream",
          },
          body: file,
        });
        const artifact = await res.json();
        if (!res.ok) throw new Error(artifact.error);
        if (selectedRef.current === botId)
          setAttachments((old) => [...old, artifact]);
      }
      setActionFeedback({
        botId,
        label: "附件已加入，可以傳送訊息",
        pending: false,
      });
      await refresh();
    } catch (e) {
      setActionFeedback(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (upload.current) upload.current.value = "";
    }
  };
  const bots =
    state?.bots
      .filter(
        (b) =>
          b.hidden === hidden &&
          (b.name + b.lastMessage).toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt.localeCompare(a.updatedAt),
      ) || [];
  const bot = state?.bots.find((b) => b.id === selected);
  const running = !!detail?.session.running;
  const pending = detail?.approvals.filter((a) => a.status === "pending") || [];
  const summaries = new Map(detail?.runSummaries.map((r) => [r.id, r]));
  const activeSummary = detail?.runSummaries.find(
    (r) => r.id === detail.session.activeRunId && r.status === "running",
  );
  const latestSummary = detail?.runSummaries.at(-1);
  const queuedCount =
    detail?.jobs.filter((j) => j.status === "queued").length || 0;
  const stop = async () => {
    if (!selected || stoppingBot) return;
    setStoppingBot(selected);
    await perform(() => api(`/bots/${selected}/stop`, "POST", {}));
    setStoppingBot(undefined);
  };
  const availableBots = new Set(state?.bots.map((b) => b.id));
  const toggleRun = (id: string) =>
    setExpandedRuns((old) => ({ ...old, [id]: !old[id] }));
  const revealRun = (id: string) => {
    setExpandedRuns((old) => ({ ...old, [id]: true }));
    requestAnimationFrame(() => {
      const element = document.getElementById(`task-${id}`);
      element?.scrollIntoView({ block: "nearest" });
      element
        ?.querySelector<HTMLButtonElement>(".task-summary")
        ?.focus({ preventScroll: true });
    });
  };
  const trigger = text.slice(0, caret).match(/(?:^|\s)([/@])([^\s/@]*)$/);
  const skillChoices = (state?.skills ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    value: uiText("請依照技能「{0}」（ID：{1}）執行：", [s.name, s.id]),
  }));
  const connectorChoices = (state?.connectors ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    value: uiText("請使用連接器「{0}」（ID：{1}）：", [c.name, c.id]),
  }));
  const suggestions =
    trigger && !dismissedSuggestion
      ? (trigger[1] === "/" ? skillChoices : connectorChoices).filter((item) =>
          item.name.toLowerCase().includes(trigger[2].toLowerCase()),
        )
      : [];
  const insertChoice = (value: string, replaceTrigger = false) => {
    const selection = draftSelection.current;
    const start =
      replaceTrigger && trigger
        ? caret - trigger[2].length - 1
        : selection.start;
    const end = replaceTrigger ? caret : selection.end;
    const inserted = value + " ";
    setText(text.slice(0, start) + inserted + text.slice(end));
    setCaret(start + inserted.length);
    setDismissedSuggestion(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + inserted.length,
        start + inserted.length,
      );
    });
  };
  return (
    <div
      className={`app ${panel ? "details-open" : ""} ${mobileList ? "list-open" : ""} ${!listVisible ? "list-collapsed" : ""} ${focusMode ? "focus-mode" : ""}`}
    >
      <a className="skip-link" href="#conversation">
        {uiText("跳至對話")}
      </a>
      {(listDrawer || detailsDrawer) && (
        <button
          className="drawer-scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => {
            if (listDrawer) setMobileList(false);
            else setPanel(false);
          }}
        />
      )}
      <aside
        id="bot-roster"
        ref={sidebarRef}
        className="sidebar"
        role={listDrawer ? "dialog" : undefined}
        aria-modal={listDrawer || undefined}
        aria-label={uiText("Bot 導覽")}
        inert={detailsDrawer || !listVisible}
      >
        <div className="brand">
          <span className="brand-mark">
            <BrandMark size={30} />
          </span>
          <span className="brand-copy">
            <strong>Apsis</strong>
            <small>{uiText("對話")}</small>
          </span>
          <span className="brand-actions">
            <button
              className="new-bot"
              aria-label={uiText("新增 Bot")}
              title={uiText("新增 Bot")}
              onClick={newBot}
              disabled={creating}
            >
              <Icon name="plus" size={20} />
            </button>
            <button
              className="icon roster-close"
              aria-label={uiText("關閉名單")}
              title={uiText("收起 Bot 名單")}
              onClick={closeList}
            >
              <Icon name="close" />
            </button>
          </span>
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input
            aria-label={uiText("搜尋 Bot")}
            placeholder={uiText("搜尋對話或 Bot")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="roster-heading">
          <span>{hidden ? uiText("已隱藏") : uiText("最近對話")}</span>
          <button onClick={() => setHidden(!hidden)}>
            {hidden ? uiText("返回") : uiText("查看隱藏")}
          </button>
        </div>
        <nav className="roster" aria-label={uiText("Bot 名單")}>
          {bots.map((b) => {
            const preview =
              b.status === "waiting"
                ? uiText("等待你的核准")
                : b.status === "working"
                  ? uiText("正在處理任務…")
                  : b.status === "error"
                    ? `${uiText("任務失敗")} · ${chatPreview(b.lastMessage)}`
                    : chatPreview(b.lastMessage);
            return (
              <button
                key={b.id}
                aria-current={selected === b.id ? "page" : undefined}
                title={b.name}
                className={`bot-row ${selected === b.id ? "selected" : ""} ${b.unread ? "has-unread" : ""} status-${b.status}`}
                onClick={() => select(b.id)}
              >
                <span className={`avatar tone-${b.id.charCodeAt(0) % 4}`}>
                  <BrandMark size={24} avatar={b.avatar} />
                  <i className={b.status} />
                </span>
                <span className="bot-summary">
                  <span className="bot-line">
                    <span className="bot-name">
                      <strong>{b.name}</strong>
                      {b.pinned && (
                        <span className="pin" title={uiText("已釘選")}>
                          <Icon name="pin" size={13} />
                          <span className="visually-hidden">
                            {uiText("已釘選")}
                          </span>
                        </span>
                      )}
                    </span>
                    <time dateTime={b.updatedAt}>{time(b.updatedAt)}</time>
                  </span>
                  <span className="bot-preview-line">
                    <span className="preview" title={preview}>
                      {preview}
                    </span>
                    {b.unread && (
                      <span className="unread">{uiText("未讀")}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
          {!bots.length && (
            <p className="roster-empty">
              {query
                ? uiText("找不到符合的 Bot")
                : hidden
                  ? uiText("沒有隱藏的 Bot")
                  : uiText("為你的工作新增一位幫手。")}
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-actions">
            <button
              className="settings-link"
              onClick={() => {
                setMobileList(false);
                setSettings(true);
              }}
            >
              <span className="settings-symbol" aria-hidden="true">
                <Icon name="settings" size={20} />
              </span>
              <span>{uiText("設定與工具")}</span>
            </button>
            <button
              className="icon theme-toggle"
              aria-label={
                theme === "light"
                  ? uiText("切換為深色模式")
                  : uiText("切換為淺色模式")
              }
              title={
                theme === "light" ? uiText("深色模式") : uiText("淺色模式")
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
          </div>
        </div>
      </aside>
      <main
        id="conversation"
        tabIndex={-1}
        className="conversation"
        inert={listDrawer || detailsDrawer}
      >
        {!eventsConnected && (
          <div className="connection-banner" role="status">
            <ActivityMark state={connectionLost ? "disconnected" : "waiting"} />
            <span>
              {feedbackText(
                connectionLost
                  ? "即時連線中斷，正在重新連線。恢復後會自動同步。"
                  : "正在連接即時更新…",
              )}
            </span>
          </div>
        )}
        {!selected && (
          <div className="workspace-topbar">
            <button
              id="roster-toggle"
              className="icon"
              aria-label={
                listVisible ? uiText("收起 Bot 名單") : uiText("開啟 Bot 名單")
              }
              aria-expanded={listVisible}
              aria-controls="bot-roster"
              onClick={toggleList}
            >
              <Icon name="menu" />
            </button>
            {!listVisible && <strong>Apsis</strong>}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="icon"
              aria-label={uiText("關閉錯誤")}
              onClick={() => setError("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {!selected ? (
          <div className="welcome">
            <div className="welcome-symbol">
              <BrandMark size={56} />
            </div>
            <h1>{uiText("把事情交給你的 Bot。")}</h1>
            <p>
              {uiText("一段持續的對話。能動手工作的幫手。")}
              <br />
              {uiText("從研究、整理文件，到完成程式開發。")}
            </p>
            <button className="primary" onClick={newBot} disabled={creating}>
              <Icon name="plus" />
              {uiText("建立第一個 Bot")}
            </button>
            <div className="welcome-ideas">
              {[
                [
                  "search",
                  uiText("研究與整理"),
                  uiText("比較資料，整理有來源的結論"),
                ],
                [
                  "file",
                  uiText("文件與日常工作"),
                  uiText("讀取文件，製作可下載的成果"),
                ],
                [
                  "monitor",
                  uiText("開發與操作"),
                  uiText("使用瀏覽器、檔案和本機工具"),
                ],
              ].map(([icon, title, desc]) => (
                <div key={title}>
                  <Icon name={icon} />
                  <strong>{title}</strong>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => setSettings(true)}>
              {uiText("連接你的 LLM API")}
              <span>↗</span>
            </button>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button
                className="secondary"
                title={uiText("執行中、排隊或等待核准時無法切換任務")}
                disabled={
                  busy ||
                  !!detail?.session.live ||
                  detail?.jobs.some((j) =>
                    ["queued", "running"].includes(j.status),
                  ) ||
                  detail?.approvals.some((a) => a.status === "pending")
                }
                onClick={() =>
                  void perform(async () => {
                    await api(`/bots/${selected}/contexts`, "POST", {});
                    setReplyTo(undefined);
                    setRetryOf(undefined);
                    await refresh();
                  })
                }
              >
                {uiText("新任務")}
              </button>
              <button
                id="roster-toggle"
                className="icon"
                aria-label={
                  listVisible
                    ? uiText("收起 Bot 名單")
                    : uiText("開啟 Bot 名單")
                }
                title={
                  listVisible
                    ? uiText("收起 Bot 名單")
                    : uiText("開啟 Bot 名單")
                }
                aria-expanded={listVisible}
                aria-controls="bot-roster"
                onClick={toggleList}
              >
                <Icon name="menu" />
              </button>
              <button
                className="header-profile"
                title={uiText("自訂 Bot：名稱、圖示、角色與模型")}
                onClick={() => {
                  setPanel(true);
                  setProfile(true);
                }}
              >
                <span className="avatar small">
                  <BrandMark size={23} avatar={bot?.avatar} />
                </span>
                <span>
                  <strong>{bot?.name || uiText("載入中")}</strong>
                  <small>
                    {!detail
                      ? uiText("載入對話…")
                      : activeSummary?.progress
                        ? taskProgress(locale, activeSummary.progress.label)
                        : bot?.status === "waiting"
                          ? uiText("等待核准")
                          : running
                            ? uiText("正在工作")
                            : uiText("隨時可以交辦任務")}
                  </small>
                </span>
              </button>
              <div className="header-actions">
                <span className="model-label">
                  {bot?.model ||
                    state?.defaultModel?.model ||
                    uiText("尚未連接模型")}
                </span>
                <button
                  className={`icon focus-toggle ${focusMode ? "active" : ""}`}
                  aria-label={
                    focusMode ? uiText("離開專注模式") : uiText("進入專注模式")
                  }
                  title={
                    focusMode ? uiText("離開專注模式") : uiText("專注模式")
                  }
                  aria-pressed={focusMode}
                  onClick={toggleFocus}
                >
                  <Icon name="focus" />
                </button>
                <button
                  className={`icon ${panel ? "active" : ""}`}
                  aria-label={uiText("切換詳情面板")}
                  title={uiText("Bot 詳情")}
                  aria-expanded={panel}
                  aria-controls="bot-details"
                  onClick={() => setPanel(!panel)}
                >
                  <Icon name="panel" />
                </button>
              </div>
            </header>
            {bot?.needsModelSelection && (
              <div className="notice model-replacement-notice" role="alert">
                <span>{t("replacement")}</span>
                <button
                  className="secondary"
                  onClick={() => {
                    setPanel(true);
                    setProfile(true);
                  }}
                >
                  {t("selectModel")}
                </button>
              </div>
            )}
            <div
              className="messages"
              ref={scroller}
              onScroll={() => {
                const el = scroller.current!;
                pinnedBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                setAwayFromBottom(!pinnedBottom.current);
              }}
            >
              {!detail ? (
                <ConversationLoading />
              ) : (
                <div className="message-column">
                  {detail.session.olderCursor && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const id = selected;
                          const el = scroller.current;
                          const height = el?.scrollHeight || 0;
                          const top = el?.scrollTop || 0;
                          pinnedBottom.current = false;
                          const page = await api<{
                            messages: Detail["session"]["messages"];
                            olderCursor?: number;
                          }>(
                            `/bots/${id}/history?before=${detail.session.olderCursor}`,
                          );
                          if (selectedRef.current !== id) return;
                          setDetail(
                            (old) =>
                              old && {
                                ...old,
                                session: {
                                  ...old.session,
                                  olderCursor: page.olderCursor,
                                  messages: [
                                    ...page.messages.filter(
                                      (m) =>
                                        !old.session.messages.some(
                                          (n) => n.id === m.id,
                                        ),
                                    ),
                                    ...old.session.messages,
                                  ],
                                },
                              },
                          );
                          requestAnimationFrame(() => {
                            if (el)
                              el.scrollTop = top + el.scrollHeight - height;
                          });
                        })
                      }
                    >
                      {uiText("更早的訊息")}
                    </button>
                  )}
                  {!detail.session.messages.length && (
                    <div className="bot-intro">
                      <span className="avatar large">
                        <BrandMark size={32} avatar={bot?.avatar} />
                      </span>
                      <h2>{uiText("你好，我是 {0}。", [bot?.name])}</h2>
                      <p>{uiText("告訴我你想完成什麼，我會在這裡接著做。")}</p>
                      <div className="starter-prompts">
                        {[
                          uiText("幫我研究一個主題，整理來源與結論"),
                          uiText("讀取我的文件，整理成一份報告"),
                          uiText("協助我完成一個程式開發任務"),
                        ].map((p) => (
                          <button
                            key={p}
                            onClick={() => {
                              setText(p);
                              input.current?.focus();
                            }}
                          >
                            {p}
                            <Icon name="arrow" size={15} />
                          </button>
                        ))}
                      </div>
                      {!state?.defaultModel && (
                        <button
                          className="setup-hint"
                          onClick={() => setSettings(true)}
                        >
                          {uiText("先連接一個模型，即可開始對話")}
                          <span>→</span>
                        </button>
                      )}
                    </div>
                  )}
                  {detail.session.messages.map((m, index) => (
                    <article
                      id={`message-${m.id}`}
                      key={m.id}
                      className={`message ${m.role} ${m.status === "error" ? "failed" : ""}`}
                    >
                      <div className="message-body">
                        {m.workContextId &&
                          m.workContextId !==
                            detail.session.messages[index - 1]
                              ?.workContextId && (
                            <div className="task-context-divider">
                              {uiText("任務")} ·{" "}
                              {uiText(
                                detail.jobs.find(
                                  (j) => j.workContextId === m.workContextId,
                                )?.contextKind === "routine"
                                  ? "排程"
                                  : detail.jobs.find(
                                        (j) =>
                                          j.workContextId === m.workContextId,
                                      )?.contextKind === "delegation"
                                    ? "派工"
                                    : "互動聊天",
                              )}
                            </div>
                          )}
                        {m.role === "user" &&
                          detail.jobs.find((j) => j.runId === m.runId)
                            ?.replyTo && (
                            <a
                              className="quoted-message"
                              href={`#message-${detail.jobs.find((j) => j.runId === m.runId)?.replyTo}`}
                              onClick={(e) => {
                                e.preventDefault();
                                document
                                  .getElementById(
                                    `message-${detail.jobs.find((j) => j.runId === m.runId)?.replyTo}`,
                                  )
                                  ?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center",
                                  });
                              }}
                            >
                              {uiText("回覆：")}
                              {(
                                detail.quotes[
                                  detail.jobs.find((j) => j.runId === m.runId)
                                    ?.replyTo || ""
                                ] ||
                                detail.session.messages.find(
                                  (original) =>
                                    original.id ===
                                    detail.jobs.find((j) => j.runId === m.runId)
                                      ?.replyTo,
                                )?.content
                              )?.slice(0, 100)}
                            </a>
                          )}
                        {m.status === "error" &&
                        m.content.trim() === "Connection error." ? (
                          <div className="message-error">
                            <strong>{uiText("無法連線至模型供應商")}</strong>
                            <p>
                              {uiText(
                                "請檢查網路及模型連線設定，再重新送出訊息。",
                              )}
                            </p>
                            <details>
                              <summary>{uiText("錯誤詳情")}</summary>
                              <code>{m.content}</code>
                            </details>
                          </div>
                        ) : (
                          <Markdown text={m.content} />
                        )}
                      </div>
                      <div className="message-footer">
                        {m.role === "assistant" &&
                          m.runId &&
                          summaries.has(m.runId) && (
                            <RunHistory
                              botId={detail.bot.id}
                              summary={summaries.get(m.runId)!}
                              open={!!expandedRuns[m.runId]}
                              toggle={() => toggleRun(m.runId!)}
                              select={select}
                              available={availableBots}
                            />
                          )}
                        <div className="message-actions">
                          {m.status === "error" &&
                            !(m.runId && summaries.has(m.runId)) && (
                              <span>{uiText("執行失敗")}</span>
                            )}
                          <button
                            onClick={() => {
                              setReplyTo(m.id);
                              input.current?.focus();
                            }}
                          >
                            {uiText("回覆")}
                          </button>
                          <CopyButton text={m.content} />
                        </div>
                      </div>
                    </article>
                  ))}
                  {!!detail.session.messages.length &&
                    detail.session.context &&
                    !detail.session.messages.some(
                      (m) => m.workContextId === detail.session.context!.id,
                    ) && (
                      <p role="status" className="task-context-divider">
                        {uiText("新任務已開始，輸入新的工作內容。")}
                      </p>
                    )}
                  {running && (
                    <article className="message assistant live">
                      {detail.session.live?.text && (
                        <Markdown text={detail.session.live.text} />
                      )}
                      {activeSummary && (
                        <RunHistory
                          key={activeSummary.id}
                          botId={detail.bot.id}
                          summary={activeSummary}
                          open={!!expandedRuns[activeSummary.id]}
                          toggle={() => toggleRun(activeSummary.id)}
                          select={select}
                          available={availableBots}
                        />
                      )}
                    </article>
                  )}
                  {pending.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      approval={a}
                      decide={(approved, remember) =>
                        perform(() =>
                          api(`/approvals/${a.id}`, "POST", {
                            approved,
                            remember,
                          }),
                        )
                      }
                    />
                  ))}
                  <LegacyDelegations
                    key={selected}
                    jobs={detail.legacyDelegations}
                    select={select}
                    available={availableBots}
                  />
                  {detail.runSummaries
                    .filter(
                      (r) =>
                        r.status !== "running" &&
                        !detail.session.messages.some(
                          (m) => m.role === "assistant" && m.runId === r.id,
                        ),
                    )
                    .map((r) => (
                      <RunHistory
                        key={r.id}
                        botId={detail.bot.id}
                        summary={r}
                        open={!!expandedRuns[r.id]}
                        toggle={() => toggleRun(r.id)}
                        select={select}
                        available={availableBots}
                      />
                    ))}
                  {detail.drafts.map((d) => (
                    <DraftCard
                      key={d.id}
                      draft={d}
                      save={(body) =>
                        perform(() => api(`/drafts/${d.id}`, "POST", body))
                      }
                    />
                  ))}
                  {detail.jobs
                    .filter((j) => j.status === "queued")
                    .map((j) => (
                      <div className="queued" key={j.id}>
                        <Icon name="clock" size={16} />
                        <span>
                          {uiText("下一個任務：")}
                          {j.prompt}
                        </span>
                      </div>
                    ))}
                  {detail.artifacts
                    .filter((a) => a.kind === "result")
                    .map((a) => (
                      <ArtifactCard key={a.id} artifact={a} />
                    ))}
                  {detail.jobs
                    .filter(
                      (j) =>
                        !j.dismissedAt &&
                        ((j.status === "failed" && !j.runId) ||
                          j.status === "interrupted"),
                    )
                    .map((j) => (
                      <div className="job-error" key={j.id}>
                        <span className="job-error-message">{j.error}</span>
                        <div className="job-error-actions">
                          <button
                            onClick={() => {
                              setRetryOf(j.id);
                              setText(j.prompt);
                              input.current?.focus();
                            }}
                          >
                            {uiText("重新交辦")}
                          </button>
                          <button
                            aria-label={uiText("關閉這則任務提示")}
                            onClick={() =>
                              perform(() =>
                                api(
                                  `/bots/${selected}/jobs/${j.id}/dismiss`,
                                  "POST",
                                  {},
                                ),
                              )
                            }
                          >
                            {uiText("關閉")}
                          </button>
                        </div>
                      </div>
                    ))}
                  <div ref={bottom} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {awayFromBottom && (
                <button
                  className="jump-latest"
                  onClick={() => {
                    pinnedBottom.current = true;
                    setAwayFromBottom(false);
                    bottom.current?.scrollIntoView({ behavior: "instant" });
                  }}
                >
                  {feedbackText("回到最新訊息")} ↓
                </button>
              )}
              <div className="composer-card">
                <div className="composer-status">
                  <div className="composer-status-content">
                    {actionFeedback?.botId === selected && (
                      <ActionFeedback
                        label={actionFeedback.label}
                        pending={actionFeedback.pending}
                      />
                    )}
                    {stoppingBot === selected && (
                      <ActionFeedback
                        label="正在停止任務，等待執行中的操作結束…"
                        pending
                      />
                    )}
                    {activeSummary && (
                      <ProgressStrip
                        summary={activeSummary}
                        connected={eventsConnected}
                        open={!!expandedRuns[activeSummary.id]}
                        toggle={() =>
                          expandedRuns[activeSummary.id]
                            ? toggleRun(activeSummary.id)
                            : revealRun(activeSummary.id)
                        }
                        approve={(id) => {
                          if (id !== selected) select(id);
                          else {
                            const card =
                              document.querySelector<HTMLElement>(
                                ".approval-card",
                              );
                            card?.scrollIntoView({ block: "center" });
                            card
                              ?.querySelector<HTMLButtonElement>("button")
                              ?.focus({ preventScroll: true });
                          }
                        }}
                      />
                    )}
                    {!running &&
                      !activeSummary &&
                      latestSummary &&
                      latestSummary.status !== "running" && (
                        <RunOutcome
                          summary={latestSummary}
                          reveal={() => revealRun(latestSummary.id)}
                        />
                      )}
                    {running && !activeSummary && (
                      <ActionFeedback
                        label="正在準備任務，等待模型回應…"
                        pending
                      />
                    )}
                    {queuedCount > 0 && (
                      <div className="queue-feedback" role="status">
                        <ActivityMark state="queued" />
                        <span>
                          {locale === "en"
                            ? `${queuedCount} task${queuedCount === 1 ? "" : "s"} queued · starts automatically when available`
                            : `${queuedCount} 個任務排隊中 · 可執行時會自動開始`}
                        </span>
                      </div>
                    )}
                  </div>
                  {running && (
                    <button
                      className="icon composer-stop"
                      aria-label={uiText("停止任務")}
                      title={uiText("停止任務")}
                      disabled={stoppingBot === selected}
                      onClick={() => void stop()}
                    >
                      <Icon name="stop" />
                    </button>
                  )}
                </div>
                <div className="composer">
                  {retryOf && (
                    <div className="reply-chip">
                      {uiText("重新交辦原任務")}
                      <button
                        className="icon"
                        aria-label={uiText("取消重新交辦")}
                        onClick={() => setRetryOf(undefined)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                  {replyTo && (
                    <div className="reply-chip">
                      {uiText("回覆：")}
                      {(
                        detail?.session.messages.find((m) => m.id === replyTo)
                          ?.content ||
                        (quotedPreview?.id === replyTo
                          ? quotedPreview.content
                          : "")
                      )?.slice(0, 90)}
                      <button
                        className="icon"
                        aria-label={uiText("取消回覆")}
                        onClick={() => setReplyTo(undefined)}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                  {!!attachments.length && (
                    <div className="attachment-chips">
                      {attachments.map((a) => (
                        <span key={a.id}>
                          <Icon name="file" size={14} />
                          {a.name}
                          <button
                            aria-label={uiText("移除 {0}", [a.name])}
                            onClick={() =>
                              setAttachments((old) =>
                                old.filter((x) => x.id !== a.id),
                              )
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {!!suggestions?.length && (
                    <div
                      className="suggestions"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setDismissedSuggestion(true);
                          input.current?.focus();
                        }
                      }}
                    >
                      {suggestions.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => insertChoice(s.value, true)}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={input}
                    disabled={busy}
                    aria-label={uiText("傳送訊息")}
                    placeholder={
                      busy
                        ? uiText("傳送中…")
                        : uiText("傳訊息給 {0}…", [bot?.name || "Bot"])
                    }
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setCaret(e.target.selectionStart);
                      draftSelection.current = {
                        start: e.target.selectionStart,
                        end: e.target.selectionEnd,
                      };
                      setDismissedSuggestion(false);
                    }}
                    onSelect={(e) => {
                      const element = e.currentTarget;
                      draftSelection.current = {
                        start: element.selectionStart,
                        end: element.selectionEnd,
                      };
                      setCaret(element.selectionStart);
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "ArrowDown" &&
                        suggestions.length &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        document
                          .querySelector<HTMLButtonElement>(
                            ".suggestions button",
                          )
                          ?.focus();
                        return;
                      }
                      if (e.key === "Escape" && suggestions.length) {
                        e.preventDefault();
                        setDismissedSuggestion(true);
                        return;
                      }
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send(running && sendMode === "steer");
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <div className="composer-tools">
                      <ComposerPopover
                        label={
                          <>
                            <Icon name="plus" size={18} />
                            <span>{uiText("工具")}</span>
                          </>
                        }
                      >
                        <button
                          disabled={busy || !detail}
                          onClick={(e) => {
                            e.currentTarget.closest("details")!.open = false;
                            upload.current?.click();
                          }}
                        >
                          <Icon name="attach" size={18} />
                          {uiText("新增附件")}
                        </button>
                        {[
                          { label: "技能 /", items: skillChoices },
                          { label: "連接器 @", items: connectorChoices },
                        ].map((group) => (
                          <section
                            key={group.label}
                            aria-label={uiText(group.label)}
                          >
                            <h3>{uiText(group.label)}</h3>
                            {group.items.length ? (
                              group.items.map((item) => (
                                <button
                                  key={item.id}
                                  disabled={busy || !detail}
                                  onClick={(e) => {
                                    e.currentTarget.closest("details")!.open =
                                      false;
                                    insertChoice(item.value);
                                  }}
                                >
                                  {item.name}
                                </button>
                              ))
                            ) : (
                              <p>{uiText("尚未設定")}</p>
                            )}
                          </section>
                        ))}
                      </ComposerPopover>
                      <ApprovalModeControl
                        settings={approvalSettings}
                        api={api}
                        onSaved={acceptApprovalSettings}
                        onReload={refresh}
                      />
                    </div>
                    <div className="composer-send-actions">
                      {running && (
                        <select
                          aria-label={uiText("傳送方式")}
                          value={sendMode}
                          onChange={(e) => setSendMode(e.target.value)}
                        >
                          <option value="queue">{uiText("排入下一個")}</option>
                          <option value="steer" disabled={!!retryOf}>
                            {uiText("補充指示")}
                          </option>
                        </select>
                      )}
                      <button
                        className={`send ${running ? "queue-send" : ""}`}
                        aria-label={
                          running
                            ? uiText(
                                sendMode === "steer"
                                  ? "補充指示"
                                  : "排入下一個任務",
                              )
                            : uiText("傳送")
                        }
                        title={
                          running
                            ? uiText(
                                sendMode === "steer"
                                  ? "補充指示"
                                  : "排入下一個任務",
                              )
                            : uiText("傳送")
                        }
                        disabled={
                          busy ||
                          !detail ||
                          !!detail.contextSetupError ||
                          (running &&
                            sendMode === "steer" &&
                            (!text.trim() || !!retryOf)) ||
                          (!text.trim() && !attachments.length)
                        }
                        onClick={() =>
                          void send(running && sendMode === "steer")
                        }
                      >
                        {busy ? (
                          <ActivityMark />
                        ) : (
                          <Icon name="send" size={18} />
                        )}
                      </button>
                    </div>
                  </div>
                  <input
                    ref={upload}
                    type="file"
                    className="visually-hidden"
                    multiple
                    accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => void uploadFiles(e.target.files)}
                  />
                </div>
                {detail?.contextSetupError && (
                  <p role="status" className="composer-note">
                    {uiError(detail.contextSetupError)}{" "}
                    <button onClick={() => setSettings(true)}>
                      {uiText("需設定")}
                    </button>
                  </p>
                )}
              </div>
              <p className="composer-note">
                {running
                  ? uiText("可以補充指示，或將新訊息排入下一個任務。")
                  : uiText("Enter 傳送 · Shift + Enter 換行")}
              </p>
            </div>
          </>
        )}
      </main>
      {selected && panel && detail && (
        <aside
          id="bot-details"
          ref={detailsRef}
          className="details"
          role={detailsDrawer ? "dialog" : undefined}
          aria-modal={detailsDrawer || undefined}
          aria-label={uiText("Bot 詳情")}
          inert={listDrawer}
        >
          <div className="details-header">
            <button
              className="icon"
              aria-label={profile ? uiText("返回詳情") : uiText("關閉詳情")}
              onClick={() => (profile ? setProfile(false) : setPanel(false))}
            >
              <Icon name={profile ? "back" : "close"} size={18} />
            </button>
            <strong>{profile ? uiText("Bot 個人檔案") : uiText("詳情")}</strong>
            <span />
          </div>
          {profile ? (
            <Profile
              key={selected}
              detail={detail}
              state={state!}
              save={async (body) => {
                await api(`/bots/${selected}`, "PATCH", body);
                await refresh();
              }}
              remove={async () => {
                await api(`/bots/${selected}`, "DELETE");
                selectedRef.current = null;
                setSelected(null);
                setDetail(undefined);
                setPanel(false);
                setProfile(false);
                setError("");
                localStorage.removeItem("apsis.bot");
                await refresh();
              }}
            />
          ) : (
            <div className="details-body" key={selected}>
              <button
                className="detail-profile"
                onClick={() => setProfile(true)}
              >
                <span className="avatar">
                  <BrandMark size={26} avatar={bot?.avatar} />
                </span>
                <span className="detail-profile-copy">
                  <strong>{bot?.name}</strong>
                  <small>{uiText("自訂 Bot")}</small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
              <DetailSection
                title={uiText("檔案與成果")}
                icon={<Icon name="file" size={16} />}
                status={detail.artifacts.length}
                defaultOpen
              >
                {detail.artifacts.length ? (
                  detail.artifacts
                    .slice()
                    .reverse()
                    .map((a) => (
                      <ArtifactCard key={a.id} artifact={a} compact />
                    ))
                ) : (
                  <p className="muted">{uiText("附件與成果會顯示在這裡。")}</p>
                )}
              </DetailSection>
              <DetailSection
                title={uiText("電腦")}
                icon={<Icon name="monitor" size={16} />}
                status={
                  detail.computerOwner
                    ? uiText("使用者控制中")
                    : detail.browserUrl
                      ? uiText("已連線")
                      : uiText("待命")
                }
                defaultOpen={!!detail.browserUrl || !!detail.computerOwner}
              >
                {detail.browserUrl ? (
                  <button
                    className="computer-preview"
                    onClick={() => setExpanded(true)}
                  >
                    <img
                      src={`/api/v2/bots/${selected}/screenshot?v=${detail.session.live?.activity.length || 0}`}
                      alt={uiText("Bot 瀏覽器畫面")}
                    />
                    <span className="preview-bottom">
                      {new URL(detail.browserUrl).hostname}
                      <span>↗</span>
                    </span>
                  </button>
                ) : (
                  <div className="detail-empty">
                    <p className="muted">
                      {uiText("開始瀏覽網頁後會顯示工作畫面。")}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setExpanded(true)}
                    >
                      {uiText("開啟電腦")}
                    </button>
                  </div>
                )}
              </DetailSection>
              <DetailSection
                title={uiText("排程")}
                icon={<Icon name="clock" size={16} />}
                status={detail.routines.length}
              >
                {detail.routines.map((r) => (
                  <button
                    className="routine-row"
                    key={r.id}
                    onClick={() => setRoutine(r)}
                  >
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.enabled
                          ? uiText("下次 {0}", [
                              new Date(r.nextAt).toLocaleString(
                                getSettingsLocale(),
                              ),
                            ])
                          : r.blockedReason
                            ? uiError(r.blockedReason)
                            : uiText("已暫停")}
                      </small>
                    </span>
                    <Icon name="arrow" size={14} />
                  </button>
                ))}
                {!detail.routines.length && (
                  <p className="muted">{uiText("在指定時間交辦工作。")}</p>
                )}
                <button
                  className="text-button detail-add"
                  onClick={() => setRoutine("new")}
                >
                  <Icon name="plus" size={16} />
                  {uiText("新增排程")}
                </button>
              </DetailSection>
              <DetailSection
                title={uiText("記憶")}
                icon={<Icon name="spark" size={16} />}
                status={detail.memories.length}
              >
                <ContextPanel
                  key={detail.bot.id}
                  botId={detail.bot.id}
                  memories={detail.memories}
                  updateKey={
                    detail.session.context?.usage?.updatedAt ||
                    detail.session.context?.id
                  }
                  api={(path, body) =>
                    api(path, body === undefined ? "GET" : "POST", body)
                  }
                  refresh={refresh}
                  quote={(id, content) => {
                    setReplyTo(id);
                    setQuotedPreview({ id, content });
                    input.current?.focus();
                  }}
                />
              </DetailSection>
              <DetailSection
                title={uiText("最近操作")}
                icon={<Icon name="clock" size={16} />}
                status={detail.runSummaries.at(-1)?.operationCount || 0}
              >
                {detail.runSummaries.length ? (
                  <button
                    className="task-summary"
                    onClick={() => {
                      if (detailsDrawer) setPanel(false);
                      revealRun(detail.runSummaries.at(-1)!.id);
                    }}
                  >
                    <span>
                      <RunStats summary={detail.runSummaries.at(-1)!} />
                      {uiText("· 查看紀錄")}
                    </span>
                    <Icon name="arrow" size={14} />
                  </button>
                ) : (
                  <p className="muted">
                    {uiText("執行任務後可查看操作紀錄。")}
                  </p>
                )}
              </DetailSection>
            </div>
          )}
        </aside>
      )}
      {creating && state && (
        <Modal label={uiText("建立 Bot")} close={() => setCreating(false)}>
          <section className="modal bot-create-modal">
            <header>
              <h2>{uiText("建立 Bot")}</h2>
              <button
                className="icon"
                aria-label={uiText("關閉建立 Bot")}
                onClick={() => setCreating(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <Profile
              state={state}
              save={async (body) => {
                const bot = await api<{ id: string }>("/bots", "POST", body);
                setCreating(false);
                select(bot.id);
                await refresh();
              }}
            />
          </section>
        </Modal>
      )}
      {settings && state && (
        <Settings
          state={state}
          close={() => setSettings(false)}
          refresh={refresh}
          report={setError}
        />
      )}
      {routine && selected && (
        <RoutineEditor
          routine={routine}
          botId={selected}
          close={() => setRoutine(undefined)}
          save={(fn) => perform(fn)}
        />
      )}
      {expanded && selected && (
        <Modal label={uiText("Bot 的電腦")} close={() => setExpanded(false)}>
          <section
            className="modal computer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h2>{uiText("Bot 的電腦")}</h2>
                <p>{uiText("所有 Bots 共用登入狀態，各自使用分頁。")}</p>
              </div>
              <button
                className="icon"
                aria-label={uiText("關閉電腦")}
                onClick={() => setExpanded(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            {detail?.browserUrl ? (
              <img
                src={`/api/v2/bots/${selected}/screenshot?v=${Date.now()}`}
                alt={uiText("完整瀏覽器畫面")}
              />
            ) : (
              <div className="empty-section">
                {uiText("尚未開啟網頁。可在對話中請 Bot 瀏覽網站。")}
              </div>
            )}
            <footer>
              <span>{uiText("接管會在本機開啟專用瀏覽器視窗。")}</span>
              <button
                className="primary"
                onClick={() =>
                  perform(() =>
                    api(`/bots/${selected}/takeover`, "POST", {
                      take: !detail?.computerOwner,
                    }),
                  )
                }
              >
                {detail?.computerOwner
                  ? uiText("交還控制權")
                  : uiText("接管瀏覽器")}
              </button>
            </footer>
          </section>
        </Modal>
      )}
    </div>
  );
}

function ArtifactCard({
  artifact: a,
  compact = false,
}: {
  artifact: Artifact;
  compact?: boolean;
}) {
  return (
    <a
      className={`artifact-card ${compact ? "compact" : ""}`}
      href={`/api/v2/artifacts/${a.id}`}
      download={a.name}
    >
      <span className="file-icon">
        <Icon name="file" size={compact ? 18 : 24} />
      </span>
      <span>
        <strong>{a.name}</strong>
        <small>
          {a.kind === "attachment" ? uiText("附件") : uiText("成果")} ·{" "}
          {a.path.split(".").at(-1)?.toUpperCase()}
        </small>
      </span>
      <span className="download-arrow">↓</span>
    </a>
  );
}
function DraftCard({
  draft,
  save,
}: {
  draft: Draft;
  save: (body: unknown) => Promise<void>;
}) {
  const [args, setArgs] = useState(draft.arguments);
  const [busy, setBusy] = useState(false);
  const send = async (action: string) => {
    setBusy(true);
    try {
      await save({ action, arguments: args });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="draft-card">
      <div className="section-title">
        <h3>
          <Icon name="file" size={17} />
          {draft.title}
        </h3>
        <span>
          {
            {
              draft: uiText("草稿"),
              sending: uiText("傳送中"),
              sent: uiText("已傳送"),
              discarded: uiText("已捨棄"),
              unknown: uiText("結果待確認"),
            }[draft.status]
          }
        </span>
      </div>
      <p className="muted">
        {draft.tool} · {draft.connectorId}
      </p>
      {draft.status === "draft" ? (
        <>
          <label>
            {uiText("編輯操作內容")}
            <textarea
              rows={7}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <div className="approval-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void send("discard")}
            >
              {uiText("捨棄")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void send("send")}
            >
              {uiText("確認並傳送")}
            </button>
          </div>
        </>
      ) : (
        <>
          <pre>{draft.arguments}</pre>
          {draft.result && (
            <details>
              <summary>{uiText("操作結果")}</summary>
              <pre>{draft.result}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
function ApprovalCard({
  approval: a,
  decide,
}: {
  approval: Detail["approvals"][number];
  decide: (approve: boolean, remember: boolean) => Promise<void>;
}) {
  const locale = useSettingsLocale();
  const [remember, setRemember] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const act = async (approved: boolean) => {
    setDeciding(true);
    try {
      await decide(approved, approved && remember);
    } finally {
      setDeciding(false);
    }
  };
  return (
    <div className="approval-card">
      <div className="approval-heading">
        <span>!</span>
        <div>
          <strong>{uiText("需要你的核准")}</strong>
          <small>
            {uiText("Bot 希望執行")} {a.tool}
          </small>
        </div>
      </div>
      <pre>{JSON.stringify(a.args, null, 2)}</pre>
      <p className="field-help">
        {approvalReason(a.reason, locale, a.dangerousCommand)}
      </p>
      {a.rememberAllowed !== false && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {uiText("本次任務允許相同操作（包含由此任務派工）")}
        </label>
      )}
      <div className="approval-actions">
        <button
          className="secondary"
          disabled={deciding}
          onClick={() => void act(false)}
        >
          {uiText("拒絕")}
        </button>
        <button
          className="primary"
          disabled={deciding}
          onClick={() => void act(true)}
        >
          {deciding ? uiText("處理中…") : uiText("核准並繼續")}
        </button>
      </div>
    </div>
  );
}
function Profile({
  detail,
  state,
  save,
  remove,
}: {
  detail?: Detail;
  state: Snapshot;
  save: (body: unknown) => Promise<void>;
  remove?: () => Promise<void>;
}) {
  useSettingsLocale();
  const needsReplacement =
    !!detail?.bot.needsModelSelection ||
    state.connections.some(
      (c) => c.id === detail?.bot.connectionId && c.provider === "codex",
    );
  const [name, setName] = useState(detail?.bot.name || "");
  const [description, setDescription] = useState(detail?.bot.description || "");
  const [model, setModel] = useState(
    needsReplacement
      ? "__replacement__"
      : detail?.bot.connectionId
        ? `${detail.bot.connectionId}::${detail.bot.model}`
        : "",
  );
  const [avatar, setAvatar] = useState(
    detail?.bot.avatar && detail.bot.avatar !== "✳"
      ? detail.bot.avatar
      : "orbit",
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [access, setAccess] = useState({
    skillIds: detail?.bot.skillIds ?? state.skills.map((skill) => skill.id),
    connectorIds:
      detail?.bot.connectorIds ??
      state.connectors
        .filter((connector) => connector.enabled)
        .map((connector) => connector.id),
    permissionMode:
      detail?.bot.permissionMode ?? ("workspace" as "workspace" | "readonly"),
  });
  const [permissionRules, setPermissionRules] = useState<PermissionRule[]>(
    detail?.bot.permissionRules ?? [],
  );
  const commit = async (body: unknown) => {
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      await save(body);
      setNotice(t("saved"));
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (model === "__replacement__") return;
        const [connectionId, modelName] = model.split("::");
        void commit({
          name,
          description,
          avatar,
          connectionId: connectionId || "",
          model: modelName,
          ...access,
          permissionRules,
        });
      }}
    >
      <span className="avatar hero">
        <BrandMark size={38} avatar={avatar} />
      </span>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <label>
        {t("name")}
        <input
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t("description")}
        <textarea
          rows={7}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={uiText(
            "例如：你是我的秘書，依其他 Bot 的角色派工，收到結果後整理回覆給我。",
          )}
        />
      </label>
      <label>
        {t("model")}
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {needsReplacement && (
            <option value="__replacement__" disabled>
              {t("selectModel")}
            </option>
          )}
          <option value="">{t("defaultModel")}</option>
          {state.connections
            .filter((c) => c.provider !== "codex")
            .flatMap((c) =>
              (c.models || [c.model]).map((m) => (
                <option key={`${c.id}::${m}`} value={`${c.id}::${m}`}>
                  {c.name} / {c.modelSettings?.[m]?.displayName || m}
                </option>
              )),
            )}
        </select>
      </label>
      {needsReplacement && (
        <p className="notice" role="alert">
          {t("replacement")}
        </p>
      )}
      <BotAccessFields
        skills={state.skills}
        connectors={state.connectors}
        {...access}
        disabled={saving}
        onChange={(patch) => setAccess((old) => ({ ...old, ...patch }))}
      />
      <PermissionEditor
        value={permissionRules}
        onChange={setPermissionRules}
        botId={detail?.bot.id}
        disabled={saving}
      />
      <button
        className="primary"
        type="submit"
        disabled={saving || !name.trim() || model === "__replacement__"}
      >
        {saving ? t("saving") : detail ? t("save") : t("createBot")}
      </button>
      {detail && (
        <button
          type="button"
          className="secondary"
          disabled={saving || !name.trim() || model === "__replacement__"}
          onClick={async () => {
            setSaving(true);
            setNotice("");
            try {
              const [connectionId, modelName] = model.split("::");
              await api("/templates", "POST", {
                name,
                description,
                avatar,
                ...(connectionId ? { connectionId, model: modelName } : {}),
                ...access,
                permissionRules,
              });
              setNotice(t("templateSaved"));
            } catch (error) {
              setNotice((error as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {t("saveTemplate")}
        </button>
      )}
      {detail && (
        <div className="profile-options">
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ pinned: !detail.bot.pinned })}
          >
            {detail.bot.pinned ? uiText("取消釘選") : uiText("釘選 Bot")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ hidden: !detail.bot.hidden })}
          >
            {detail.bot.hidden ? uiText("顯示 Bot") : uiText("隱藏 Bot")}
          </button>
          <small>{uiText("隱藏不會暫停排程。")}</small>
          {remove && (
            <button
              type="button"
              className="delete-bot"
              disabled={saving}
              onClick={() => {
                setDeleteError("");
                setConfirmDelete(true);
              }}
            >
              {uiText("刪除 Bot")}
            </button>
          )}
        </div>
      )}
      {confirmDelete && detail && remove && (
        <Modal
          label={uiText("刪除 Bot")}
          close={() => {
            if (!deleting) setConfirmDelete(false);
          }}
        >
          <section className="modal bot-delete-modal">
            <header>
              <h2>{uiText("刪除「{0}」？", [detail.bot.name])}</h2>
            </header>
            <div className="delete-body">
              <p>
                {uiText(
                  "此操作無法復原。將停止這位 Bot 的任務，刪除對話、專屬記憶與技能、排程、草稿、核准規則，以及附件與成果清單。",
                )}
              </p>
              <p>
                {uiText(
                  "工作區實體檔案與執行日誌會保留；已完成的外部操作不會撤銷。",
                )}
              </p>
              {deleteError && (
                <p role="alert" className="notice">
                  {deleteError}
                </p>
              )}
              <footer>
                <button
                  type="button"
                  className="secondary"
                  autoFocus
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  {uiText("取消")}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={deleting}
                  onClick={async () => {
                    if (deleting) return;
                    setDeleting(true);
                    setDeleteError("");
                    try {
                      await remove();
                    } catch (error) {
                      setDeleteError((error as Error).message);
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? uiText("停止任務並刪除中…") : uiText("確認刪除")}
                </button>
              </footer>
            </div>
          </section>
        </Modal>
      )}
    </form>
  );
}
function RoutineEditor({
  routine: r,
  botId,
  close,
  save,
}: {
  routine: Routine | "new";
  botId: string;
  close: () => void;
  save: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const old = r === "new" ? undefined : r;
  const [name, setName] = useState(old?.name || "");
  const [prompt, setPrompt] = useState(old?.prompt || "");
  const [cron, setCron] = useState(old?.cron || "0 9 * * 1-5");
  const [timezone, setTimezone] = useState(old?.timezone || "Asia/Taipei");
  const [enabled, setEnabled] = useState(old?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <Modal label={old ? uiText("編輯排程") : uiText("新增排程")} close={close}>
      <section className="modal routine-modal">
        <header>
          <h2>{old ? uiText("編輯排程") : uiText("新增排程")}</h2>
          <button
            className="icon"
            aria-label={uiText("關閉排程")}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving) return;
            setSaving(true);
            setNotice("");
            try {
              await save(async () => {
                try {
                  await api(
                    old ? `/routines/${old.id}` : `/bots/${botId}/routines`,
                    old ? "PATCH" : "POST",
                    { name, prompt, cron, timezone, enabled },
                  );
                  close();
                } catch (error) {
                  setNotice((error as Error).message);
                  throw error;
                }
              });
            } finally {
              setSaving(false);
            }
          }}
        >
          {notice && (
            <div className="notice" role="alert">
              {notice}
            </div>
          )}
          <label>
            {uiText("名稱")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            {uiText("交辦內容")}
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </label>
          <label>
            {uiText("時間")}
            <select
              value={
                ["0 9 * * 1-5", "0 9 * * *", "0 9 * * 1"].includes(cron)
                  ? cron
                  : "custom"
              }
              onChange={(e) =>
                setCron(
                  e.target.value === "custom" ? "0 10 * * *" : e.target.value,
                )
              }
            >
              <option value="0 9 * * 1-5">{uiText("每個工作日 09:00")}</option>
              <option value="0 9 * * *">{uiText("每天 09:00")}</option>
              <option value="0 9 * * 1">{uiText("每週一 09:00")}</option>
              <option value="custom">{uiText("自訂 Cron")}</option>
            </select>
          </label>
          <div className="form-row">
            <label>
              Cron
              <input value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
            <label>
              {uiText("時區")}
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {uiText("啟用排程（Apsis 需保持執行）")}
          </label>
          <footer>
            {old && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void save(() => api(`/routines/${old.id}/test`, "POST", {}))
                }
              >
                {uiText("立即試跑")}
              </button>
            )}
            <button className="primary" type="submit" disabled={saving}>
              {saving ? uiText("儲存中…") : uiText("儲存排程")}
            </button>
          </footer>
        </form>
        {old && (
          <details className="routine-history">
            <summary>{uiText("執行紀錄（{0}）", [old.history.length])}</summary>
            {old.history.map((h) => (
              <p key={h.jobId}>
                {new Date(h.at).toLocaleString(getSettingsLocale())}
              </p>
            ))}
          </details>
        )}
      </section>
    </Modal>
  );
}
function Settings({
  state,
  close,
  refresh,
  report,
}: {
  state: Snapshot;
  close: () => void;
  refresh: () => Promise<void>;
  report: (text: string) => void;
}) {
  useSettingsLocale();
  const [tab, setTab] = useState("models");
  const [dirty, setDirty] = useState(false);
  const canLeave = () =>
    !dirty || window.confirm(uiText("捨棄尚未儲存的設定變更？"));
  const guardedClose = () => {
    if (canLeave()) close();
  };
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showTelegramTokenForm, setShowTelegramTokenForm] = useState(false);
  const [pairingCommand, setPairingCommand] = useState("");
  const [connectorMode, setConnectorMode] = useState<"form" | "json">("form");
  const [connectorJson, setConnectorJson] = useState("");
  const [connectorJsonError, setConnectorJsonError] = useState("");
  const [connectorDrafts, setConnectorDrafts] = useState<McpConnectorInput[]>(
    [],
  );
  const [telegram, setTelegram] = useState<TelegramView>();
  const [rules, setRules] = useState<
    {
      id: string;
      tool: string;
      args: unknown;
      legacy?: boolean;
      scopeKey?: string;
    }[]
  >([]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importConnectorDrafts = async () => {
    setBusy(true);
    setNotice("");
    let added = 0;
    let failure = "";
    for (const draft of connectorDrafts) {
      try {
        await api("/connectors", "POST", draft);
        added++;
      } catch (error) {
        failure = `${draft.name}：${(error as Error).message}`;
        break;
      }
    }
    if (added) {
      try {
        await refresh();
      } catch (error) {
        failure ||= uiText("清單更新失敗：{0}", [(error as Error).message]);
      }
    }
    setConnectorDrafts(connectorDrafts.slice(added));
    if (failure) {
      setNotice(`${added ? uiText("已加入 {0} 個。", [added]) : ""}${failure}`);
    } else {
      setConnectorJson("");
      setNotice(uiText("已加入 {0} 個 MCP 連接器。", [added]));
    }
    setBusy(false);
  };
  useEffect(() => {
    if (tab === "telegram")
      void api<TelegramView>("/api/channels/telegram")
        .then(setTelegram)
        .catch((e) => setNotice(e.message));
    if (tab === "approvals")
      void api<typeof rules>("/rules")
        .then(setRules)
        .catch((e) => setNotice(e.message));
  }, [tab]);
  useEffect(() => {
    if (tab !== "telegram") return;
    const timer = setInterval(() => {
      void api<TelegramView>("/api/channels/telegram")
        .then(setTelegram)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [tab]);
  useEffect(() => {
    if (telegram?.ownerId) setPairingCommand("");
  }, [telegram?.ownerId]);
  return (
    <Modal label={t("settings")} close={guardedClose}>
      <section className="modal settings-modal">
        <header>
          <div>
            <h2>{t("settings")}</h2>
            <p>{uiText("模型和工具供所有 Bots 使用。")}</p>
          </div>
          <button
            className="icon"
            aria-label={uiText("關閉設定")}
            onClick={guardedClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-tabs">
            {[
              ["general", t("general")],
              ["models", t("models")],
              ["connectors", t("connectors")],
              ["skills", t("skills")],
              ["templates", t("templates")],
              ["telegram", "Telegram"],
              ["approvals", t("approvals")],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                aria-current={tab === id ? "true" : undefined}
                onClick={() => {
                  if (id === tab || !canLeave()) return;
                  setTab(id);
                  setNotice("");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <ExecutionSettings api={api} onDirtyChange={setDirty} />
            )}
            {tab === "templates" && (
              <TemplateSettings
                api={api}
                refresh={refresh}
                onDirtyChange={setDirty}
              />
            )}
            {notice && (
              <div role="status" className="notice">
                {notice}
              </div>
            )}
            {busy && <ActionFeedback label="正在處理設定操作…" pending />}
            {tab === "models" && (
              <ProviderSettings
                onDirtyChange={setDirty}
                connections={state.connections}
                defaultModel={state.defaultModel}
                bots={state.bots}
                api={api}
                refresh={refresh}
              />
            )}
            {tab === "connectors" && (
              <>
                <h3>{uiText("MCP 連接器")}</h3>
                <p className="muted">
                  {uiText(
                    "連接支援 Streamable HTTP 的 MCP 服務。工具執行前會出現核准卡片。",
                  )}
                </p>
                {state.connectors.map((c) => (
                  <div className="connection-card" key={c.id}>
                    <div>
                      <strong>{c.name}</strong>
                      <small>{c.url}</small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() =>
                        void run(() => api(`/connectors/${c.id}`, "DELETE"))
                      }
                    >
                      {uiText("移除")}
                    </button>
                  </div>
                ))}
                <section className="settings-form connector-setup">
                  <h3>{uiText("新增連接器")}</h3>
                  <div
                    className="connector-mode"
                    aria-label={uiText("連接器輸入方式")}
                  >
                    <button
                      className={connectorMode === "form" ? "selected" : ""}
                      aria-current={
                        connectorMode === "form" ? "true" : undefined
                      }
                      onClick={() => setConnectorMode("form")}
                    >
                      {uiText("手動輸入")}
                    </button>
                    <button
                      className={connectorMode === "json" ? "selected" : ""}
                      aria-current={
                        connectorMode === "json" ? "true" : undefined
                      }
                      onClick={() => setConnectorMode("json")}
                    >
                      {uiText("貼上 JSON")}
                    </button>
                  </div>
                  {connectorMode === "form" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        void run(async () => {
                          await api(
                            "/connectors",
                            "POST",
                            Object.fromEntries(form),
                          );
                          setNotice(uiText("已連線，Bot 可使用這個服務。"));
                        });
                      }}
                    >
                      <label>
                        {uiText("名稱")}
                        <input name="name" required />
                      </label>
                      <label>
                        MCP endpoint
                        <input
                          name="url"
                          type="url"
                          required
                          placeholder="https://example.com/mcp"
                        />
                      </label>
                      <label>
                        {uiText("Bearer token（選填）")}
                        <input
                          name="token"
                          type="password"
                          autoComplete="off"
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        {uiText("測試並加入")}
                      </button>
                    </form>
                  ) : (
                    <div className="connector-json">
                      <p className="muted">
                        {uiText(
                          "支援 mcpServers、servers 或單筆 JSON；可一次加入多個 Streamable HTTP 服務。",
                        )}
                      </p>
                      <label>
                        {uiText("MCP 設定 JSON")}
                        <textarea
                          rows={9}
                          spellCheck={false}
                          value={connectorJson}
                          onChange={(event) => {
                            setConnectorJson(event.target.value);
                            setConnectorDrafts([]);
                            setConnectorJsonError("");
                          }}
                          placeholder={
                            '{\n  "mcpServers": {\n    "notes": {\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer YOUR_TOKEN" }\n    }\n  }\n}'
                          }
                          aria-invalid={!!connectorJsonError}
                          aria-describedby={
                            connectorJsonError
                              ? "connector-json-error"
                              : undefined
                          }
                        />
                      </label>
                      {connectorJsonError && (
                        <p
                          id="connector-json-error"
                          className="field-error"
                          role="alert"
                        >
                          {connectorJsonError}
                        </p>
                      )}
                      <div className="connector-json-actions">
                        <button
                          className="secondary"
                          disabled={busy || !connectorJson.trim()}
                          onClick={() => {
                            try {
                              setConnectorDrafts(
                                parseMcpConnectorJson(connectorJson),
                              );
                              setConnectorJsonError("");
                            } catch (error) {
                              setConnectorDrafts([]);
                              setConnectorJsonError((error as Error).message);
                            }
                          }}
                        >
                          {uiText("檢查 JSON")}
                        </button>
                      </div>
                      {connectorDrafts.length > 0 && (
                        <div className="connector-preview">
                          <strong>
                            {uiText("準備加入 {0} 個連接器", [
                              connectorDrafts.length,
                            ])}
                          </strong>
                          {connectorDrafts.map((draft, index) => (
                            <div
                              className="connector-preview-item"
                              key={`${draft.name}-${index}`}
                            >
                              <span>{draft.name}</span>
                              <small>{draft.url}</small>
                              <small>
                                {draft.token
                                  ? uiText("Bearer token 已提供")
                                  : uiText("無需 token")}
                              </small>
                            </div>
                          ))}
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => void importConnectorDrafts()}
                          >
                            {busy
                              ? uiText("連線測試中…")
                              : uiText("測試並加入")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
            {tab === "skills" && (
              <>
                <h3>{uiText("共用技能")}</h3>
                <p className="muted">{uiText("在對話輸入 / 選擇技能。")}</p>
                {state.skills.map((s) => (
                  <details className="skill-card" key={s.id}>
                    <summary>{s.name}</summary>
                    <Markdown text={s.content} />
                  </details>
                ))}
                <form
                  className="settings-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = Object.fromEntries(
                      new FormData(e.currentTarget),
                    );
                    void run(async () => {
                      await api("/api/skills", "POST", data);
                      setNotice(uiText("技能已建立。"));
                    });
                  }}
                >
                  <label>
                    {uiText("名稱")}
                    <input name="name" required />
                  </label>
                  <label>
                    {uiText("步驟")}
                    <textarea name="content" rows={5} required />
                  </label>
                  <button className="primary" disabled={busy}>
                    {uiText("新增技能")}
                  </button>
                </form>
              </>
            )}
            {tab === "telegram" && (
              <>
                <div className="settings-section-heading">
                  <div>
                    <h3>Telegram</h3>
                    <p className="muted">
                      {uiText("在 Telegram 私訊你的 Bot，接續本機工作。")}
                    </p>
                  </div>
                </div>
                <div className="service-card telegram-status-card">
                  <div className="service-card-main">
                    <strong>
                      {telegram?.username
                        ? `@${telegram.username}`
                        : "Telegram Bot"}
                    </strong>
                    <span
                      className={`status-badge ${telegram?.ownerId ? "is-success" : telegram?.status === "error" ? "is-error" : ""}`}
                    >
                      {!telegram
                        ? uiText("檢查中")
                        : telegram.ownerId
                          ? uiText("已配對")
                          : !telegram.configured
                            ? uiText("尚未設定")
                            : telegram.status === "connected"
                              ? uiText("等待配對")
                              : telegram.status === "connecting"
                                ? uiText("連線中")
                                : telegram.status === "error"
                                  ? uiText("連線失敗")
                                  : uiText("已停用")}
                    </span>
                    <small>
                      {!telegram
                        ? uiText("正在讀取 Telegram 設定。")
                        : telegram.ownerId
                          ? uiText("你的 Telegram 帳號已綁定，可開始傳訊。")
                          : !telegram.configured
                            ? uiText("先儲存從 BotFather 取得的 token。")
                            : telegram.status === "connected"
                              ? uiText("Bot 已連線，請建立配對碼綁定你的帳號。")
                              : telegram.status === "connecting"
                                ? uiText("正在連線 Telegram，完成後即可配對。")
                                : telegram.error ||
                                  uiText("啟用 Bot 後即可配對。")}
                    </small>
                  </div>
                </div>
                {telegram && (
                  <div className="setup-steps">
                    <section className="setup-step">
                      <div className="setup-step-heading">
                        <span className="setup-step-number">1</span>
                        <div>
                          <h4>{uiText("連接你的 Bot")}</h4>
                          <p>
                            {uiText(
                              "從 Telegram 的 @BotFather 取得 Bot token，儲存在這台電腦。",
                            )}
                          </p>
                        </div>
                      </div>
                      {telegram?.configured && !showTelegramTokenForm ? (
                        <div className="setup-step-actions">
                          <span className="setup-step-done">
                            {uiText("Token 已儲存")}
                          </span>
                          {!telegram.enabled && (
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  setTelegram(
                                    await api<TelegramView>(
                                      "/api/channels/telegram",
                                      "POST",
                                      { enabled: true },
                                    ),
                                  );
                                })
                              }
                            >
                              {uiText("啟用 Bot")}
                            </button>
                          )}
                          <button
                            className="text-button"
                            onClick={() => setShowTelegramTokenForm(true)}
                          >
                            {uiText("更換 token")}
                          </button>
                        </div>
                      ) : (
                        <form
                          className="telegram-token-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = new FormData(e.currentTarget);
                            void run(async () => {
                              const next = await api<TelegramView>(
                                "/api/channels/telegram",
                                "POST",
                                { token: form.get("token"), enabled: true },
                              );
                              setTelegram(next);
                              setShowTelegramTokenForm(false);
                              setPairingCommand("");
                              setNotice(
                                uiText("Token 已儲存，正在連線 Telegram。"),
                              );
                            });
                          }}
                        >
                          <label>
                            Bot token
                            <input
                              name="token"
                              type="password"
                              required
                              autoComplete="off"
                              placeholder={uiText("從 @BotFather 取得")}
                            />
                          </label>
                          <div className="setup-step-actions">
                            <button className="primary" disabled={busy}>
                              {uiText("儲存並啟用")}
                            </button>
                            {telegram?.configured && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setShowTelegramTokenForm(false)}
                              >
                                {uiText("取消")}
                              </button>
                            )}
                          </div>
                        </form>
                      )}
                    </section>
                    <section className="setup-step">
                      <div className="setup-step-heading">
                        <span className="setup-step-number">2</span>
                        <div>
                          <h4>{uiText("配對 Telegram 帳號")}</h4>
                          <p>
                            {uiText(
                              "建立指令後，私訊你的 Bot 完成配對。指令有效 10 分鐘。",
                            )}
                          </p>
                        </div>
                      </div>
                      {telegram?.ownerId ? (
                        <p className="setup-step-done">
                          {uiText("帳號已配對")}
                        </p>
                      ) : (
                        <div className="setup-step-actions">
                          <button
                            className="secondary"
                            disabled={busy || telegram?.status !== "connected"}
                            onClick={() =>
                              void run(async () => {
                                const result = await api<{ command: string }>(
                                  "/api/channels/telegram/pairing",
                                  "POST",
                                  {},
                                );
                                setPairingCommand(result.command);
                              })
                            }
                          >
                            {pairingCommand
                              ? uiText("重新產生指令")
                              : uiText("建立配對指令")}
                          </button>
                          {telegram?.status === "connecting" && (
                            <span className="muted">
                              {uiText("等待連線完成…")}
                            </span>
                          )}
                        </div>
                      )}
                      {pairingCommand && !telegram?.ownerId && (
                        <div className="pairing-command" role="status">
                          <span>{uiText("傳送給 Bot")}</span>
                          <code>{pairingCommand}</code>
                          <button
                            className="secondary"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(pairingCommand)
                                .then(() =>
                                  setNotice(uiText("配對指令已複製。")),
                                )
                                .catch(() =>
                                  setNotice(
                                    uiText(
                                      "無法自動複製，請手動選取配對指令。",
                                    ),
                                  ),
                                )
                            }
                          >
                            {uiText("複製指令")}
                          </button>
                        </div>
                      )}
                    </section>
                  </div>
                )}
                <p className="telegram-help muted">
                  {uiText("配對後可用")}
                  <code>/bots</code>
                  {uiText("查看名單、")}
                  <code>/bot ID</code> {uiText("選擇 Bot、")}
                  <code>/stop</code>
                  {uiText("停止工作。")}
                </p>
              </>
            )}
            {tab === "approvals" && (
              <>
                <h3>{uiText("自動核准規則")}</h3>
                <p className="muted">
                  {uiText(
                    "記住的核准只適用於原任務及其派工。舊版永久核准保留供查閱，不再生效。",
                  )}
                </p>
                {!rules.length && (
                  <p className="empty-section">
                    {uiText("尚未儲存自動核准規則。")}
                  </p>
                )}
                {rules.map((r) => (
                  <div className="rule" key={r.id}>
                    <strong>{r.tool}</strong>
                    <small>
                      {uiText(
                        r.legacy ? "舊版紀錄（不生效）" : "限原任務及其派工",
                      )}
                    </small>
                    <pre>{JSON.stringify(r.args, null, 2)}</pre>
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await api(`/rules/${r.id}`, "DELETE");
                          setRules((old) => old.filter((x) => x.id !== r.id));
                        })
                      }
                    >
                      {uiText("撤銷規則")}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </section>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
