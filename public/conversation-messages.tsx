import React from "react";
import type { useChatData } from "./use-chat-data.ts";
import type { useChatComposer } from "./use-chat-composer.ts";
import type { BotDetail as Detail } from "../shared/api.ts";
import { api } from "./chat-api.ts";
import { uiText } from "./settings-dictionary.ts";
import { BrandMark, CopyButton } from "./bot-ui.tsx";
import { Icon, Markdown } from "./chat-visuals.tsx";
import { ArtifactCard, DraftCard } from "./artifact-cards.tsx";
import { ConversationLoading } from "./activity-feedback.tsx";
import {
  RunHistory,
  RunArchive,
  UnlinkedDelegations,
} from "./task-history.tsx";
import { WorkApproval } from "./work-approval.tsx";

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
  setSettings: React.Dispatch<React.SetStateAction<boolean>>;
  expandedRuns: Record<string, boolean>;
  toggleRun: (id: string) => void;
  availableBots: Set<string>;
  select: (id: string) => void;
  hasDefaultModel: boolean;
}
export function ConversationMessages({
  data,
  composer,
  scroller,
  pinnedBottom,
  setAwayFromBottom,
  bottom,
  setSettings,
  expandedRuns,
  toggleRun,
  availableBots,
  select,
  hasDefaultModel,
}: Props) {
  const { detail, selected, selectedRef, setDetail, perform, refresh } = data;
  const {
    busy,
    setText,
    input,
    pendingRequest,
    setReplyTo,
    referenceArtifact,
    setRetryOf,
  } = composer;
  const bot = detail?.bot;
  const running = !!detail?.session.running;
  const summaries = new Map(detail?.runSummaries.map((r) => [r.id, r]));
  const activeSummary = detail?.runSummaries.find(
    (r) => r.id === detail.session.activeRunId && r.status === "running",
  );
  const pending = detail?.approvals.filter((a) => a.status === "pending") || [];
  return (
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
                    if (el) el.scrollTop = top + el.scrollHeight - height;
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
              {!hasDefaultModel && (
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
                    detail.jobs.find((j) => j.runId === m.runId)?.replyTo && (
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
                        {uiText("請檢查網路及模型連線設定，再重新送出訊息。")}
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
                    .filter((a) => a.kind === "result" && a.runId === m.runId)
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
  );
}
