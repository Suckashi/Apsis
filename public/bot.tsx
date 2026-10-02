import { AssistantPresence } from "./assistant-presence.tsx";
import { ConversationMessages } from "./conversation-messages.tsx";
import { ChatComposer } from "./chat-composer.tsx";
import { useChatComposer } from "./use-chat-composer.ts";
import { useChatData } from "./use-chat-data.ts";
import { Icon } from "./chat-visuals.tsx";
import { ArtifactDeliveries } from "./artifact-cards.tsx";
import { ArtifactPreview } from "./artifact-preview.tsx";
import type { RunFile } from "../shared/run-files.ts";
import { Profile } from "./bot-profile.tsx";
import { RoutineEditor } from "./routine-editor.tsx";
import { Settings } from "./settings-panel.tsx";
import { ProjectSettings } from "./project-settings.tsx";
import { api } from "./chat-api.ts";
import { BackgroundWork } from "./background-work.tsx";

import { ConversationChanges } from "./conversation-changes.tsx";
import { FilePanel, WorkFolder } from "./file-panel.tsx";
import { ComposerPopover } from "./composer-popover.tsx";
import { ContextPanel } from "./context-panel.tsx";
import { ApprovalModeControl } from "./approval-mode-control.tsx";

import { currentWorkStatus } from "../shared/work-presentation.ts";
import { ModelPicker, connectionModelOptions } from "./model-picker.tsx";
import { InspectorResize, useInspectorWidth } from "./workspace-primitives.tsx";
import { uiText, uiError } from "./settings-dictionary.ts";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mountWithStyles } from "./startup.ts";

import {
  BrandMark,
  Modal,
  useDrawer,
  useMedia,
  useWorkspaceLayout,
} from "./bot-ui.tsx";

import type { Routine, Artifact } from "../shared/product.ts";
import { ActionFeedback, ActivityMark } from "./activity-feedback.tsx";
import { taskText, taskProgress } from "./task-locale.ts";

import { useSettingsLocale, getSettingsLocale } from "./settings-locale.ts";

const contextApi = <T,>(path: string, body?: unknown) =>
  api<T>(path, body === undefined ? "GET" : "POST", body);

