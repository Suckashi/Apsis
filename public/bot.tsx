import { ConversationMessages } from "./conversation-messages.tsx";
import { ChatComposer } from "./chat-composer.tsx";
import { useChatComposer } from "./use-chat-composer.ts";
import { useChatData } from "./use-chat-data.ts";
import { Icon } from "./chat-visuals.tsx";
import { ArtifactCard } from "./artifact-cards.tsx";
import { Profile } from "./bot-profile.tsx";
import { RoutineEditor } from "./routine-editor.tsx";
import { Settings } from "./settings-panel.tsx";
import { ProjectSettings } from "./project-settings.tsx";
import { api } from "./chat-api.ts";
import { ChatRoster } from "./chat-roster.tsx";

import { ConversationChanges } from "./conversation-changes.tsx";
import { FilePanel, WorkFolder } from "./file-panel.tsx";
import { ComposerPopover } from "./composer-popover.tsx";
import { AvatarCollectionProvider } from "./avatar-collection.tsx";
import { ContextPanel } from "./context-panel.tsx";
import { ApprovalModeControl } from "./approval-mode-control.tsx";

import { currentWorkStatus } from "../shared/work-presentation.ts";
import { ModelPicker, connectionModelOptions } from "./model-picker.tsx";
import { InspectorResize, useInspectorWidth } from "./workspace-primitives.tsx";
import { uiText, uiError } from "./settings-dictionary.ts";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { BrandMark, Modal, useDrawer, useWorkspaceLayout } from "./bot-ui.tsx";

import type { Routine } from "../shared/product.ts";
import { ProgressStrip } from "./task-history.tsx";
import { ActionFeedback, ActivityMark } from "./activity-feedback.tsx";
import { taskText, taskProgress } from "./task-locale.ts";

import { useSettingsLocale, getSettingsLocale } from "./settings-locale.ts";

function App() {
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
    refresh,
    perform,
    error,
    setError,
  } = useChatData();
  const locale = useSettingsLocale();
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
  const sidebarRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const [composeOptions, setComposeOptions] = useState(false);
  const [projectSettings, setProjectSettings] = useState(false);
  const [creating, setCreating] = useState(false);

  const [filesTab, setFilesTab] = useState(true);
  const [botSheet, setBotSheet] = useState<"routines" | "context">();

  const [query, setQuery] = useState("");
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
    setDetail(undefined);

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
              setSettings={setSettings}
              expandedRuns={expandedRuns}
              toggleRun={toggleRun}
              availableBots={availableBots}
              select={select}
              hasDefaultModel={!!state?.defaultModel}
            />
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
              <ChatComposer
                composer={composer}
                detail={detail}
                selected={selected}
                botName={bot?.name || "Bot"}
                running={running}
                smallScreen={smallScreen}
                status={
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
                }
                repairModel={repairModel}
                hasModelOptions={!!modelOptions.length}
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

createRoot(document.getElementById("root")!).render(<App />);
