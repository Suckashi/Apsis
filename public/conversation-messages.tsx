import React from "react";
import type { useChatData } from "./use-chat-data.ts";
import type { useChatComposer } from "./use-chat-composer.ts";
import type { BotDetail as Detail } from "../shared/api.ts";
import { api } from "./chat-api.ts";
import { uiText } from "./settings-dictionary.ts";
import { BrandMark, CopyButton, useMedia } from "./bot-ui.tsx";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { ArtifactDeliveries, DraftCard } from "./artifact-cards.tsx";
import { ConversationLoading } from "./activity-feedback.tsx";
import {
  RunHistory,
  RunArchive,
  UnlinkedDelegations,
} from "./task-history.tsx";
import { WorkApproval } from "./work-approval.tsx";
import { useSettingsLocale } from "./settings-locale.ts";
import { taskText } from "./task-locale.ts";
import type { RunFile } from "../shared/run-files.ts";
import type { Artifact } from "../shared/product.ts";
import { ReplyAnnouncement } from "./reply-announcement.tsx";
import { UserMessageText } from "./user-message.tsx";
import { runOutcome } from "../shared/work-presentation.ts";

function FailedReply({
  content,
  error,
  stopped,
}: {
  content: string;
  error?: string;
  stopped: boolean;
}) {
  const locale = useSettingsLocale();
  const t = (text: string) => taskText(locale, text);
  // Older messages contain partial output followed by the recorded error.
  const reason = error || content.trim().split("\n\n").at(-1) || content;
  const partial = content.trimEnd().endsWith(reason)
    ? content.trimEnd().slice(0, -reason.length).trimEnd()
    : content;
  const streamInterrupted = reason.trim() === "terminated";
  return (
    <>
      <div className="message-error">
        <strong>
          {t(
            stopped
              ? "已停止執行"
              : streamInterrupted
                ? "模型回應中斷"
                : "這次執行未完成",
          )}
        </strong>
        {!stopped && (
          <p>
            {t("已執行的操作可能已保留。重新嘗試前，請先確認目前檔案與進度。")}
          </p>
        )}
        <details>
          <summary>{uiText("錯誤詳情")}</summary>
          <code>{reason}</code>
        </details>
      </div>
      {partial && (
        <details className="execution-partial">
          <summary>{t("中斷前的部分回覆")}</summary>
          <Markdown text={partial} />
        </details>
      )}
    </>
  );
}

