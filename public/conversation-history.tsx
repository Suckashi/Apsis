import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, WorkContext } from "../shared/types.ts";
import type { HistoryHit } from "../server/conversations.ts";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { uiText as t } from "./settings-dictionary.ts";
import { getSettingsLocale } from "./settings-locale.ts";

type API = <T>(path: string, body?: unknown) => Promise<T>;

function HistoryMessage({
  role,
  content,
  createdAt,
  actions,
  truncated = false,
  loadComplete,
}: {
  role: string;
  content: string;
  createdAt?: string;
  actions: ReactNode | ((content: string, truncated: boolean) => ReactNode);
  truncated?: boolean;
  loadComplete?: () => Promise<HistoryHit>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [complete, setComplete] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const remaining = truncated && complete === undefined;
  const text = complete ?? content;
  const expand = async () => {
    setExpanded(true);
    if (!remaining || !loadComplete || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const message = await loadComplete();
      if (alive.current) setComplete(message.content);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  };
  const id = useId();
  const chat = role === "user" || role === "assistant";
  const excerpt = Array.from(text).slice(0, 160).join("");
  const long = remaining || !chat || excerpt.length < text.length;
  const date = createdAt ? new Date(createdAt) : undefined;
  return (
    <article className={`history-message history-role-${role}`}>
      <header>
        <strong>
          {t(
            role === "user"
              ? "你"
              : role === "assistant"
                ? "Bot 回覆"
                : "工具紀錄",
          )}
        </strong>
        {date && !Number.isNaN(date.getTime()) && (
          <time dateTime={createdAt}>
            {date.toLocaleString(getSettingsLocale())}
          </time>
        )}
      </header>
      <div id={id} className="history-message-content">
        {expanded && !chat ? (
          <pre className="history-tool-record">{text}</pre>
        ) : expanded ? (
          <Markdown text={text} />
        ) : (
          <p>
            {chat
              ? long
                ? excerpt + "…"
                : text
              : t("工具輸出，展開查看詳細內容。")}
          </p>
        )}
      </div>
      {remaining && (
        <p className="history-feedback history-excerpt-help">
          {t("目前顯示搜尋片段，展開讀取完整原文。")}
        </p>
      )}
      {loading && (
        <p className="history-feedback" role="status">
          {t("載入中…")}
        </p>
      )}
      {error && (
        <p className="file-error" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void expand()}>
            {t("重試")}
          </button>
        </p>
      )}
      <footer>
        <div>
          {typeof actions === "function" ? actions(text, remaining) : actions}
        </div>
        {long && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => (expanded ? setExpanded(false) : void expand())}
          >
            {t(expanded ? "收合" : remaining ? "展開完整原文" : "展開內容")}
            <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} />
          </button>
        )}
      </footer>
    </article>
  );
}

