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
    throw Object.assign(new Error(data.error || "操作失敗"), {
      status: response.status,
    });
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
const time = (at: string) =>
  new Date(at).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
            button.textContent = "已複製";
          } catch {
            button.textContent = "複製失敗";
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

function App() {
  const [state, setState] = useState<Snapshot>();
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
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(false);
  const [profile, setProfile] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Artifact[]>([]);
  const [replyTo, setReplyTo] = useState<string>();
  const [routine, setRoutine] = useState<Routine | "new">();
  const [expanded, setExpanded] = useState(false);
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
    const next = await api<Snapshot>("/state");
    const nextDetail =
      id && next.bots.some((bot) => bot.id === id)
        ? await api<Detail>(`/bots/${id}`).catch((error) => {
            if (error.status === 404) return undefined;
            throw error;
          })
        : undefined;
    if (version !== generation.current || id !== selectedRef.current) return;
    setState(next);
    setDetail(nextDetail);
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
    void refresh().catch((e) => setError(e.message));
    const events = new EventSource("/api/v2/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.onmessage = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh().catch((e) => setError(e.message));
      }, 160);
    };
    return () => {
      events.close();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    setDetail(undefined);
    setText("");
    setAttachments([]);
    setReplyTo(undefined);
    setProfile(false);
    pinnedBottom.current = true;
    if (selected) {
      localStorage.setItem("apsis.bot", selected);
      void api(`/bots/${selected}`, "PATCH", { read: true })
        .then(refresh)
        .catch((e) => setError(e.message));
    }
  }, [selected, refresh]);
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
    if (!selected || busy || (!text.trim() && !attachments.length)) return;
    const prompt = [
      text.trim(),
      ...attachments.map((a) => `附件：${a.name}，工作區路徑：${a.path}`),
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
    setBusy(true);
    try {
      await api(`/bots/${selected}/${steer ? "steer" : "messages"}`, "POST", {
        prompt,
        requestId: pendingRequest.current.id,
        replyTo,
      });
      pendingRequest.current = undefined;
      setText("");
      setAttachments([]);
      setReplyTo(undefined);
      pinnedBottom.current = true;
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    if (!files || !selected) return;
    setBusy(true);
    try {
      for (const file of files) {
        if (file.size > 20 * 1024 * 1024) throw new Error("附件上限為 20 MB。");
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
        setAttachments((old) => [...old, artifact]);
      }
      await refresh();
    } catch (e) {
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
  const suggestions = text.startsWith("/")
    ? state?.skills
        .filter((s) => s.name.includes(text.slice(1)))
        .map((s) => ({
          id: s.id,
          name: s.name,
          value: `請依照技能「${s.name}」（ID：${s.id}）執行：`,
        }))
    : text.startsWith("@")
      ? state?.connectors
          .filter((c) =>
            c.name.toLowerCase().includes(text.slice(1).toLowerCase()),
          )
          .map((c) => ({
            id: c.id,
            name: c.name,
            value: `請使用連接器「${c.name}」（ID：${c.id}）：`,
          }))
      : [];
  return (
    <div
      className={`app ${panel ? "details-open" : ""} ${mobileList ? "list-open" : ""} ${!listVisible ? "list-collapsed" : ""} ${focusMode ? "focus-mode" : ""}`}
    >
      <a className="skip-link" href="#conversation">
        跳至對話
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
        aria-label="Bot 導覽"
        inert={detailsDrawer || !listVisible}
      >
        <div className="brand">
          <span className="brand-mark">
            <BrandMark size={30} />
          </span>
          <strong>Apsis</strong>
          <span className="local-badge">LOCAL</span>
          <button
            className="icon roster-close"
            aria-label="關閉名單"
            title="收起 Bot 名單"
            onClick={closeList}
          >
            <Icon name="close" />
          </button>
        </div>
        <button className="new-bot" onClick={newBot} disabled={creating}>
          <Icon name="plus" />
          {creating ? "建立中…" : "新增 Bot"}
        </button>
        <label className="search">
          <Icon name="search" size={16} />
          <input
            aria-label="搜尋 Bot"
            placeholder="搜尋"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="roster-heading">
          <span>{hidden ? "已隱藏" : "你的 Bots"}</span>
          <button onClick={() => setHidden(!hidden)}>
            {hidden ? "返回" : "查看隱藏"}
          </button>
        </div>
        <nav className="roster" aria-label="Bot 名單">
          {bots.map((b) => (
            <button
              key={b.id}
              aria-current={selected === b.id ? "page" : undefined}
              title={b.name}
              className={`bot-row ${selected === b.id ? "selected" : ""}`}
              onClick={() => select(b.id)}
            >
              <span className={`avatar tone-${b.id.charCodeAt(0) % 4}`}>
                <BrandMark size={23} avatar={b.avatar} />
                <i className={b.status} />
              </span>
              <span className="bot-summary">
                <span className="bot-line">
                  <strong>{b.name}</strong>
                  <time>{time(b.updatedAt)}</time>
                </span>
                <span className="preview">
                  {b.status === "waiting"
                    ? "等待你的核准"
                    : b.status === "working"
                      ? "正在處理任務…"
                      : b.lastMessage.replace(/[#*`]/g, "").slice(0, 55)}
                </span>
              </span>
              {b.unread && <span className="unread" />}
              {b.pinned && <span className="pin">⌁</span>}
            </button>
          ))}
          {!bots.length && (
            <p className="roster-empty">
              {query
                ? "找不到符合的 Bot"
                : hidden
                  ? "沒有隱藏的 Bot"
                  : "為你的工作新增一位幫手。"}
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
              <span>設定與工具</span>
            </button>
            <button
              className="icon theme-toggle"
              aria-label={
                theme === "light" ? "切換為深色模式" : "切換為淺色模式"
              }
              title={theme === "light" ? "深色模式" : "淺色模式"}
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
        {!selected && (
          <div className="workspace-topbar">
            <button
              id="roster-toggle"
              className="icon"
              aria-label={listVisible ? "收起 Bot 名單" : "開啟 Bot 名單"}
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
              aria-label="關閉錯誤"
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
            <h1>把事情交給你的 Bot。</h1>
            <p>
              一段持續的對話。能動手工作的幫手。
              <br />
              從研究、整理文件，到完成程式開發。
            </p>
            <button className="primary" onClick={newBot} disabled={creating}>
              <Icon name="plus" />
              建立第一個 Bot
            </button>
            <div className="welcome-ideas">
              {[
                ["search", "研究與整理", "比較資料，整理有來源的結論"],
                ["file", "文件與日常工作", "讀取文件，製作可下載的成果"],
                ["monitor", "開發與操作", "使用瀏覽器、檔案和本機工具"],
              ].map(([icon, title, desc]) => (
                <div key={title}>
                  <Icon name={icon} />
                  <strong>{title}</strong>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => setSettings(true)}>
              連接你的 LLM API <span>↗</span>
            </button>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <button
                id="roster-toggle"
                className="icon"
                aria-label={listVisible ? "收起 Bot 名單" : "開啟 Bot 名單"}
                title={listVisible ? "收起 Bot 名單" : "開啟 Bot 名單"}
                aria-expanded={listVisible}
                aria-controls="bot-roster"
                onClick={toggleList}
              >
                <Icon name="menu" />
              </button>
              <button
                className="header-profile"
                title="自訂 Bot：名稱、圖示、角色與模型"
                onClick={() => {
                  setPanel(true);
                  setProfile(true);
                }}
              >
                <span className="avatar small">
                  <BrandMark size={23} avatar={bot?.avatar} />
                </span>
                <span>
                  <strong>{bot?.name || "載入中"}</strong>
                  <small>
                    {bot?.status === "waiting"
                      ? "等待核准"
                      : running
                        ? "正在工作"
                        : "隨時可以交辦任務"}
                  </small>
                </span>
              </button>
              <div className="header-actions">
                <span className="model-label">
                  {bot?.model || state?.defaultModel?.model || "尚未連接模型"}
                </span>
                <button
                  className={`icon focus-toggle ${focusMode ? "active" : ""}`}
                  aria-label={focusMode ? "離開專注模式" : "進入專注模式"}
                  title={focusMode ? "離開專注模式" : "專注模式"}
                  aria-pressed={focusMode}
                  onClick={toggleFocus}
                >
                  <Icon name="focus" />
                </button>
                <button
                  className={`icon ${panel ? "active" : ""}`}
                  aria-label="切換詳情面板"
                  title="Bot 詳情"
                  aria-expanded={panel}
                  aria-controls="bot-details"
                  onClick={() => setPanel(!panel)}
                >
                  <Icon name="panel" />
                </button>
              </div>
            </header>
            <div
              className="messages"
              ref={scroller}
              onScroll={() => {
                const el = scroller.current!;
                pinnedBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              {!detail ? (
                <div className="loading">載入對話…</div>
              ) : (
                <div className="message-column">
                  {!detail.session.messages.length && (
                    <div className="bot-intro">
                      <span className="avatar large">
                        <BrandMark size={32} avatar={bot?.avatar} />
                      </span>
                      <h2>你好，我是 {bot?.name}。</h2>
                      <p>告訴我你想完成什麼，我會在這裡接著做。</p>
                      <div className="starter-prompts">
                        {[
                          "幫我研究一個主題，整理來源與結論",
                          "讀取我的文件，整理成一份報告",
                          "協助我完成一個程式開發任務",
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
                          先連接一個模型，即可開始對話 <span>→</span>
                        </button>
                      )}
                    </div>
                  )}
                  {detail.session.messages.map((m) => (
                    <article
                      id={`message-${m.id}`}
                      key={m.id}
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
                              回覆：
                              {detail.session.messages
                                .find(
                                  (original) =>
                                    original.id ===
                                    detail.jobs.find((j) => j.runId === m.runId)
                                      ?.replyTo,
                                )
                                ?.content.slice(0, 100)}
                            </a>
                          )}
                        <Markdown text={m.content} />
                      </div>
                      <div className="message-actions">
                        {m.status === "error" && <span>執行失敗</span>}
                        <button
                          onClick={() => {
                            setReplyTo(m.id);
                            input.current?.focus();
                          }}
                        >
                          回覆
                        </button>
                        <CopyButton text={m.content} />
                      </div>
                    </article>
                  ))}
                  {running && (
                    <article className="message assistant live">
                      <div className="working-label">
                        <span className="pulse" />
                        {pending.length ? "等待核准後繼續" : "正在處理"}
                      </div>
                      {detail.session.live?.text && (
                        <Markdown text={detail.session.live.text} />
                      )}
                      <details className="activity">
                        <summary>
                          {detail.session.live?.activity.at(-1) || "準備工作中"}
                        </summary>
                        {detail.session.live?.activity.map((a, i) => (
                          <div key={i}>{a}</div>
                        ))}
                      </details>
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
                  {!!detail.delegations?.length && (
                    <section className="delegation-list" aria-label="Bot 協作">
                      <h3>Bot 協作</h3>
                      {detail.delegations.map((job) => {
                        const outgoing = job.delegatedBy === selected;
                        const peerId = outgoing ? job.botId : job.delegatedBy!;
                        const label = job.waitingApproval
                          ? "等待你的核准"
                          : {
                              queued: "排隊中",
                              running: "執行中",
                              completed: "已完成",
                              failed: "失敗",
                              cancelled: "已取消",
                              interrupted: "已中斷",
                            }[job.status];
                        return (
                          <article className="delegation-card" key={job.id}>
                            <div>
                              <strong>
                                {outgoing
                                  ? `交給 ${job.targetName}`
                                  : `來自 ${job.delegatedByName}`}
                              </strong>
                              <span>{label}</span>
                            </div>
                            {job.prompt.length > 100 ? (
                              <details className="delegation-prompt">
                                <summary>{job.prompt.slice(0, 100)}…</summary>
                                <p>{job.prompt}</p>
                              </details>
                            ) : (
                              <p>{job.prompt}</p>
                            )}
                            {(job.result || job.error) && (
                              <details>
                                <summary>
                                  查看{job.error ? "錯誤" : "結果"}
                                </summary>
                                <p>{job.error || job.result}</p>
                              </details>
                            )}
                            <button
                              type="button"
                              disabled={
                                !state?.bots.some((b) => b.id === peerId)
                              }
                              onClick={() => select(peerId)}
                            >
                              {job.waitingApproval && outgoing
                                ? "前往核准"
                                : "開啟 Bot 對話"}
                              <Icon name="arrow" size={14} />
                            </button>
                          </article>
                        );
                      })}
                    </section>
                  )}
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
                        <span>下一個任務：{j.prompt}</span>
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
                              setText(j.prompt);
                              input.current?.focus();
                            }}
                          >
                            重新交辦
                          </button>
                          <button
                            aria-label="關閉這則任務提示"
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
                            關閉
                          </button>
                        </div>
                      </div>
                    ))}
                  <div ref={bottom} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <div className="composer">
                {replyTo && (
                  <div className="reply-chip">
                    回覆：
                    {detail?.session.messages
                      .find((m) => m.id === replyTo)
                      ?.content.slice(0, 90)}
                    <button
                      className="icon"
                      aria-label="取消回覆"
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
                          aria-label={`移除 ${a.name}`}
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
                  <div className="suggestions">
                    {suggestions.map((s) => (
                      <button key={s.id} onClick={() => setText(s.value)}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={input}
                  disabled={busy}
                  aria-label="傳送訊息"
                  placeholder={
                    busy ? "傳送中…" : `傳訊息給 ${bot?.name || "Bot"}…`
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-actions">
                  <div>
                    <button
                      className="icon"
                      aria-label="新增附件"
                      title="新增附件"
                      disabled={busy}
                      onClick={() => upload.current?.click()}
                    >
                      <Icon name="attach" />
                    </button>
                    <button
                      className="slash-button"
                      aria-label="選擇技能"
                      title="選擇技能 /"
                      onClick={() => {
                        setText("/");
                        input.current?.focus();
                      }}
                    >
                      /
                    </button>
                    <button
                      className="slash-button"
                      aria-label="選擇連接器"
                      title="選擇連接器 @"
                      onClick={() => {
                        setText("@");
                        input.current?.focus();
                      }}
                    >
                      @
                    </button>
                  </div>
                  <div>
                    {running && (
                      <>
                        <button
                          className="steer"
                          disabled={!text.trim() || busy}
                          onClick={() => void send(true)}
                        >
                          補充指示
                        </button>
                        <button
                          className="icon"
                          aria-label="停止任務"
                          title="停止任務"
                          onClick={() =>
                            perform(() =>
                              api(`/bots/${selected}/stop`, "POST", {}),
                            )
                          }
                        >
                          <Icon name="stop" />
                        </button>
                      </>
                    )}
                    <button
                      className={`send ${running ? "queue-send" : ""}`}
                      aria-label={running ? "排入下一個任務" : "傳送"}
                      title={running ? "排入下一個任務" : "傳送"}
                      disabled={busy || (!text.trim() && !attachments.length)}
                      onClick={() => void send()}
                    >
                      {running && <span>排入下一個</span>}
                      <Icon name="send" size={18} />
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
              <p className="composer-note">
                {running
                  ? "可以補充指示，或將新訊息排入下一個任務。"
                  : "Enter 傳送 · Shift + Enter 換行"}
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
          aria-label="Bot 詳情"
          inert={listDrawer}
        >
          <div className="details-header">
            <button
              className="icon"
              aria-label={profile ? "返回詳情" : "關閉詳情"}
              onClick={() => (profile ? setProfile(false) : setPanel(false))}
            >
              <Icon name={profile ? "back" : "close"} size={18} />
            </button>
            <strong>{profile ? "Bot 個人檔案" : "詳情"}</strong>
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
                  <small>自訂 Bot</small>
                </span>
                <Icon name="arrow" size={16} />
              </button>
              <DetailSection
                title="檔案與成果"
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
                  <p className="muted">附件與成果會顯示在這裡。</p>
                )}
              </DetailSection>
              <DetailSection
                title="電腦"
                icon={<Icon name="monitor" size={16} />}
                status={
                  detail.computerOwner
                    ? "使用者控制中"
                    : detail.browserUrl
                      ? "已連線"
                      : "待命"
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
                      alt="Bot 瀏覽器畫面"
                    />
                    <span className="preview-bottom">
                      {new URL(detail.browserUrl).hostname}
                      <span>↗</span>
                    </span>
                  </button>
                ) : (
                  <div className="detail-empty">
                    <p className="muted">開始瀏覽網頁後會顯示工作畫面。</p>
                    <button
                      className="text-button"
                      onClick={() => setExpanded(true)}
                    >
                      開啟電腦
                    </button>
                  </div>
                )}
              </DetailSection>
              <DetailSection
                title="排程"
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
                          ? `下次 ${new Date(r.nextAt).toLocaleString("zh-TW")}`
                          : "已暫停"}
                      </small>
                    </span>
                    <Icon name="arrow" size={14} />
                  </button>
                ))}
                {!detail.routines.length && (
                  <p className="muted">在指定時間交辦工作。</p>
                )}
                <button
                  className="text-button detail-add"
                  onClick={() => setRoutine("new")}
                >
                  <Icon name="plus" size={16} />
                  新增排程
                </button>
              </DetailSection>
              <DetailSection
                title="記憶"
                icon={<Icon name="spark" size={16} />}
                status={detail.memories.length}
              >
                {detail.memories.length ? (
                  detail.memories.map((m) => (
                    <div className="memory" key={m.id}>
                      {m.content}
                    </div>
                  ))
                ) : (
                  <p className="muted">告訴 Bot 你希望它記住的偏好。</p>
                )}
              </DetailSection>
              <DetailSection
                title="最近操作"
                icon={<Icon name="clock" size={16} />}
                status={detail.runs.at(-1)?.operations.length || 0}
              >
                {detail.runs.at(-1)?.operations.length ? (
                  detail.runs.at(-1)!.operations.map((o) => (
                    <details className="operation" key={o.id}>
                      <summary>
                        <span className={`operation-dot ${o.status}`} />
                        {o.name}
                        <small>{o.status}</small>
                      </summary>
                      <pre>{o.evidence?.command || o.target}</pre>
                      <pre>
                        {o.evidence?.output || o.error || o.evidence?.patch}
                      </pre>
                    </details>
                  ))
                ) : (
                  <p className="muted">執行任務後可查看操作紀錄。</p>
                )}
              </DetailSection>
            </div>
          )}
        </aside>
      )}
      {creating && state && (
        <Modal label="建立 Bot" close={() => setCreating(false)}>
          <section className="modal bot-create-modal">
            <header>
              <h2>建立 Bot</h2>
              <button
                className="icon"
                aria-label="關閉建立 Bot"
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
        <Modal label="Bot 的電腦" close={() => setExpanded(false)}>
          <section
            className="modal computer-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h2>Bot 的電腦</h2>
                <p>所有 Bots 共用登入狀態，各自使用分頁。</p>
              </div>
              <button
                className="icon"
                aria-label="關閉電腦"
                onClick={() => setExpanded(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            {detail?.browserUrl ? (
              <img
                src={`/api/v2/bots/${selected}/screenshot?v=${Date.now()}`}
                alt="完整瀏覽器畫面"
              />
            ) : (
              <div className="empty-section">
                尚未開啟網頁。可在對話中請 Bot 瀏覽網站。
              </div>
            )}
            <footer>
              <span>接管會在本機開啟專用瀏覽器視窗。</span>
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
                {detail?.computerOwner ? "交還控制權" : "接管瀏覽器"}
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
          {a.kind === "attachment" ? "附件" : "成果"} ·{" "}
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
              draft: "草稿",
              sending: "傳送中",
              sent: "已傳送",
              discarded: "已捨棄",
              unknown: "結果待確認",
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
            編輯操作內容
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
              捨棄
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void send("send")}
            >
              確認並傳送
            </button>
          </div>
        </>
      ) : (
        <>
          <pre>{draft.arguments}</pre>
          {draft.result && (
            <details>
              <summary>操作結果</summary>
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
          <strong>需要你的核准</strong>
          <small>Bot 希望執行 {a.tool}</small>
        </div>
      </div>
      <pre>{JSON.stringify(a.args, null, 2)}</pre>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        此 Bot 下次使用完全相同參數時自動允許
      </label>
      <div className="approval-actions">
        <button
          className="secondary"
          disabled={deciding}
          onClick={() => void act(false)}
        >
          拒絕
        </button>
        <button
          className="primary"
          disabled={deciding}
          onClick={() => void act(true)}
        >
          {deciding ? "處理中…" : "核准並繼續"}
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
  const [name, setName] = useState(detail?.bot.name || "");
  const [description, setDescription] = useState(detail?.bot.description || "");
  const [model, setModel] = useState(
    detail?.bot.connectionId
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
  const commit = async (body: unknown) => {
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      await save(body);
      setNotice("已儲存變更");
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
        const [connectionId, modelName] = model.split("::");
        void commit({
          name,
          description,
          avatar,
          connectionId: connectionId || "",
          model: modelName,
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
        名稱
        <input
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        角色與工作方式
        <textarea
          rows={7}
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例如：你是我的秘書，依其他 Bot 的角色派工，收到結果後整理回覆給我。"
        />
      </label>
      <label>
        使用的模型
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">跟隨預設模型</option>
          {state.connections.flatMap((c) =>
            (c.models || [c.model]).map((m) => (
              <option key={`${c.id}::${m}`} value={`${c.id}::${m}`}>
                {c.name} / {m}
              </option>
            )),
          )}
        </select>
      </label>
      <button
        className="primary"
        type="submit"
        disabled={saving || !name.trim()}
      >
        {saving ? "儲存中…" : detail ? "儲存變更" : "建立 Bot"}
      </button>
      {detail && (
        <div className="profile-options">
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ pinned: !detail.bot.pinned })}
          >
            {detail.bot.pinned ? "取消釘選" : "釘選 Bot"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void commit({ hidden: !detail.bot.hidden })}
          >
            {detail.bot.hidden ? "顯示 Bot" : "隱藏 Bot"}
          </button>
          <small>隱藏不會暫停排程。</small>
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
              刪除 Bot
            </button>
          )}
        </div>
      )}
      {confirmDelete && detail && remove && (
        <Modal
          label="刪除 Bot"
          close={() => {
            if (!deleting) setConfirmDelete(false);
          }}
        >
          <section className="modal bot-delete-modal">
            <header>
              <h2>刪除「{detail.bot.name}」？</h2>
            </header>
            <div className="delete-body">
              <p>
                此操作無法復原。將停止這位 Bot
                的任務，刪除對話、專屬記憶與技能、排程、草稿、核准規則，以及附件與成果清單。
              </p>
              <p>工作區實體檔案與執行日誌會保留；已完成的外部操作不會撤銷。</p>
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
                  取消
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
                  {deleting ? "停止任務並刪除中…" : "確認刪除"}
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
    <Modal label={old ? "編輯排程" : "新增排程"} close={close}>
      <section className="modal routine-modal">
        <header>
          <h2>{old ? "編輯排程" : "新增排程"}</h2>
          <button className="icon" aria-label="關閉排程" onClick={close}>
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
            名稱
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            交辦內容
            <textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </label>
          <label>
            時間
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
              <option value="0 9 * * 1-5">每個工作日 09:00</option>
              <option value="0 9 * * *">每天 09:00</option>
              <option value="0 9 * * 1">每週一 09:00</option>
              <option value="custom">自訂 Cron</option>
            </select>
          </label>
          <div className="form-row">
            <label>
              Cron
              <input value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
            <label>
              時區
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
            啟用排程（Apsis 需保持執行）
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
                立即試跑
              </button>
            )}
            <button className="primary" type="submit" disabled={saving}>
              {saving ? "儲存中…" : "儲存排程"}
            </button>
          </footer>
        </form>
        {old && (
          <details className="routine-history">
            <summary>執行紀錄（{old.history.length}）</summary>
            {old.history.map((h) => (
              <p key={h.jobId}>{new Date(h.at).toLocaleString("zh-TW")}</p>
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
  const [tab, setTab] = useState("models");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [provider, setProvider] = useState("openai-compatible");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState<string>();
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const modelFormRef = useRef<HTMLFormElement>(null);
  const [showTelegramTokenForm, setShowTelegramTokenForm] = useState(false);
  const [pairingCommand, setPairingCommand] = useState("");
  const [connectorMode, setConnectorMode] = useState<"form" | "json">("form");
  const [connectorJson, setConnectorJson] = useState("");
  const [connectorJsonError, setConnectorJsonError] = useState("");
  const [connectorDrafts, setConnectorDrafts] = useState<McpConnectorInput[]>(
    [],
  );
  const [telegram, setTelegram] = useState<TelegramView>();
  const [codexStatus, setCodexStatus] = useState<{
    connected: boolean;
    plan: string | null;
    login: { state: string; error?: string };
    models: { id: string; name: string }[];
  }>();
  const [codexLoginUrl, setCodexLoginUrl] = useState("");
  const [rules, setRules] = useState<
    { id: string; tool: string; args: unknown }[]
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
        failure ||= `清單更新失敗：${(error as Error).message}`;
      }
    }
    setConnectorDrafts(connectorDrafts.slice(added));
    if (failure) {
      setNotice(`${added ? `已加入 ${added} 個。` : ""}${failure}`);
    } else {
      setConnectorJson("");
      setNotice(`已加入 ${added} 個 MCP 連接器。`);
    }
    setBusy(false);
  };
  useEffect(() => {
    if (tab === "models")
      void api<typeof codexStatus>("/api/codex/status")
        .then(setCodexStatus)
        .catch((error) => setNotice(`Codex：${error.message}`));
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
    if (codexStatus?.login.state !== "pending") return;
    const timer = setInterval(() => {
      void api<typeof codexStatus>("/api/codex/status")
        .then(setCodexStatus)
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [codexStatus?.login.state]);
  useEffect(() => {
    if (codexStatus?.login.state === "completed")
      setNotice("ChatGPT 登入完成。現在可以儲存 Codex 模型連線。");
    if (codexStatus?.login.state === "failed")
      setNotice(codexStatus.login.error || "ChatGPT 登入失敗。");
  }, [codexStatus?.login.state]);
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
  useEffect(() => {
    if (showConnectionForm)
      modelFormRef.current?.querySelector("input")?.focus();
  }, [showConnectionForm, editing]);
  const resetConnectionForm = () => {
    setEditing(undefined);
    setShowConnectionForm(false);
    setName("");
    setKey("");
    setModel("");
    setUrl("");
  };
  const modelConnections = [...state.connections].sort(
    (a, b) =>
      Number(state.defaultModel?.connectionId === b.id) -
      Number(state.defaultModel?.connectionId === a.id),
  );
  const providerLabels: Record<string, string> = {
    codex: "ChatGPT Codex",
    ollama: "Ollama 本機模型",
    "openai-compatible": "OpenAI 相容 API",
    openai: "OpenAI API",
    anthropic: "Anthropic API",
  };
  return (
    <Modal label="設定與工具" close={close}>
      <section className="modal settings-modal">
        <header>
          <div>
            <h2>設定與工具</h2>
            <p>模型和工具供所有 Bots 使用。</p>
          </div>
          <button className="icon" aria-label="關閉設定" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-tabs">
            {[
              ["models", "模型連線"],
              ["connectors", "連接器"],
              ["skills", "技能"],
              ["telegram", "Telegram"],
              ["approvals", "自動核准"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                aria-current={tab === id ? "true" : undefined}
                onClick={() => {
                  setTab(id);
                  setNotice("");
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {notice && (
              <div role="status" className="notice">
                {notice}
              </div>
            )}
            {tab === "models" && (
              <>
                <div className="settings-section-heading">
                  <div>
                    <h3>ChatGPT 帳號</h3>
                    <p className="muted">
                      登入後可新增使用 Codex 額度的模型連線。
                    </p>
                  </div>
                </div>
                <div className="service-card">
                  <div className="service-card-main">
                    <strong>ChatGPT Codex</strong>
                    <span
                      className={`status-badge ${codexStatus?.connected ? "is-success" : ""}`}
                    >
                      {!codexStatus
                        ? "檢查中"
                        : codexStatus.connected
                          ? "已登入"
                          : codexStatus.login.state === "pending"
                            ? "登入中"
                            : "尚未登入"}
                    </span>
                    {codexStatus?.plan && (
                      <small>方案：{codexStatus.plan}</small>
                    )}
                    <small>使用 ChatGPT 訂閱額度，無需 API key。</small>
                  </div>
                  <div className="service-card-actions">
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        !codexStatus ||
                        codexStatus.login.state === "pending"
                      }
                      onClick={() => {
                        const popup = window.open("about:blank", "_blank");
                        void run(async () => {
                          try {
                            const result = await api<{ url: string }>(
                              "/api/codex/login",
                              "POST",
                              {},
                            );
                            setCodexLoginUrl(result.url);
                            if (popup) popup.location.href = result.url;
                            setCodexStatus(
                              await api<typeof codexStatus>(
                                "/api/codex/status",
                              ),
                            );
                            setNotice("請在開啟的頁面完成 ChatGPT 登入。");
                          } catch (error) {
                            popup?.close();
                            throw error;
                          }
                        });
                      }}
                    >
                      {codexStatus?.connected ? "重新登入" : "登入 ChatGPT"}
                    </button>
                    {codexLoginUrl && (
                      <a href={codexLoginUrl} target="_blank" rel="noreferrer">
                        開啟登入頁
                      </a>
                    )}
                  </div>
                </div>
                <div className="settings-section-heading model-section-heading">
                  <div>
                    <h3>模型連線</h3>
                    <p className="muted">預設模型會用於未指定模型的 Bot。</p>
                  </div>
                  <button
                    className="secondary"
                    aria-expanded={showConnectionForm}
                    aria-controls="model-connection-form"
                    onClick={() => {
                      if (showConnectionForm && !editing) {
                        resetConnectionForm();
                      } else {
                        resetConnectionForm();
                        setShowConnectionForm(true);
                      }
                    }}
                  >
                    {showConnectionForm && !editing ? "收起表單" : "新增連線"}
                  </button>
                </div>
                <div className="model-list">
                  {modelConnections.length === 0 && (
                    <p className="empty-section">尚未新增模型連線。</p>
                  )}
                  {modelConnections.map((c) => (
                    <div className="model-card" key={c.id}>
                      <div className="model-card-main">
                        <div className="model-card-title">
                          <strong>{c.name}</strong>
                          {state.defaultModel?.connectionId === c.id && (
                            <span className="status-badge is-success">
                              預設
                            </span>
                          )}
                        </div>
                        <small>
                          {providerLabels[c.provider] || c.provider} · {c.model}
                        </small>
                      </div>
                      <div className="model-card-actions">
                        {state.defaultModel?.connectionId !== c.id && (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api("/api/connections/default", "PUT", {
                                  connectionId: c.id,
                                  model: c.model,
                                });
                                setNotice("已設為預設模型。");
                              })
                            }
                          >
                            設為預設
                          </button>
                        )}
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await api<{
                                ok?: boolean;
                                error?: string;
                                message?: string;
                              }>(`/api/connections/${c.id}/test`, "POST", {
                                model: c.model,
                              });
                              setNotice(
                                result.message ||
                                  (result.ok
                                    ? "連線測試通過。"
                                    : "連線測試未通過。"),
                              );
                            })
                          }
                        >
                          測試
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(c.id);
                            setShowConnectionForm(true);
                            setName(c.name);
                            setProvider(c.provider);
                            setModel(c.model);
                            setUrl(c.url || "");
                            setKey("");
                          }}
                        >
                          編輯
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {showConnectionForm && (
                  <form
                    id="model-connection-form"
                    ref={modelFormRef}
                    className="settings-form model-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const c = await api<{ id: string }>(
                          editing
                            ? `/api/connections/${editing}`
                            : "/api/connections",
                          editing ? "PUT" : "POST",
                          { name, provider, model, url, apiKey: key },
                        );
                        await api("/api/connections/default", "PUT", {
                          connectionId: c.id,
                          model,
                        });
                        resetConnectionForm();
                        setNotice("模型已儲存並設為預設。");
                      });
                    }}
                  >
                    <h3>{editing ? "編輯模型連線" : "新增模型連線"}</h3>
                    <div className="form-row">
                      <label>
                        名稱
                        <input
                          required
                          placeholder="我的模型服務"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                      <label>
                        服務類型
                        <select
                          value={provider}
                          onChange={(e) => {
                            setProvider(e.target.value);
                            if (e.target.value === "codex") {
                              setName("ChatGPT Codex");
                              setModel(codexStatus?.models[0]?.id || "");
                            }
                          }}
                        >
                          <option value="codex">
                            ChatGPT Codex（免 API key）
                          </option>
                          <option value="openai-compatible">
                            OpenAI 相容 API
                          </option>
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="ollama">Ollama</option>
                        </select>
                      </label>
                    </div>
                    {["openai-compatible", "ollama"].includes(provider) && (
                      <label>
                        API 網址
                        <input
                          type="url"
                          required
                          placeholder={
                            provider === "ollama"
                              ? "http://127.0.0.1:11434"
                              : "https://api.example.com/v1"
                          }
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                        />
                      </label>
                    )}
                    <label>
                      模型 ID
                      {provider === "codex" ? (
                        <select
                          required
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        >
                          <option value="">選擇 Codex 模型</option>
                          {codexStatus?.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          required
                          placeholder="供應商提供的模型名稱"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                        />
                      )}
                    </label>
                    {!["ollama", "codex"].includes(provider) && (
                      <label>
                        API key
                        <input
                          type="password"
                          autoComplete="off"
                          value={key}
                          onChange={(e) => setKey(e.target.value)}
                          placeholder={
                            editing
                              ? "留白保留原金鑰；變更網址後須重新填寫"
                              : "儲存在這台電腦"
                          }
                        />
                      </label>
                    )}
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        (provider === "codex" && !codexStatus?.connected)
                      }
                    >
                      {busy ? "儲存中…" : "儲存連線"}
                    </button>
                    {editing && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={resetConnectionForm}
                      >
                        取消編輯
                      </button>
                    )}
                  </form>
                )}
              </>
            )}
            {tab === "connectors" && (
              <>
                <h3>MCP 連接器</h3>
                <p className="muted">
                  連接支援 Streamable HTTP 的 MCP
                  服務。工具執行前會出現核准卡片。
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
                      移除
                    </button>
                  </div>
                ))}
                <section className="settings-form connector-setup">
                  <h3>新增連接器</h3>
                  <div className="connector-mode" aria-label="連接器輸入方式">
                    <button
                      className={connectorMode === "form" ? "selected" : ""}
                      aria-current={
                        connectorMode === "form" ? "true" : undefined
                      }
                      onClick={() => setConnectorMode("form")}
                    >
                      手動輸入
                    </button>
                    <button
                      className={connectorMode === "json" ? "selected" : ""}
                      aria-current={
                        connectorMode === "json" ? "true" : undefined
                      }
                      onClick={() => setConnectorMode("json")}
                    >
                      貼上 JSON
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
                          setNotice("已連線，Bot 可使用這個服務。");
                        });
                      }}
                    >
                      <label>
                        名稱
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
                        Bearer token（選填）
                        <input
                          name="token"
                          type="password"
                          autoComplete="off"
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        測試並加入
                      </button>
                    </form>
                  ) : (
                    <div className="connector-json">
                      <p className="muted">
                        支援 mcpServers、servers 或單筆 JSON；可一次加入多個
                        Streamable HTTP 服務。
                      </p>
                      <label>
                        MCP 設定 JSON
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
                          檢查 JSON
                        </button>
                      </div>
                      {connectorDrafts.length > 0 && (
                        <div className="connector-preview">
                          <strong>
                            準備加入 {connectorDrafts.length} 個連接器
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
                                  ? "Bearer token 已提供"
                                  : "無需 token"}
                              </small>
                            </div>
                          ))}
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() => void importConnectorDrafts()}
                          >
                            {busy ? "連線測試中…" : "測試並加入"}
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
                <h3>共用技能</h3>
                <p className="muted">在對話輸入 / 選擇技能。</p>
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
                      setNotice("技能已建立。");
                    });
                  }}
                >
                  <label>
                    名稱
                    <input name="name" required />
                  </label>
                  <label>
                    步驟
                    <textarea name="content" rows={5} required />
                  </label>
                  <button className="primary" disabled={busy}>
                    新增技能
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
                      在 Telegram 私訊你的 Bot，接續本機工作。
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
                        ? "檢查中"
                        : telegram.ownerId
                          ? "已配對"
                          : !telegram.configured
                            ? "尚未設定"
                            : telegram.status === "connected"
                              ? "等待配對"
                              : telegram.status === "connecting"
                                ? "連線中"
                                : telegram.status === "error"
                                  ? "連線失敗"
                                  : "已停用"}
                    </span>
                    <small>
                      {!telegram
                        ? "正在讀取 Telegram 設定。"
                        : telegram.ownerId
                          ? "你的 Telegram 帳號已綁定，可開始傳訊。"
                          : !telegram.configured
                            ? "先儲存從 BotFather 取得的 token。"
                            : telegram.status === "connected"
                              ? "Bot 已連線，請建立配對碼綁定你的帳號。"
                              : telegram.status === "connecting"
                                ? "正在連線 Telegram，完成後即可配對。"
                                : telegram.error || "啟用 Bot 後即可配對。"}
                    </small>
                  </div>
                </div>
                {telegram && (
                  <div className="setup-steps">
                    <section className="setup-step">
                      <div className="setup-step-heading">
                        <span className="setup-step-number">1</span>
                        <div>
                          <h4>連接你的 Bot</h4>
                          <p>
                            從 Telegram 的 @BotFather 取得 Bot
                            token，儲存在這台電腦。
                          </p>
                        </div>
                      </div>
                      {telegram?.configured && !showTelegramTokenForm ? (
                        <div className="setup-step-actions">
                          <span className="setup-step-done">Token 已儲存</span>
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
                              啟用 Bot
                            </button>
                          )}
                          <button
                            className="text-button"
                            onClick={() => setShowTelegramTokenForm(true)}
                          >
                            更換 token
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
                              setNotice("Token 已儲存，正在連線 Telegram。");
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
                              placeholder="從 @BotFather 取得"
                            />
                          </label>
                          <div className="setup-step-actions">
                            <button className="primary" disabled={busy}>
                              儲存並啟用
                            </button>
                            {telegram?.configured && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() => setShowTelegramTokenForm(false)}
                              >
                                取消
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
                          <h4>配對 Telegram 帳號</h4>
                          <p>
                            建立指令後，私訊你的 Bot 完成配對。指令有效 10
                            分鐘。
                          </p>
                        </div>
                      </div>
                      {telegram?.ownerId ? (
                        <p className="setup-step-done">帳號已配對</p>
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
                            {pairingCommand ? "重新產生指令" : "建立配對指令"}
                          </button>
                          {telegram?.status === "connecting" && (
                            <span className="muted">等待連線完成…</span>
                          )}
                        </div>
                      )}
                      {pairingCommand && !telegram?.ownerId && (
                        <div className="pairing-command" role="status">
                          <span>傳送給 Bot</span>
                          <code>{pairingCommand}</code>
                          <button
                            className="secondary"
                            onClick={() =>
                              void navigator.clipboard
                                .writeText(pairingCommand)
                                .then(() => setNotice("配對指令已複製。"))
                                .catch(() =>
                                  setNotice(
                                    "無法自動複製，請手動選取配對指令。",
                                  ),
                                )
                            }
                          >
                            複製指令
                          </button>
                        </div>
                      )}
                    </section>
                  </div>
                )}
                <p className="telegram-help muted">
                  配對後可用 <code>/bots</code> 查看名單、<code>/bot ID</code>{" "}
                  選擇 Bot、<code>/stop</code> 停止工作。
                </p>
              </>
            )}
            {tab === "approvals" && (
              <>
                <h3>自動核准規則</h3>
                <p className="muted">
                  只允許指定 Bot、工具與完全相同的參數。其餘操作仍需核准。
                </p>
                {!rules.length && (
                  <p className="empty-section">尚未儲存自動核准規則。</p>
                )}
                {rules.map((r) => (
                  <div className="rule" key={r.id}>
                    <strong>{r.tool}</strong>
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
                      撤銷規則
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