interface Props {
  data: Pick<
    ReturnType<typeof useChatData>,
    "detail" | "selected" | "selectedRef" | "setDetail" | "perform" | "refresh"
  >;
  composer: ReturnType<typeof useChatComposer>;
  scroller: React.RefObject<HTMLDivElement | null>;
  pinnedBottom: React.RefObject<boolean>;
  bottom: React.RefObject<HTMLDivElement | null>;
  setAwayFromBottom: React.Dispatch<React.SetStateAction<boolean>>;
  expandedRuns: Record<string, boolean>;
  toggleRun: (id: string) => void;
  availableBots: Set<string>;
  select: (id: string) => void;
  previewFile: (file: RunFile) => void;
  previewArtifact: (artifact: Artifact) => void;
}
export function ConversationMessages({
  data,
  composer,
  scroller,
  pinnedBottom,
  setAwayFromBottom,
  bottom,
  expandedRuns,
  toggleRun,
  availableBots,
  select,
  previewFile,
  previewArtifact,
}: Props) {
  const locale = useSettingsLocale();
  const desktop = useMedia("(min-width: 769px)");
  const { detail, selected, selectedRef, setDetail, perform, refresh } = data;
  const { busy, setText, input, pendingRequest, setReplyTo, setRetryOf } =
    composer;
  const bot = detail?.bot;
  const running = !!detail?.session.running;
  const summaries = new Map(detail?.runSummaries.map((r) => [r.id, r]));
  const activeSummary = detail?.runSummaries.find(
    (r) => r.id === detail.session.activeRunId && r.status === "running",
  );
  const pending = detail?.approvals.filter((a) => a.status === "pending") || [];
  const readingSize = React.useRef({
    height: 0,
    atStart: false,
    preservePage: false,
  });
  React.useLayoutEffect(() => {
    const element = scroller.current;
    const column = element?.querySelector(".message-column");
    if (
      !desktop ||
      !element ||
      !column ||
      typeof ResizeObserver === "undefined"
    )
      return;
    readingSize.current = {
      height: element.scrollHeight,
      atStart: element.scrollTop < 2,
      preservePage: false,
    };
    // Secondary records may arrive without a new message or text delta.
    // Keep following only while the reader has chosen the latest messages.
    const observer = new ResizeObserver(() => {
      if (pinnedBottom.current) element.scrollTop = element.scrollHeight;
      else if (readingSize.current.atStart && !readingSize.current.preservePage)
        element.scrollTop = 0;
      readingSize.current.height = element.scrollHeight;
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, [desktop, detail?.bot.id, scroller, pinnedBottom]);
  const syncReadingPosition = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    pinnedBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAwayFromBottom(!pinnedBottom.current);
  }, [scroller, pinnedBottom, setAwayFromBottom]);
  return (
    <div
      className="messages"
      role="region"
      tabIndex={desktop && !!detail?.session.messages.length ? 0 : undefined}
      aria-label={uiText("與 {0} 的對話", [bot?.name || "Bot"])}
      ref={scroller}
      onKeyDown={(event) => {
        if (
          !desktop ||
          event.target !== event.currentTarget ||
          !event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          (event.key !== "Home" && event.key !== "End")
        )
          return;
        // A native animated jump can retain an obsolete destination when
        // records load mid-scroll. Resolve the requested edge immediately.
        event.preventDefault();
        const element = event.currentTarget;
        pinnedBottom.current = event.key === "End";
        readingSize.current.atStart = event.key === "Home";
        element.scrollTop = pinnedBottom.current ? element.scrollHeight : 0;
        setAwayFromBottom(!pinnedBottom.current);
      }}
      onScroll={() => {
        const el = scroller.current!;
        // Native scroll anchoring can fire before ResizeObserver after records
        // grow. Preserve the reader's previous edge choice until that resize.
        if (!desktop || el.scrollHeight === readingSize.current.height) {
          pinnedBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          readingSize.current.atStart =
            !readingSize.current.preservePage && el.scrollTop < 2;
        }
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
      <ReplyAnnouncement selected={selected} detail={detail} />
      {!detail ? (
        <ConversationLoading />
      ) : (
        <div
          className={`message-column ${!detail.session.messages.length && !running ? "is-empty" : ""}`}
        >
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
                  // Pagination preserves the existing message's position;
                  // the newly prepended page is not an explicit Home jump.
                  readingSize.current.atStart = false;
                  readingSize.current.preservePage = true;
                  const page = await api<{
                    messages: Detail["session"]["messages"];
                    olderCursor?: number;
                  }>(
                    `/bots/${id}/history?before=${detail.session.olderCursor}`,
                  ).catch((error) => {
                    if (selectedRef.current === id)
                      readingSize.current.preservePage = false;
                    throw error;
                  });
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
                    if (selectedRef.current !== id) return;
                    if (el) el.scrollTop = top + el.scrollHeight - height;
                    readingSize.current.preservePage = false;
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
              <p>
                {uiText(
                  detail.contextSetupError
                    ? "先選好模型，就能開始。也可以先寫下需求。"
                    : "告訴我你想完成什麼，我會在這裡接著做。",
                )}
              </p>
              {!detail.contextSetupError && !composer.text.length && (
                <section
                  className="intro-examples"
                  aria-label={uiText("開始對話的範例")}
                >
                  <p className="intro-examples-help">
                    {uiText("選一個開頭，再補上你的內容。")}
                  </p>
                  <div className="starter-prompts">
                    {[
                      {
                        icon: "search",
                        title: "研究一個主題",
                        description: "比較資料，整理來源與結論",
                        prompt: "幫我研究：",
                      },
                      {
                        icon: "file",
                        title: "整理一份文件",
                        description: "摘要重點，整理成可用的內容",
                        prompt: "幫我整理這份文件：",
                      },
                      {
                        icon: "monitor",
                        title: "修改程式碼",
                        description: "說明要修改的地方與預期結果",
                        prompt: "幫我修改程式：",
                      },
                    ].map((example) => (
                      <button
                        type="button"
                        key={example.icon}
                        onClick={() => {
                          // Examples help start an empty draft; never replace ongoing work.
                          if (!composer.text.length)
                            composer.insertChoice(uiText(example.prompt));
                        }}
                      >
                        <Icon name={example.icon} size={20} />
                        <span>
                          <strong>{uiText(example.title)}</strong>
                          <small>{uiText(example.description)}</small>
                        </span>
                        <Icon name="arrow" size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
          {detail.session.messages.map((m, index) => (
            <React.Fragment key={m.id}>
              {index > 0 &&
                m.workContextId !==
                  detail.session.messages[index - 1].workContextId && (
                  <div
                    className="topic-divider"
                    role="separator"
                    aria-label={uiText("新話題")}
                  >
                    {uiText("新話題")}
                  </div>
                )}
              <article
                id={`message-${m.id}`}
                aria-label={
                  m.role === "user"
                    ? uiText("你的訊息")
                    : uiText("{0} 的回覆", [bot?.name || "Bot"])
                }
                className={`message ${m.role} ${m.status === "error" ? "failed" : ""}`}
              >
                <div className="message-body">
                  {m.role === "user" &&
                    detail.jobs.find((j) => j.runId === m.runId)?.replyTo && (
                      <a
                        className="quoted-message"
                        href={`#message-${detail.jobs.find((j) => j.runId === m.runId)?.replyTo}`}
                        onClick={(e) => {
                          e.preventDefault();
                          const original = document.getElementById(
                            `message-${detail.jobs.find((j) => j.runId === m.runId)?.replyTo}`,
                          );
                          const request =
                            original?.querySelector<HTMLDetailsElement>(
                              ".request-disclosure",
                            );
                          if (request) request.open = true;
                          request
                            ?.querySelector<HTMLElement>("summary")
                            ?.focus({ preventScroll: true });
                          original?.scrollIntoView({
                            behavior: window.matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "instant"
                              : "smooth",
                            block: "start",
                          });
                          syncReadingPosition();
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
                        {uiText("請檢查網路及模型連線設定，再重新送出訊息。")}
                      </p>
                      <details>
                        <summary>{uiText("錯誤詳情")}</summary>
                        <code>{m.content}</code>
                      </details>
                    </div>
                  ) : m.status === "error" ? (
                    <FailedReply
                      content={m.content}
                      error={
                        m.runId
                          ? detail.jobs.find((j) => j.runId === m.runId)?.error
                          : undefined
                      }
                      stopped={
                        !!m.runId &&
                        summaries.get(m.runId)?.status === "cancelled"
                      }
                    />
                  ) : m.role === "user" ? (
                    <UserMessageText
                      text={m.content}
                      storageKey={`apsis.bot-request.${detail.bot.id}.${m.id}`}
                      initiallyOpen={
                        running && m.runId === detail.session.activeRunId
                      }
                      syncReadingPosition={syncReadingPosition}
                    />
                  ) : (
                    <Markdown text={m.content} />
                  )}
                </div>
                {m.role === "assistant" && m.runId && (
                  <ArtifactDeliveries
                    artifacts={detail.artifacts.filter(
                      (a) => a.kind === "result" && a.runId === m.runId,
                    )}
                    preview={previewArtifact}
                  />
                )}
                {m.role === "assistant" &&
                  m.runId &&
                  summaries.has(m.runId) && (
                    <RunHistory
                      compactReply
                      botId={detail.bot.id}
                      summary={summaries.get(m.runId)!}
                      open={!!expandedRuns[m.runId]}
                      toggle={() => toggleRun(m.runId!)}
                      select={select}
                      available={availableBots}
                      previewFile={previewFile}
                      deliveredPaths={detail.artifacts
                        .filter(
                          (a) => a.kind === "result" && a.runId === m.runId,
                        )
                        .flatMap((a) =>
                          a.bundle
                            ? a.bundle.files.map((file) => file.path)
                            : [a.path],
                        )}
                    />
                  )}
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
                            : uiText("這則補充沒有帶入模型回合，請重新送出。")
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
                    {m.role === "assistant" &&
                      m.runId &&
                      summaries.has(m.runId) &&
                      runOutcome(summaries.get(m.runId)!).quiet && (
                        <button
                          className="reply-record-action"
                          id={`reply-record-${m.runId}`}
                          aria-expanded={!!expandedRuns[m.runId]}
                          aria-controls={`task-record-${m.runId}`}
                          onClick={() => toggleRun(m.runId!)}
                        >
                          {taskText(locale, "回覆紀錄")}
                        </button>
                      )}
                    {m.role === "assistant" &&
                      m.status === "error" &&
                      detail.jobs.some(
                        (j) =>
                          j.runId === m.runId &&
                          (j.status === "failed" || j.status === "interrupted"),
                      ) && (
                        <button
                          disabled={busy || running}
                          onClick={() => {
                            const job = detail.jobs.find(
                              (j) =>
                                j.runId === m.runId &&
                                (j.status === "failed" ||
                                  j.status === "interrupted"),
                            );
                            if (!job) return;
                            pendingRequest.current = undefined;
                            setReplyTo(undefined);
                            setRetryOf(job.id);
                            setText(job.prompt);
                            input.current?.focus();
                          }}
                        >
                          {uiText("重新交辦")}
                        </button>
                      )}
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
            <article
              className="message assistant live"
              aria-label={uiText("{0} 正在回覆", [bot?.name || "Bot"])}
            >
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
          <UnlinkedDelegations
            key={selected}
            jobs={detail.unlinkedDelegations}
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
          <ArtifactDeliveries
            artifacts={detail.artifacts.filter(
              (a) =>
                a.kind === "result" &&
                !detail.session.messages.some(
                  (m) => m.role === "assistant" && m.runId === a.runId,
                ),
            )}
            preview={previewArtifact}
          />
          {detail.jobs
            .filter(
              (j) =>
                !j.dismissedAt &&
                !detail.session.messages.some(
                  (m) =>
                    m.role === "assistant" &&
                    m.status === "error" &&
                    !!j.runId &&
                    m.runId === j.runId,
                ) &&
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
              <div
                className="topic-divider"
                role="separator"
                aria-label={uiText("新話題")}
              >
                {uiText("新話題")}
              </div>
            )}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}