/** Browsing and quoting never changes the active topic or workspace. */
export function ConversationHistory({
  botId,
  botName,
  contexts,
  loading,
  api,
  quote,
  moreContexts,
  loadMoreContexts,
  contextsFailed,
  retryContexts,
  initialQuery = "",
}: {
  initialQuery?: string;
  botId: string;
  botName?: string;
  contexts: WorkContext[];
  loading: boolean;
  api: API;
  quote: (id: string, content: string) => void;
  moreContexts: boolean;
  loadMoreContexts: () => void;
  contextsFailed: boolean;
  retryContexts: () => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState<string>();
  const [hits, setHits] = useState<HistoryHit[]>([]);
  const [surrounding, setSurrounding] = useState<HistoryHit[]>();
  const [more, setMore] = useState(false);
  const [past, setPast] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<number>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(initialQuery.trim().length >= 2);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  const base = `/bots/${botId}`;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const search = (term: string, before?: number) =>
    act(async () => {
      const rows = await api<HistoryHit[]>(
        `${base}/history/search?q=${encodeURIComponent(term)}${before !== undefined ? `&before=${before}` : ""}`,
      );
      if (!alive.current) return;
      setSubmitted(term);
      setSurrounding(undefined);
      setHits((old) => (before === undefined ? rows : [...old, ...rows]));
      setMore(rows.length === 20);
    });
  useEffect(() => {
    const term = initialQuery.trim();
    if (term.length < 2) return;
    let valid = true;
    pending.current = true;
    setBusy(true);
    // A sidebar choice is an explicit search. Editing the modal input does not rerun it.
    void api<HistoryHit[]>(
      `${base}/history/search?q=${encodeURIComponent(term)}`,
    )
      .then((rows) => {
        if (!valid) return;
        setSubmitted(term);
        setHits(rows);
        setMore(rows.length === 20);
      })
      .catch((error: Error) => {
        if (valid) setError(error.message);
      })
      .finally(() => {
        if (!valid) return;
        pending.current = false;
        setBusy(false);
      });
    return () => {
      valid = false;
    };
  }, [base, initialQuery, api]);
  const loadTopic = (id: string, before?: number) =>
    act(async () => {
      const page = await api<{ messages: ChatMessage[]; olderCursor?: number }>(
        `${base}/history?context=${encodeURIComponent(id)}${before !== undefined ? `&before=${before}` : ""}`,
      );
      if (!alive.current) return;
      setSelected(id);
      setPast((old) =>
        before === undefined ? page.messages : [...page.messages, ...old],
      );
      setOlder(page.olderCursor);
    });
  const shown = surrounding ?? hits;
  return (
    <section
      className={`history-browser${submitted !== undefined ? " history-has-search" : ""}`}
      aria-label={
        botName ? t("{0} 的歷史訊息", [botName]) : t("搜尋聊天與話題")
      }
      aria-busy={busy || loading}
    >
      <h3>{botName ? t("{0} 的歷史訊息", [botName]) : t("搜尋聊天與話題")}</h3>
      <form
        className="history-search"
        onSubmit={(event) => {
          event.preventDefault();
          void search(query.trim());
        }}
      >
        <label className="search">
          <Icon name="search" size={18} />
          <span className="visually-hidden">{t("搜尋歷史")}</span>
          <input
            ref={searchInput}
            value={query}
            minLength={2}
            maxLength={200}
            placeholder={t("輸入至少兩個字，尋找訊息")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={busy || query.trim().length < 2}
        >
          {t("搜尋")}
        </button>
      </form>
      <details className="history-search-help">
        <summary>{t("搜尋說明")}</summary>
        <p className="history-feedback">
          {t("空格分開關鍵字；雙引號搜尋完整片語。")}
        </p>
      </details>
      {busy && (
        <p className="history-feedback" role="status">
          {t("載入中…")}
        </p>
      )}
      {error && (
        <p className="file-error" role="alert">
          {error}
        </p>
      )}
      {submitted !== undefined && (
        <section
          className="history-results"
          aria-label={t(surrounding ? "前後文" : "搜尋結果")}
        >
          <div className="history-results-heading">
            <h4>{t(surrounding ? "前後文" : "搜尋結果")}</h4>
            <span>{submitted}</span>
            <button
              type="button"
              className="history-return-topics"
              disabled={busy}
              onClick={() => {
                setSubmitted(undefined);
                setQuery("");
                setHits([]);
                setSurrounding(undefined);
                setMore(false);
                searchInput.current?.focus();
              }}
            >
              {t("返回話題清單")}
            </button>
            {surrounding && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSurrounding(undefined)}
              >
                {t("返回搜尋結果")}
              </button>
            )}
          </div>
          {!shown.length && !busy && (
            <p className="history-feedback" role="status">
              {t("找不到符合的訊息，試試其他關鍵字。")}
            </p>
          )}
          {shown.map((hit) => (
            <HistoryMessage
              key={hit.sequence}
              role={hit.role}
              content={hit.content}
              createdAt={hit.createdAt}
              truncated={hit.truncated}
              loadComplete={() =>
                api<HistoryHit>(
                  `${base}/history/message?sequence=${hit.sequence}`,
                )
              }
              actions={(text, remaining) => (
                <>
                  {hit.channel === "chat" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => quote(hit.id, text)}
                    >
                      {t(remaining ? "引用片段" : "引用")}
                    </button>
                  )}
                  {!surrounding && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const rows = await api<HistoryHit[]>(
                            `${base}/history/around?sequence=${hit.sequence}`,
                          );
                          if (alive.current) setSurrounding(rows);
                        })
                      }
                    >
                      {t("前後文")}
                    </button>
                  )}
                </>
              )}
            />
          ))}
          {more && !surrounding && (
            <button
              type="button"
              className="secondary history-load-more"
              disabled={busy}
              onClick={() => void search(submitted, hits.at(-1)!.sequence)}
            >
              {t("更早的搜尋結果")}
            </button>
          )}
        </section>
      )}
      <section className="history-topics" aria-label={t("先前話題的訊息")}>
        <nav className="history-topic-list" aria-label={t("話題清單")}>
          {contexts.map((context) => (
            <button
              type="button"
              key={context.id}
              data-context-id={context.id}
              aria-pressed={selected === context.id}
              disabled={busy || loading}
              onClick={() => void loadTopic(context.id)}
            >
              <span>{context.location?.name || t("自動資料夾")}</span>
              <time dateTime={context.createdAt}>
                {new Date(context.createdAt).toLocaleString(
                  getSettingsLocale(),
                )}
              </time>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
        </nav>
        {selected && (
          <button
            type="button"
            className="history-topic-clear"
            disabled={busy}
            onClick={() => {
              setSelected("");
              setPast([]);
              setOlder(undefined);
            }}
          >
            {t("收合話題訊息")}
          </button>
        )}
        <label className="history-topic-select">
          {t("瀏覽先前話題")}
          <select
            aria-label={t("瀏覽先前話題")}
            disabled={busy || loading}
            value={selected}
            onChange={(event) => {
              if (event.target.value) void loadTopic(event.target.value);
              else {
                setSelected("");
                setPast([]);
                setOlder(undefined);
              }
            }}
          >
            <option value="">{t("選擇話題")}</option>
            {contexts.map((context) => (
              <option key={context.id} value={context.id}>
                {new Date(context.createdAt).toLocaleString(
                  getSettingsLocale(),
                )}{" "}
                · {context.location?.name || t("自動資料夾")}
              </option>
            ))}
          </select>
        </label>
        {loading && (
          <p className="history-feedback" role="status">
            {t("載入中…")}
          </p>
        )}
        {contextsFailed && (
          <button
            type="button"
            className="secondary"
            disabled={loading || busy}
            onClick={retryContexts}
          >
            {t("重新整理")}
          </button>
        )}
        {!loading && !contextsFailed && !contexts.length && (
          <p className="history-feedback">{t("尚無先前話題。")}</p>
        )}
        {moreContexts && (
          <button
            type="button"
            className="secondary"
            disabled={busy || loading}
            onClick={loadMoreContexts}
          >
            {t("更早的話題")}
          </button>
        )}
        {!!selected && !past.length && !busy && (
          <p className="history-feedback">{t("此話題尚無訊息。")}</p>
        )}
        {past.map((message) => (
          <HistoryMessage
            key={message.id}
            role={message.role}
            content={message.content}
            createdAt={message.createdAt}
            actions={
              <button
                type="button"
                disabled={busy}
                onClick={() => quote(message.id, message.content)}
              >
                {t("引用")}
              </button>
            }
          />
        ))}
        {older !== undefined && selected && (
          <button
            type="button"
            className="secondary history-load-more"
            disabled={busy}
            onClick={() => void loadTopic(selected, older)}
          >
            {t("更早的訊息")}
          </button>
        )}
      </section>
    </section>
  );
}
