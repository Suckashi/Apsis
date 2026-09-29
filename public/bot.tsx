import { ProjectSettings } from "./project-settings.tsx";
import { api } from "./chat-api.ts";
import { ChatRoster } from "./chat-roster.tsx";
import { ProjectControls } from "./project-controls.tsx";
import { ConversationChanges } from "./conversation-changes.tsx";
import { FilePanel, WorkFolder } from "./file-panel.tsx";
import { ComposerPopover } from "./composer-popover.tsx";
import { AvatarCollectionProvider } from "./avatar-collection.tsx";
import { ContextPanel } from "./context-panel.tsx";
import { ApprovalModeControl } from "./approval-mode-control.tsx";
import { WorkApproval } from "./work-approval.tsx";
import { currentWorkStatus } from "../shared/work-presentation.ts";
import { ModelPicker, connectionModelOptions } from "./model-picker.tsx";
import {
  ComposerFrame,
  useAutoGrowTextarea,
  InspectorResize,
  useInspectorWidth,
} from "./workspace-primitives.tsx";
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
import {
  BrandMark,
  AvatarPicker,
  CopyButton,
  Modal,
  useDrawer,
  useWorkspaceLayout,
} from "./bot-ui.tsx";
import type { ProductService } from "../server/product.ts";
import type { Routine, Artifact, Draft } from "../shared/product.ts";
import {
  LegacyDelegations,
  ProgressStrip,
  RunHistory,
  RunArchive,
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
  const approvalGeneration = useRef(0);
  const acceptApprovalSettings = useCallback((next: GlobalSettings) => {
    // File revisions are opaque hashes. Invalidate reads started before this save.
    approvalGeneration.current++;
    setApprovalSettings(next);
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
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!smallScreen || !viewport) return;
    const update = () => {
      document.documentElement.style.setProperty(
        "--mobile-viewport-height",
        viewport.height + "px",
      );
    };
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--mobile-viewport-height");
    };
  }, [smallScreen]);
  const sidebarRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const [composeOptions, setComposeOptions] = useState(false);
  const [projectSettings, setProjectSettings] = useState(false);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState("");
  const [filesTab, setFilesTab] = useState(true);
  const [botSheet, setBotSheet] = useState<"routines" | "context">();
  const [fileReferences, setFileReferences] = useState<
    { locationId: string; path: string; revision: string }[]
  >([]);
  const [caret, setCaret] = useState(0);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
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
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [eventsConnected, setEventsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const listDrawer = smallScreen && mobileList;
  const detailsVisible = panel && !!selected && !!detail;
  const detailsDrawer = overlayDetails && detailsVisible && !listDrawer;
  useDrawer(sidebarRef, listDrawer, () => setMobileList(false));
  useDrawer(detailsRef, detailsDrawer, () => setPanel(false));
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(input, detail ? text : "\0");
  const [inspectorWidth, setInspectorWidth] = useInspectorWidth(
    "apsis.inspector-width",
  );
  const upload = useRef<HTMLInputElement>(null);
  const pendingRequest = useRef<
    { scope?: string; prompt: string; botId: string; id: string } | undefined
  >(undefined);
  const generation = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    const settingsVersion = approvalGeneration.current;
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
    setState((previous) =>
      previous &&
      previous.avatarCollection.revision > next.avatarCollection.revision
        ? { ...next, avatarCollection: previous.avatarCollection }
        : next,
    );
    if (settingsVersion === approvalGeneration.current)
      setApprovalSettings(nextSettings);
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
    if (!id && next.bots.length) setSelected(next.bots[0].id);
    if (id && !nextDetail) {
      selectedRef.current = null;
      setSelected(null);
      localStorage.removeItem("apsis.bot");
    }
  }, []);
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
    void api("/bootstrap", "POST", {})
      .then(refresh)
      .catch((e) => setError(e.message));
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
    setText(sessionStorage.getItem(`apsis.bot-draft.${selected}`) || "");
    setFileReferences([]);
    setDismissedSuggestion(false);
    draftSelection.current = { start: 0, end: 0 };
    setAttachments([]);
    setReplyTo(undefined);
    setRetryOf(undefined);
    setProfile(false);
    setBotSheet(undefined);
    setComposeOptions(false);
    setProjectSettings(false);
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
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || detail?.bot.id !== selected) return;
    const key = `apsis.bot-scroll.${selected}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      pinnedBottom.current = saved?.following ?? true;
      el.scrollTop = pinnedBottom.current ? el.scrollHeight : saved?.top || 0;
    } catch {
      pinnedBottom.current = true;
      el.scrollTop = el.scrollHeight;
    }
    setAwayFromBottom(!pinnedBottom.current);
  }, [detail?.bot.id, selected]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && detail?.bot.id === selected && pinnedBottom.current)
      el.scrollTop = el.scrollHeight;
  }, [detail?.session.messages.length, detail?.session.live?.text]);
  const select = (id: string) => {
    if (selected) sessionStorage.setItem(`apsis.bot-draft.${selected}`, text);
    setSelected(id);
    setMobileList(false);
  };
  const newBot = () => {
    setMobileList(false);
    setCreating(true);
  };
  const send = async () => {
    if (
      !selected ||
      !detail ||
      detail.contextSetupError ||
      busy ||
      (!text.trim() && !attachments.length)
    )
      return;
    const prompt = [
      text.trim(),
      ...attachments.map((a) =>
        uiText("附件：{0}，工作區路徑：{1}", [a.name, a.path]),
      ),
    ]
      .filter(Boolean)
      .join("\n");
    const scope = JSON.stringify([
      detail.session.context?.id,
      replyTo,
      retryOf,
      fileReferences,
      attachments.map((a) => a.id),
    ]);
    if (
      pendingRequest.current?.prompt !== prompt ||
      pendingRequest.current?.botId !== selected ||
      pendingRequest.current?.scope !== scope
    )
      pendingRequest.current = {
        prompt,
        botId: selected,
        scope,
        id: crypto.randomUUID(),
      };
    const botId = selected;
    setBusy(true);
    setError("");
    setActionFeedback({ botId, label: "正在送出訊息…", pending: true });
    try {
      await api("/bots/" + botId + "/messages", "POST", {
        prompt,
        requestId: pendingRequest.current.id,
        replyTo,
        retryOf,
        fileReferences,
        artifactIds: attachments.map((a) => a.id),
        workContextId: detail.session.context?.id,
      });
      pendingRequest.current = undefined;
      if (selectedRef.current === botId) {
        setText("");
        sessionStorage.removeItem("apsis.bot-draft." + botId);
        setAttachments([]);
        setFileReferences([]);
        setReplyTo(undefined);
        setRetryOf(undefined);
        pinnedBottom.current = true;
      }
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setActionFeedback(undefined);
      setBusy(false);
      input.current?.focus();
    }
  };
  const referenceArtifact = (artifact: Artifact) =>
    void perform(async () => {
      const ref = await api<{
        locationId: string;
        path: string;
        revision: string;
      }>(`/bots/${selected}/artifact-reference`, "POST", {
        contextId: detail?.session.context?.id,
        artifactId: artifact.id,
      });
      setFileReferences((old) => [...old, ref]);
      setText(
        (old) => old + (old ? "\n" : "") + uiText("引用檔案：") + ref.path,
      );
      await refresh();
    });
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
        const res = await fetch(
          `/api/v2/bots/${botId}/attachments?contextId=${encodeURIComponent(detail?.session.context?.id || "")}`,
          {
            method: "POST",
            headers: {
              "X-Apsis-Client": "1",
              "X-File-Name": encodeURIComponent(file.name),
              "Content-Type": "application/octet-stream",
            },
            body: file,
          },
        );
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
  const workStatus = currentWorkStatus({
    connected: eventsConnected,
    modelIssue: detail?.contextSetupError,
    approvalCount: pending.length,
    active: activeSummary,
    running,
  });
  const modelOptions = connectionModelOptions(state?.connections || []);
  const selectedModel = detail?.bot.connectionId
    ? JSON.stringify([detail.bot.connectionId, detail.bot.model])
    : state?.defaultModel
      ? JSON.stringify([
          state.defaultModel.connectionId,
          state.defaultModel.model,
        ])
      : "";
  const chooseBotModel = async (value: string) => {
    if (!selected || running) return;
    const [connectionId, model] = JSON.parse(value) as string[];
    await api(`/bots/${selected}`, "PATCH", { connectionId, model });
    await refresh();
  };
  const modelPicker = (
    <ModelPicker
      label={uiText("Bot 模型")}
      value={selectedModel}
      options={modelOptions}
      disabled={running || !detail || !modelOptions.length}
      onChange={chooseBotModel}
      placeholder={bot?.model || uiText("選擇模型")}
    />
  );
  const repairModel = () =>
    modelOptions.length ? setProfile(true) : setSettings(true);
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
    setExpandedRuns((old) => ({
      ...old,
      [id]: !old[id],
    }));
  const revealRun = (id: string) => {
    setExpandedRuns((old) => ({ ...old, [id]: true }));
    requestAnimationFrame(() => {
      const element = document.getElementById(`task-${id}`);
      element?.scrollIntoView({ block: "nearest" });
      element
        ?.querySelector<HTMLElement>(".execution-tools > summary")
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
  const content = (
    <div
      style={
        { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties
      }
      className={`app ${detailsVisible ? "details-open" : ""} ${mobileList ? "list-open" : ""} ${!listVisible ? "list-collapsed" : ""} ${focusMode ? "focus-mode" : ""}`}
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
        <ChatRoster
          bots={bots}
          selected={selected}
          select={select}
          hidden={hidden}
          query={query}
        />
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
        className="conversation conversation-shell"
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
                  setProfile(true);
                }}
              >
                <span className="avatar small">
                  <BrandMark size={23} avatar={bot?.avatar} />
                </span>
                <span>
                  <strong>{bot?.name || uiText("載入中")}</strong>
                  <small data-state={workStatus.availability}>
                    {!detail
                      ? uiText("載入對話…")
                      : workStatus.phase === "unavailable"
                        ? uiError(workStatus.label)
                        : taskProgress(locale, workStatus.label)}
                  </small>
                </span>
              </button>
              <div className="header-actions">
                <ComposerPopover
                  label={
                    <span aria-label={uiText("Bot 選單")}>
                      <Icon name="more" />
                    </span>
                  }
                  className="bot-actions-menu"
                >
                  <button
                    disabled={
                      !detail ||
                      busy ||
                      running ||
                      queuedCount > 0 ||
                      pending.length > 0
                    }
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          "/bots/" + selected + "/contexts",
                          "POST",
                          {},
                        );
                        setAttachments([]);
                        setFileReferences([]);
                        setReplyTo(undefined);
                        setRetryOf(undefined);
                        pendingRequest.current = undefined;
                        await refresh();
                        input.current?.focus();
                      })
                    }
                  >
                    {uiText("開啟新話題")}
                  </button>
                  <button onClick={() => setComposeOptions(true)}>
                    {uiText("聊天選項")}
                  </button>
                  <button onClick={() => setBotSheet("routines")}>
                    {uiText("排程")}
                  </button>
                  <button onClick={() => setBotSheet("context")}>
                    {uiText("記憶與背景")}
                  </button>
                  <button onClick={() => setProfile(true)}>
                    {uiText("Bot 設定")}
                  </button>
                </ComposerPopover>
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
                  aria-label={uiText("切換工作內容")}
                  title={uiText("檔案與變更")}
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
                if (detail?.bot.id === selected) {
                  try {
                    sessionStorage.setItem(
                      `apsis.bot-scroll.${selected}`,
                      JSON.stringify({
                        top: el.scrollTop,
                        following: pinnedBottom.current,
                      }),
                    );
                  } catch {
                    /* Storage may be unavailable. */
                  }
                }
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
                  {!detail.session.messages.length && !running && (
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
                          uiText("幫我修改程式並驗證結果"),
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
                    <React.Fragment key={m.id}>
                      {index > 0 &&
                        m.workContextId !==
                          detail.session.messages[index - 1].workContextId && (
                          <div className="topic-divider" role="separator">
                            {uiText("新話題")}
                          </div>
                        )}
                      <article
                        id={`message-${m.id}`}
                        className={`message ${m.role} ${m.status === "error" ? "failed" : ""}`}
                      >
                        <div className="message-body">
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
                                      detail.jobs.find(
                                        (j) => j.runId === m.runId,
                                      )?.replyTo,
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
                        {m.role === "assistant" &&
                          m.runId &&
                          detail.artifacts
                            .filter(
                              (a) => a.kind === "result" && a.runId === m.runId,
                            )
                            .map((a) => (
                              <ArtifactCard
                                key={a.id}
                                artifact={a}
                                reference={() => referenceArtifact(a)}
                              />
                            ))}
                        <div className="message-footer">
                          {m.delivery?.kind === "steer" && (
                            <span
                              className="message-delivery"
                              data-state={m.delivery.state}
                              title={
                                m.delivery.state === "applied"
                                  ? uiText(
                                      "補充已帶入下一個模型回合，不代表工作已完成。",
                                    )
                                  : m.delivery.state === "pending"
                                    ? uiText("等待目前模型回合結束後採用。")
                                    : uiText(
                                        "這則補充沒有帶入模型回合，請重新送出。",
                                      )
                              }
                            >
                              {m.delivery.state === "applied"
                                ? uiText("已採用")
                                : m.delivery.state === "pending"
                                  ? uiText("已收到")
                                  : uiText("未採用")}
                            </span>
                          )}
                          <div className="message-actions">
                            {m.delivery?.state === "not-applied" && (
                              <button
                                onClick={() => {
                                  pendingRequest.current = undefined;
                                  setText(m.content);
                                  input.current?.focus();
                                }}
                              >
                                {uiText("重新傳送")}
                              </button>
                            )}
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
                    </React.Fragment>
                  ))}
                  {running && (
                    <article className="message assistant live">
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
                      {detail.session.live?.text && (
                        <Markdown text={detail.session.live.text} />
                      )}
                    </article>
                  )}
                  {pending.map((a) => (
                    <WorkApproval
                      key={a.id}
                      approval={a}
                      onDecide={async (id, approved, remember) => {
                        await api(`/approvals/${id}`, "POST", {
                          approved,
                          remember,
                        });
                        await refresh();
                      }}
                    />
                  ))}
                  <LegacyDelegations
                    key={selected}
                    jobs={detail.legacyDelegations}
                    select={select}
                    available={availableBots}
                  />
                  <RunArchive
                    key={`run-archive:${detail.bot.id}`}
                    botId={detail.bot.id}
                    summaries={detail.runSummaries.filter(
                      (r) =>
                        r.status !== "running" &&
                        !detail.session.messages.some(
                          (m) => m.role === "assistant" && m.runId === r.id,
                        ),
                    )}
                    expandedRuns={expandedRuns}
                    toggleRun={toggleRun}
                    select={select}
                    available={availableBots}
                  />
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
                          {uiText("接下來：")}
                          {j.prompt}
                        </span>
                      </div>
                    ))}
                  {detail.artifacts
                    .filter(
                      (a) =>
                        a.kind === "result" &&
                        !detail.session.messages.some(
                          (m) => m.role === "assistant" && m.runId === a.runId,
                        ),
                    )
                    .map((a) => (
                      <ArtifactCard
                        key={a.id}
                        artifact={a}
                        reference={() => referenceArtifact(a)}
                      />
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
                            aria-label={uiText("關閉這則提示")}
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
                  {detail.session.messages.length > 0 &&
                    detail.session.messages.at(-1)?.workContextId !==
                      detail.session.context?.id && (
                      <div className="topic-divider" role="separator">
                        {uiText("新話題")}
                      </div>
                    )}
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
              <ComposerFrame as="div" className="composer-card">
                <div className="composer-status">
                  <div className="composer-status-content">
                    {actionFeedback?.botId === selected &&
                      (actionFeedback.pending || !activeSummary) && (
                        <ActionFeedback
                          label={actionFeedback.label}
                          pending={actionFeedback.pending}
                        />
                      )}
                    {stoppingBot === selected && (
                      <ActionFeedback
                        label="正在停止回覆，等待執行中的操作結束…"
                        pending
                      />
                    )}
                    {activeSummary && (
                      <ProgressStrip
                        summary={activeSummary}
                        connected={eventsConnected}
                        open={!!expandedRuns[activeSummary.id]}
                        toggle={() =>
                          !!expandedRuns[activeSummary.id]
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
                    {running && !activeSummary && (
                      <ActionFeedback
                        label="正在準備回覆，等待模型回應…"
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
                      aria-label={uiText("停止回覆")}
                      title={uiText("停止回覆")}
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
                      {uiText("重新傳送")}
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
                  {!!fileReferences.length && (
                    <div className="attachment-chips">
                      {fileReferences.map((ref) => (
                        <span key={ref.locationId + ref.path}>
                          <Icon name="file" size={14} />
                          {ref.path}
                          <button
                            aria-label={uiText("移除 {0}", [ref.path])}
                            onClick={() =>
                              setFileReferences((old) =>
                                old.filter((r) => r !== ref),
                              )
                            }
                          >
                            <Icon name="close" size={14} />
                          </button>
                        </span>
                      ))}
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
                            <Icon name="close" size={14} />
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
                      if (selected)
                        sessionStorage.setItem(
                          `apsis.bot-draft.${selected}`,
                          e.target.value,
                        );
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
                        !smallScreen &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
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
                        {[{ label: "連接器 @", items: connectorChoices }].map(
                          (group) => (
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
                          ),
                        )}
                      </ComposerPopover>
                    </div>
                    <div className="composer-send-actions">
                      <button
                        className={`send ${running ? "queue-send" : ""}`}
                        aria-label={
                          running ? uiText("補充指示") : uiText("傳送")
                        }
                        title={running ? uiText("補充指示") : uiText("傳送")}
                        disabled={
                          busy ||
                          !detail ||
                          !!detail.contextSetupError ||
                          (!text.trim() && !attachments.length)
                        }
                        onClick={() => void send()}
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
                  <div role="status" className="model-setup-notice">
                    <ActivityMark state="failed" />
                    <span>
                      <strong>{uiText("目前無法開始工作")}</strong>
                      <small>{uiError(detail.contextSetupError)}</small>
                    </span>
                    <button type="button" onClick={repairModel}>
                      {uiText(
                        modelOptions.length
                          ? "修正此 Bot 的模型"
                          : "設定模型連線",
                      )}
                    </button>
                  </div>
                )}
              </ComposerFrame>
              <p className="composer-note">
                {running
                  ? uiText("直接傳訊息，補充你希望 Bot 做的事。")
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
          aria-label={uiText("工作內容")}
          inert={listDrawer}
        >
          {!overlayDetails && (
            <InspectorResize
              value={inspectorWidth}
              label={uiText("調整檢視區寬度")}
              onChange={setInspectorWidth}
            />
          )}
          <div className="details-header">
            <nav className="detail-tabs" aria-label={uiText("工作內容分類")}>
              <button aria-pressed={filesTab} onClick={() => setFilesTab(true)}>
                {uiText("檔案")}
              </button>
              <button
                aria-pressed={!filesTab}
                onClick={() => setFilesTab(false)}
              >
                {uiText("變更")}
              </button>
            </nav>
            <button
              className="icon"
              aria-label={uiText("關閉工作內容")}
              onClick={() => setPanel(false)}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          {filesTab && detail.session.context ? (
            <>
              <FilePanel
                key={`${selected}:${detail.session.context.id}:${detail.session.context.location?.id}`}
                context={detail.session.context}
                storageKey={`apsis.bot-file.${selected}.${detail.session.context.id}`}
                api={api}
                updateKey={
                  detail.jobs.map((j) => j.id + j.status).join(":") +
                  detail.artifacts.length +
                  state?.bots.map((b) => b.id + b.status).join(":")
                }
                reference={(ref) => {
                  setFileReferences((old) => [
                    ...old.filter(
                      (r) =>
                        r.path !== ref.path || r.locationId !== ref.locationId,
                    ),
                    ref,
                  ]);
                  setText(
                    (text) =>
                      text +
                      (text ? "\n" : "") +
                      uiText("引用檔案：") +
                      ref.path,
                  );
                }}
              />

              {detail.artifacts.length > 0 && (
                <details className="cw-deliveries">
                  <summary>
                    {uiText("附件與成果")} · {detail.artifacts.length}
                  </summary>
                  {detail.artifacts
                    .slice()
                    .reverse()
                    .map((a) => (
                      <ArtifactCard
                        key={a.id}
                        artifact={a}
                        compact
                        reference={() => referenceArtifact(a)}
                      />
                    ))}
                </details>
              )}
            </>
          ) : (
            <div className="details-body">
              <ConversationChanges
                botId={selected}
                context={detail.session.context!}
                api={api}
              />
            </div>
          )}
        </aside>
      )}
      {composeOptions && (
        <Modal
          label={uiText("聊天選項")}
          close={() => setComposeOptions(false)}
        >
          <section className="modal mobile-compose-sheet">
            <header>
              <h2>{uiText("聊天選項")}</h2>
              <button
                className="icon"
                aria-label={uiText("關閉聊天選項")}
                onClick={() => setComposeOptions(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            {detail?.session.context && selected && (
              <WorkFolder
                botId={selected}
                context={detail.session.context}
                api={api}
                refresh={refresh}
              />
            )}
            {detail?.session.context?.location?.projectId && (
              <button
                onClick={() => {
                  setComposeOptions(false);
                  setProjectSettings(true);
                }}
              >
                {uiText("專案設定")}
              </button>
            )}
            <div className="compose-option-field">
              <span>{uiText("Bot 模型")}</span>
              {modelPicker}
            </div>
            <ApprovalModeControl
              settings={approvalSettings}
              api={api}
              onSaved={acceptApprovalSettings}
              onReload={refresh}
            />
            <button
              className="primary"
              onClick={() => setComposeOptions(false)}
            >
              {uiText("完成")}
            </button>
          </section>
        </Modal>
      )}
      {projectSettings &&
        state?.projects.find(
          (p) => p.id === detail?.session.context?.location?.projectId,
        ) && (
          <ProjectSettings
            project={
              state.projects.find(
                (p) => p.id === detail?.session.context?.location?.projectId,
              )!
            }
            api={api}
            refresh={refresh}
            close={() => setProjectSettings(false)}
          />
        )}
      {profile && selected && detail && state && (
        <Modal label={uiText("Bot 詳情")} close={() => setProfile(false)}>
          <section className="modal cw-settings-modal">
            <header>
              <h2>
                {bot?.name} · {uiText("自訂 Bot")}
              </h2>
              <button
                className="icon"
                aria-label={uiText("關閉 Bot 設定")}
                onClick={() => setProfile(false)}
              >
                <Icon name="close" />
              </button>
            </header>
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
          </section>
        </Modal>
      )}
      {botSheet && selected && detail && (
        <Modal
          label={botSheet === "routines" ? "排程" : "記憶與背景"}
          close={() => setBotSheet(undefined)}
        >
          <section className="modal cw-settings-modal">
            <header>
              <h2>{botSheet === "routines" ? "排程" : "記憶與背景"}</h2>
              <button
                className="icon"
                aria-label={uiText("關閉 Bot 管理")}
                onClick={() => setBotSheet(undefined)}
              >
                <Icon name="close" />
              </button>
            </header>
            {botSheet === "routines" ? (
              <div className="cw-routine-list">
                {" "}
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
              </div>
            ) : (
              <div>
                {" "}
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
                    setBotSheet(undefined);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                />
              </div>
            )}
          </section>
        </Modal>
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
    </div>
  );
  return (
    <AvatarCollectionProvider
      collection={state?.avatarCollection}
      request={(requestId) =>
        api("/avatar-collection/draw", "POST", { requestId })
      }
      accept={(collection) =>
        setState((previous) =>
          previous && collection.revision >= previous.avatarCollection.revision
            ? { ...previous, avatarCollection: collection }
            : previous,
        )
      }
    >
      {content}
    </AvatarCollectionProvider>
  );
}

function ArtifactCard({
  artifact: a,
  compact = false,
  reference,
}: {
  artifact: Artifact;
  compact?: boolean;
  reference?: () => void;
}) {
  return (
    <div className="artifact-delivery">
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
      {reference && (
        <button className="text-button" onClick={reference}>
          {uiText("引用給 Bot")}
        </button>
      )}
    </div>
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
        ? JSON.stringify([detail.bot.connectionId, detail.bot.model])
        : "",
  );
  const [avatar, setAvatar] = useState(
    detail?.bot.avatar && detail.bot.avatar !== "✳"
      ? detail.bot.avatar
      : "orbit",
  );
  const [saving, setSaving] = useState(false);
  const [avatarExpanded, setAvatarExpanded] = useState(false);
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
        const [connectionId, modelName] = model
          ? (JSON.parse(model) as string[])
          : ["", ""];
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
      <div className="compose-option-field">
        <span>{t("model")}</span>
        <ModelPicker
          label={t("model")}
          value={model}
          onChange={setModel}
          disabled={saving}
          placeholder={t("selectModel")}
          options={[
            { value: "", label: t("defaultModel") },
            ...connectionModelOptions(state.connections),
          ]}
        />
      </div>
      {needsReplacement && (
        <p className="notice" role="alert">
          {t("replacement")}
        </p>
      )}
      <label>
        {t("description")}
        <textarea
          rows={3}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={uiText(
            "例如：你是我的秘書，依其他 Bot 的角色派工，收到結果後整理回覆給我。",
          )}
        />
      </label>
      <details
        className="profile-disclosure profile-avatar-disclosure"
        onToggle={(event) => setAvatarExpanded(event.currentTarget.open)}
      >
        <summary>
          <span className="avatar small">
            <BrandMark size={26} avatar={avatar} />
          </span>
          <span>
            {getSettingsLocale() === "en"
              ? "Icon and avatar collection"
              : "圖示與頭像收藏"}
          </span>
        </summary>
        {avatarExpanded && <AvatarPicker value={avatar} onChange={setAvatar} />}
      </details>
      <details className="profile-disclosure profile-advanced">
        <summary>
          {getSettingsLocale() === "en" ? "Advanced settings" : "進階設定"}
        </summary>
        <BotAccessFields
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
      </details>
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
              const [connectionId, modelName] = model
                ? (JSON.parse(model) as string[])
                : ["", ""];
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
                  "此操作無法復原。將停止這位 Bot 的工作，刪除對話、專屬記憶與技能、排程、草稿、核准規則，以及附件與成果清單。",
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
                  {deleting ? uiText("停止回覆並刪除中…") : uiText("確認刪除")}
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
  const [routineProject, setRoutineProject] = useState(old?.projectId || "");
  const [routineBranch, setRoutineBranch] = useState(old?.branch || "");
  const [projects, setProjects] = useState<Snapshot["projects"]>([]);
  useEffect(() => {
    void api<Snapshot["projects"]>("/projects")
      .then((p) => setProjects(p.filter((v) => v.id !== "workspace")))
      .catch((e) => setNotice(e.message));
  }, []);
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
                    {
                      name,
                      prompt,
                      cron,
                      timezone,
                      enabled,
                      projectId: routineProject,
                      branch: routineBranch,
                    },
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
          <ProjectControls
            projects={projects}
            projectId={routineProject}
            setProject={setRoutineProject}
            branch={routineBranch}
            setBranch={setRoutineBranch}
            api={api}
          />
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
              ["templates", t("templates")],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                aria-current={tab === id ? "true" : undefined}
                onClick={() => {
                  if (id !== tab && canLeave()) setTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {tab === "general" && (
              <>
                <ExecutionSettings api={api} onDirtyChange={setDirty} />

                {!!state.skillDiagnostics?.length && (
                  <details className="settings-advanced">
                    <summary>{uiText("技能載入問題")}</summary>
                    {state.skillDiagnostics.map((issue) => (
                      <p key={issue.path}>
                        {issue.path}：{issue.message}
                      </p>
                    ))}
                  </details>
                )}
              </>
            )}
            {tab === "templates" && (
              <TemplateSettings
                api={api}
                refresh={refresh}
                onDirtyChange={setDirty}
              />
            )}
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
          </div>
        </div>
      </section>
    </Modal>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