function App() {
  const desktopDeliveries = useMedia("(min-width: 769px)");
  const {
    state,
    setState,
    detail,
    setDetail,
    selected,
    setSelected,
    selectedRef,
    approvalSettings,
    acceptApprovalSettings,
    eventsConnected,
    connectionLost,
    networkOffline,
    syncError,
    retrying,
    retry,
    refresh,
    pauseRefresh,
    perform,
    error,
    setError,
  } = useChatData();
  const locale = useSettingsLocale();
  const hasLoadedState = useRef(false);
  if (state) hasLoadedState.current = true;
  const feedbackText = (text: string) => taskText(locale, text);

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
  const sidebarRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const deliveriesRef = useRef<HTMLDetailsElement>(null);
  const [composeOptions, setComposeOptions] = useState(false);
  const [projectSettings, setProjectSettings] = useState(false);
  const [creating, setCreating] = useState(false);

  const [filesTab, setFilesTab] = useState(true);
  const [fileRequest, setFileRequest] = useState<
    RunFile & { botId: string; id: string }
  >();
  const [artifactRequest, setArtifactRequest] = useState<Artifact>();
  const [artifactFocusRequest, setArtifactFocusRequest] = useState(0);
  useLayoutEffect(() => {
    if (!artifactFocusRequest) return;
    // The collection's selected row becomes hidden; continue at the visible preview.
    detailsRef.current
      ?.querySelector<HTMLButtonElement>(
        ".artifact-preview .file-preview-header button",
      )
      ?.focus();
  }, [artifactFocusRequest]);
  useEffect(() => {
    setFileRequest(undefined);
    setArtifactRequest(undefined);
  }, [selected, detail?.session.context?.id]);
  const requestedFile =
    fileRequest?.botId === selected ? fileRequest : undefined;
  const requestedArtifact =
    artifactRequest?.botId === selected ? artifactRequest : undefined;
  const previewArtifact = (artifact: Artifact) => {
    if (deliveriesRef.current?.open) {
      deliveriesRef.current.open = false;
      setArtifactFocusRequest((request) => request + 1);
    }
    setArtifactRequest(artifact);
    setFileRequest(undefined);
    setFilesTab(true);
    setPanel(true);
  };
  const fileContext =
    detail?.session.context && requestedFile
      ? {
          ...detail.session.context,
          id: requestedFile.workContextId,
          location: requestedFile.location,
        }
      : detail?.session.context;
  const [botSheet, setBotSheet] = useState<
    "routines" | "context" | "history"
  >();
  const [historyQuery, setHistoryQuery] = useState("");
  const openHistory = (term = "") => {
    setHistoryQuery(term);
    setBotSheet("history");
  };
  const [startingTopic, setStartingTopic] = useState(false);
  const topicRequest = useRef(false);

  const [query, setQuery] = useState("");
  const rosterSearch = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState(false);
  const [profile, setProfile] = useState(false);
  const [hidden, setHidden] = useState(false);

  const [stoppingBot, setStoppingBot] = useState<string>();
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const [routine, setRoutine] = useState<Routine | "new">();
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  const listDrawer = smallScreen && mobileList;
  const detailsVisible = panel && !!selected && !!detail;
  const detailsDrawer = overlayDetails && detailsVisible && !listDrawer;
  useDrawer(sidebarRef, listDrawer, () => setMobileList(false));
  useDrawer(detailsRef, detailsDrawer, () => setPanel(false));
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedBottom = useRef(true);

  const [inspectorWidth, setInspectorWidth] = useInspectorWidth(
    "apsis.inspector-width",
  );

  const composer = useChatComposer({
    state,
    detail,
    selected,
    selectedRef,
    refresh,
    perform,
    setError,
    contextChanging: startingTopic,
    networkOffline,
    onSent: () => {
      pinnedBottom.current = true;
    },
  });
  const {
    text,
    setText,
    setFileReferences,
    busy,
    actionFeedback,
    setAttachments,
    setRetryOf,
    setReplyTo,
    setQuotedPreview,
    input,
    pendingRequest,
    referenceArtifact,
  } = composer;
  useEffect(() => {
    // Bootstrap owns the first snapshot. Later Bot selections need their own read.
    const refreshAfterRead = hasLoadedState.current;
    setDetail(undefined);

    setProfile(false);
    setBotSheet(undefined);
    setComposeOptions(false);
    setProjectSettings(false);
    setAwayFromBottom(false);
    pinnedBottom.current = true;
    if (selected) {
      localStorage.setItem("apsis.bot", selected);
      if (refreshAfterRead) void refresh().catch(() => {});
    }
  }, [selected, refresh]);

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
  const latestReply = detail?.session.messages.at(-1);
  const readsInFlight = useRef(new Set<string>());
  const canReadConversation =
    !awayFromBottom &&
    !settings &&
    !creating &&
    !profile &&
    !botSheet &&
    !routine &&
    !composeOptions &&
    !projectSettings &&
    !listDrawer &&
    !detailsDrawer;
  useEffect(() => {
    if (
      !selected ||
      detail?.bot.id !== selected ||
      !canReadConversation ||
      latestReply?.role !== "assistant" ||
      !latestReply.createdAt ||
      latestReply.createdAt <= detail.bot.readAt
    )
      return;
    const key = `${selected}/${latestReply.id}`;
    const acknowledge = () => {
      if (
        document.visibilityState !== "visible" ||
        document.querySelector('dialog[open][aria-modal="true"]') ||
        !pinnedBottom.current ||
        readsInFlight.current.has(key)
      )
        return;
      readsInFlight.current.add(key);
      void api(`/bots/${selected}`, "PATCH", { readMessageId: latestReply.id })
        .then(() => refresh())
        .catch(() => {})
        .finally(() => readsInFlight.current.delete(key));
    };
    acknowledge();
    document.addEventListener("visibilitychange", acknowledge);
    const dialogs = new MutationObserver(acknowledge);
    dialogs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => {
      document.removeEventListener("visibilitychange", acknowledge);
      dialogs.disconnect();
    };
  }, [
    selected,
    detail?.bot.id,
    detail?.bot.readAt,
    latestReply?.id,
    latestReply?.createdAt,
    latestReply?.role,
    canReadConversation,
    refresh,
  ]);
  const select = (id: string) => {
    if (selected) sessionStorage.setItem(`apsis.bot-draft.${selected}`, text);
    setSelected(id);
    setMobileList(false);
  };
  const newBot = () => {
    setMobileList(false);
    setCreating(true);
  };

  const bots =
    state?.bots
      .filter(
        (b) =>
          b.hidden === hidden &&
          (b.name + b.lastMessage)
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
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
    detail?.jobs.filter(
      (j) => j.sessionId === detail.bot.sessionId && j.status === "queued",
    ).length || 0;
  const cannotStartTopic =
    networkOffline ||
    !detail ||
    busy ||
    running ||
    queuedCount > 0 ||
    pending.length > 0 ||
    startingTopic;
  const startTopic = async () => {
    if (!selected || cannotStartTopic || topicRequest.current) return;
    const botId = selected;
    topicRequest.current = true;
    setStartingTopic(true);
    setMobileList(false);
    try {
      await perform(async () => {
        await api(`/bots/${botId}/contexts`, "POST", {});
        if (selectedRef.current !== botId) {
          await refresh();
          return;
        }
        setAttachments([]);
        setFileReferences([]);
        setReplyTo(undefined);
        setQuotedPreview(undefined);
        setRetryOf(undefined);
        pendingRequest.current = undefined;
        pinnedBottom.current = true;
        await refresh();
        input.current?.focus();
      });
    } finally {
      topicRequest.current = false;
      setStartingTopic(false);
    }
  };
  const approvalControl = (
    <ApprovalModeControl
      settings={approvalSettings}
      api={api}
      onSaved={acceptApprovalSettings}
      onReload={refresh}
    />
  );
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

  const content = (
    <div
      style={
        { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties
      }
      className={`app ${detailsVisible ? "details-open" : ""} ${mobileList ? "list-open" : ""} ${!listVisible ? "list-collapsed" : ""} ${focusMode ? "focus-mode" : ""}`}
    >
      {!listDrawer && !detailsDrawer && (
        <a className="skip-link" href="#conversation">
          {uiText("跳至對話")}
        </a>
      )}
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
      <div
        id="bot-roster"
        ref={sidebarRef}
        className="sidebar"
        role={listDrawer ? "dialog" : "complementary"}
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
          </span>
        </div>
        <p className="assistant-intro">
          {uiText("一位助理，一段持續的對話。")}
        </p>
        {detail && (
          <BackgroundWork
            detail={detail}
            refresh={refresh}
            connected={eventsConnected && !connectionLost && !networkOffline}
          />
        )}
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
      </div>
      <main
        id="conversation"
        aria-label={uiText("目前對話")}
        tabIndex={-1}
        className="conversation conversation-shell"
        inert={listDrawer || detailsDrawer}
      >
        {detail && (
          <AssistantPresence
            avatar={detail.bot.avatar}
            status={detail.session.running ? "running" : "idle"}
            progress={detail.currentProgress}
            connected={eventsConnected && !connectionLost && !networkOffline}
          />
        )}
        {selected && state && (
          <h1 className="visually-hidden">
            {uiText("與 {0} 的對話", [bot?.name || "Bot"])}
          </h1>
        )}
        {!eventsConnected &&
          (state || networkOffline) &&
          (!syncError || networkOffline) && (
            <div className="connection-banner" role="status">
              <ActivityMark
                state={connectionLost ? "disconnected" : "waiting"}
              />
              <span>
                {feedbackText(
                  networkOffline
                    ? "目前離線。恢復網路後會自動同步。"
                    : connectionLost
                      ? "即時連線中斷，正在重新連線。恢復後會自動同步。"
                      : "正在連接即時更新…",
                )}
              </span>
            </div>
          )}
        {syncError && !networkOffline && (
          <div className="sync-banner" role="alert">
            <div>
              <ActivityMark state={retrying ? "waiting" : "disconnected"} />
              <span>
                {uiText(
                  state
                    ? "無法更新對話。已載入的內容與草稿仍保留。"
                    : "無法載入對話。",
                )}
              </span>
            </div>
            <button
              disabled={retrying}
              onClick={() =>
                void retry().then(() => {
                  requestAnimationFrame(() => {
                    if (document.activeElement === document.body)
                      input.current?.focus();
                  });
                })
              }
            >
              {uiText(retrying ? "正在同步…" : "重新同步")}
            </button>
            <details>
              <summary>{uiText("錯誤詳情")}</summary>
              <code>{uiError(syncError)}</code>
            </details>
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
        {!state ? (
          <section
            className="workspace-loading"
            aria-labelledby="workspace-loading-title"
          >
            <BrandMark size={48} />
            <h1 id="workspace-loading-title">
              {uiText(syncError ? "等待恢復連線" : "正在準備你的對話")}
            </h1>
            <p>
              {uiText(
                syncError
                  ? "重新同步後，會載入你的 Bot 與對話。"
                  : "載入 Bot 與最近的對話。",
              )}
            </p>
          </section>
        ) : !selected ? (
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
              <Icon name="chevron-right" size={16} />
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
                disabled={!detail}
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
                  <small
                    data-phase={workStatus.phase}
                    data-state={
                      workStatus.availability === "unavailable" &&
                      !detail?.session.messages.length
                        ? "setup"
                        : workStatus.availability
                    }
                  >
                    {!detail
                      ? uiText("載入對話…")
                      : workStatus.phase === "unavailable"
                        ? !detail.session.messages.length
                          ? uiText("選好模型後即可開始")
                          : uiError(workStatus.label)
                        : taskProgress(locale, workStatus.label)}
                  </small>
                </span>
              </button>
              {detail?.session.context && (
                <div className="header-workspace">
                  <WorkFolder
                    botId={selected}
                    context={detail.session.context}
                    api={api}
                    refresh={refresh}
                  />
                </div>
              )}
              <div className="header-actions">
                {awayFromBottom && (
                  <button
                    className="jump-latest"
                    aria-label={feedbackText("回到最新訊息")}
                    title={feedbackText("回到最新訊息")}
                    onClick={() => {
                      pinnedBottom.current = true;
                      setAwayFromBottom(false);
                      bottom.current?.scrollIntoView({ behavior: "instant" });
                    }}
                  >
                    <span className="jump-label">
                      {feedbackText("回到最新訊息")}
                    </span>
                    <Icon name="chevron-down" />
                  </button>
                )}
                <ComposerPopover
                  label={
                    <span aria-label={uiText("Bot 選單")}>
                      <Icon name="more" />
                    </span>
                  }
                  className="bot-actions-menu"
                  closeOnSelect
                >
                  <button onClick={() => openHistory()}>
                    <Icon name="clock" size={16} />
                    {uiText("瀏覽先前話題")}
                  </button>
                  <button onClick={() => setBotSheet("routines")}>
                    <Icon name="calendar" size={16} />
                    {uiText("排程")}
                  </button>
                  <button onClick={() => setBotSheet("context")}>
                    <Icon name="memory" size={16} />
                    {uiText("記憶與背景")}
                  </button>
                  {!smallScreen &&
                    detail?.session.context?.location?.projectId && (
                      <button onClick={() => setProjectSettings(true)}>
                        <Icon name="folder" size={16} />
                        {uiText("專案設定")}
                      </button>
                    )}
                  <button onClick={() => setProfile(true)}>
                    <Icon name="settings" size={16} />
                    {uiText("Bot 設定")}
                  </button>
                  <button
                    className="menu-focus-mode"
                    aria-pressed={focusMode}
                    onClick={toggleFocus}
                  >
                    <Icon name="focus" size={16} />
                    {focusMode
                      ? uiText("離開專注模式")
                      : uiText("進入專注模式")}
                  </button>
                </ComposerPopover>
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
            <ConversationMessages
              data={{
                detail,
                selected,
                selectedRef,
                setDetail,
                perform,
                refresh,
              }}
              composer={composer}
              scroller={scroller}
              pinnedBottom={pinnedBottom}
              setAwayFromBottom={setAwayFromBottom}
              bottom={bottom}
              expandedRuns={expandedRuns}
              toggleRun={toggleRun}
              availableBots={availableBots}
              select={select}
              previewFile={(file) => {
                if (!selected) return;
                setArtifactRequest(undefined);
                setFileRequest({
                  ...file,
                  botId: selected,
                  id: crypto.randomUUID(),
                });
                setFilesTab(true);
                setPanel(true);
              }}
              previewArtifact={previewArtifact}
            />
            <div className="composer-wrap">
              {startingTopic && (
                <ActionFeedback
                  label={feedbackText("正在開啟新話題…")}
                  pending
                />
              )}
              {actionFeedback?.botId === selected &&
                (actionFeedback.pending || !activeSummary) && (
                  <ActionFeedback
                    label={actionFeedback.label}
                    pending={actionFeedback.pending}
                  />
                )}
              <ChatComposer
                composer={composer}
                detail={detail}
                selected={selected}
                botName={bot?.name || "Bot"}
                running={running}
                smallScreen={smallScreen}
                stopping={stoppingBot === selected}
                stop={() => void stop()}
                repairModel={repairModel}
                hasModelOptions={!!modelOptions.length}
                modelPicker={modelPicker}
                approvalControl={approvalControl}
                openOptions={() => setComposeOptions(true)}
              />
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
        <div
          id="bot-details"
          ref={detailsRef}
          className="details"
          role={detailsDrawer ? "dialog" : "complementary"}
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
          {filesTab && fileContext ? (
            <>
              {requestedArtifact ? (
                <ArtifactPreview
                  key={requestedArtifact.id}
                  artifact={requestedArtifact}
                  back={() => setArtifactRequest(undefined)}
                  reference={() => referenceArtifact(requestedArtifact)}
                />
              ) : (
                <>
                  {fileContext.id !== detail.session.context?.id && (
                    <div className="file-history-notice">
                      <span>{uiText("先前話題的檔案")}</span>
                      <button onClick={() => setFileRequest(undefined)}>
                        {uiText("回到目前話題")}
                      </button>
                    </div>
                  )}
                  <FilePanel
                    key={`${selected}:${fileContext.id}:${fileContext.location?.id}:${requestedFile?.id || "browse"}`}
                    context={fileContext}
                    initialPath={requestedFile?.path}
                    storageKey={`apsis.bot-file.${selected}.${fileContext.id}`}
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
                            r.path !== ref.path ||
                            r.locationId !== ref.locationId,
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
                </>
              )}
              {detail.artifacts.length > 0 && (
                <details className="cw-deliveries" ref={deliveriesRef}>
                  <summary>
                    {uiText("附件與成果")} · {detail.artifacts.length}
                  </summary>
                  <ArtifactDeliveries
                    artifacts={detail.artifacts.slice().reverse()}
                    contextId={desktopDeliveries ? fileContext.id : undefined}
                    compact
                    preview={previewArtifact}
                  />
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
        </div>
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
            project={state.projects.find(
              (p) => p.id === detail?.session.context?.location?.projectId,
            )!}
            api={api}
            refresh={refresh}
            close={() => setProjectSettings(false)}
          />
        )}
      {profile && selected && detail && state && (
        <Modal label={uiText("Bot 詳情")} close={() => setProfile(false)}>
          <section className="modal cw-settings-modal bot-profile-modal">
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
              close={() => setProfile(false)}
              save={async (body) => {
                await api(`/bots/${selected}`, "PATCH", body);
                await refresh();
              }}
              remove={async () => {
                // Removal emits changes before its HTTP response can arrive.
                // Keep those changes from reading the soon-to-be-removed Bot.
                const resume = pauseRefresh();
                try {
                  await api(`/bots/${selected}`, "DELETE");
                  selectedRef.current = null;
                  setSelected(null);
                  setDetail(undefined);
                  setPanel(false);
                  setProfile(false);
                  setError("");
                  localStorage.removeItem("apsis.bot");
                } finally {
                  resume();
                  await refresh().catch(() => {});
                }
              }}
            />
          </section>
        </Modal>
      )}
      {botSheet && selected && detail && (
        <Modal
          label={uiText(
            botSheet === "routines"
              ? "排程"
              : botSheet === "history"
                ? "瀏覽先前話題"
                : "記憶與背景",
          )}
          close={() => setBotSheet(undefined)}
        >
          <section
            className={`modal cw-settings-modal ${botSheet === "history" ? "history-modal" : botSheet === "context" ? "memory-modal" : ""}`}
          >
            <header>
              <h2>
                {uiText(
                  botSheet === "routines"
                    ? "排程"
                    : botSheet === "history"
                      ? "瀏覽先前話題"
                      : "記憶與背景",
                )}
              </h2>
              <button
                className="icon"
                aria-label={uiText(
                  botSheet === "history" ? "關閉歷史訊息" : "關閉 Bot 管理",
                )}
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
                                { timeZone: r.timezone },
                              ),
                            ])
                          : r.blockedReason
                            ? uiError(r.blockedReason)
                            : uiText("已暫停")}
                        {" · "}
                        {r.timezone}
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
              <div
                className={
                  botSheet === "history"
                    ? "history-modal-body"
                    : "memory-modal-body"
                }
              >
                {" "}
                <ContextPanel
                  key={`${detail.bot.id}:${botSheet}`}
                  view={botSheet === "history" ? "history" : "memory"}
                  initialQuery={botSheet === "history" ? historyQuery : ""}
                  botId={detail.bot.id}
                  botName={detail.bot.name}
                  memories={detail.memories}
                  updateKey={
                    detail.session.context?.usage?.updatedAt ||
                    detail.session.context?.id
                  }
                  api={contextApi}
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
          <section className="modal bot-create-modal bot-profile-modal">
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
              close={() => setCreating(false)}
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
          fallbackFocus={input}
        />
      )}
      {routine && selected && (
        <RoutineEditor
          routine={
            routine === "new"
              ? "new"
              : detail?.routines.find((current) => current.id === routine.id) ||
                routine
          }
          jobs={detail?.jobs || []}
          botId={selected}
          close={() => setRoutine(undefined)}
          save={(fn) => perform(fn)}
        />
      )}
    </div>
  );
  return content;
}

mountWithStyles(() =>
  createRoot(document.getElementById("root")!).render(<App />),
);
