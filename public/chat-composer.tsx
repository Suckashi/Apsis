import React from "react";
import type { BotDetail } from "../shared/api.ts";
import type { useChatComposer } from "./use-chat-composer.ts";
import { ComposerFrame } from "./workspace-primitives.tsx";
import { ComposerPopover } from "./composer-popover.tsx";
import { Icon } from "./chat-visuals.tsx";
import { ActivityMark } from "./activity-feedback.tsx";
import { uiText, uiError } from "./settings-dictionary.ts";
interface Props {
  composer: ReturnType<typeof useChatComposer>;
  detail?: BotDetail;
  selected: string | null;
  botName: string;
  running: boolean;
  smallScreen: boolean;
  stopping: boolean;
  stop: () => void;
  repairModel: () => void;
  hasModelOptions: boolean;
  modelPicker: React.ReactNode;
  approvalControl: React.ReactNode;
  openOptions: () => void;
}
export function ChatComposer({
  composer,
  detail,
  selected,
  botName,
  running,
  smallScreen,
  stopping,
  stop,
  repairModel,
  hasModelOptions,
  modelPicker,
  approvalControl,
  openOptions,
}: Props) {
  const suggestionList = React.useRef<HTMLDivElement>(null);
  const {
    retryOf,
    setRetryOf,
    replyTo,
    setReplyTo,
    quotedPreview,
    fileReferences,
    setFileReferences,
    attachments,
    setAttachments,
    suggestions,
    setDismissedSuggestion,
    input,
    busy,
    contextChanging,
    networkOffline,
    text,
    setText,
    setCaret,
    draftSelection,
    send,
    upload,
    uploadFiles,
    connectorChoices,
    insertChoice,
  } = composer;
  const firstConversation =
    !!detail && !detail.session.messages.length && !running;
  const hasMessage =
    !!text.trim() || !!attachments.length || !!fileReferences.length;
  const stopAction = running && !hasMessage && !busy;
  const actionLabel = uiText(
    stopAction ? "停止回覆" : running ? "補充指示" : "傳送",
  );
  return (
    <ComposerFrame as="div" className="composer-card">
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
              detail?.session.messages.find((m) => m.id === replyTo)?.content ||
              (quotedPreview?.id === replyTo ? quotedPreview.content : "")
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
                {ref.label || ref.path}
                <button
                  aria-label={uiText("移除 {0}", [ref.label || ref.path])}
                  onClick={() =>
                    setFileReferences((old) => old.filter((r) => r !== ref))
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
                    setAttachments((old) => old.filter((x) => x.id !== a.id))
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
            ref={suggestionList}
            role="group"
            aria-label={uiText("輸入建議")}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDismissedSuggestion(true);
                input.current?.focus();
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll("button"),
                );
                const index = buttons.indexOf(
                  event.target as HTMLButtonElement,
                );
                if (index < 0) return;
                event.preventDefault();
                if (event.key === "ArrowUp" && index === 0)
                  input.current?.focus();
                else
                  buttons[
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : event.key === "ArrowDown"
                          ? (index + 1) % buttons.length
                          : index - 1
                  ]?.focus();
              }
            }}
          >
            {!smallScreen && (
              <p className="suggestions-help">
                {uiText("方向鍵選擇 · Enter 插入 · Esc 關閉")}
              </p>
            )}
            {suggestions.map((s) => (
              <button
                type="button"
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
          title={
            !smallScreen ? uiText("Enter 傳送 · Shift + Enter 換行") : undefined
          }
          placeholder={
            busy ? uiText("傳送中…") : uiText("傳訊息給 {0}…", [botName])
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
              suggestionList.current
                ?.querySelector<HTMLButtonElement>("button")
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
            {!smallScreen && connectorChoices.length === 0 ? (
              <button
                type="button"
                className="composer-attach"
                aria-label={uiText("新增附件")}
                title={uiText("新增附件")}
                disabled={busy || contextChanging || networkOffline || !detail}
                onClick={() => upload.current?.click()}
              >
                <Icon name="attach" size={18} />
              </button>
            ) : (
              <ComposerPopover
                label={
                  <>
                    <Icon name="plus" size={18} />
                    <span className="visually-hidden">{uiText("工具")}</span>
                  </>
                }
              >
                <button
                  disabled={
                    busy || contextChanging || networkOffline || !detail
                  }
                  onClick={(e) => {
                    const tools = e.currentTarget.closest("details")!;
                    tools.open = false;
                    tools.querySelector("summary")?.focus();
                    upload.current?.click();
                  }}
                >
                  <Icon name="attach" size={18} />
                  {uiText("新增附件")}
                </button>
                {connectorChoices.length > 0 && (
                  <section aria-label={uiText("連接器 @")}>
                    <h3>{uiText("連接器 @")}</h3>
                    {connectorChoices.map((item) => (
                      <button
                        key={item.id}
                        disabled={
                          busy || contextChanging || networkOffline || !detail
                        }
                        onClick={(e) => {
                          e.currentTarget.closest("details")!.open = false;
                          insertChoice(item.value);
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                  </section>
                )}
              </ComposerPopover>
            )}
            {approvalControl}
          </div>
          <div className="composer-send-actions">
            {smallScreen ? (
              <button
                className="mobile-compose-options"
                onClick={openOptions}
                aria-label={uiText("聊天選項")}
              >
                <Icon name="settings" size={18} />
              </button>
            ) : (
              modelPicker
            )}
            <button
              className={`send ${running ? "queue-send" : ""}`}
              aria-label={actionLabel}
              title={stopping ? uiText("正在停止…") : actionLabel}
              aria-busy={(stopAction && stopping) || undefined}
              disabled={
                stopping ||
                busy ||
                contextChanging ||
                networkOffline ||
                !detail ||
                !!detail.contextSetupError ||
                (!stopAction && !hasMessage)
              }
              onClick={() => (stopAction ? stop() : void send())}
            >
              {busy || stopping ? (
                <ActivityMark />
              ) : (
                <Icon name={stopAction ? "stop" : "send"} size={18} />
              )}
            </button>
          </div>
        </div>
        <input
          ref={upload}
          type="file"
          hidden
          aria-label={uiText("選擇附件")}
          multiple
          accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"
          onChange={(e) => void uploadFiles(e.target.files)}
        />
      </div>
      {detail?.contextSetupError && (
        <div
          role="status"
          className={`model-setup-notice ${firstConversation ? "setup-required" : ""}`}
        >
          {firstConversation ? (
            <Icon name="settings" size={20} />
          ) : (
            <ActivityMark state="failed" />
          )}
          <span>
            <strong>
              {uiText(
                firstConversation ? "設定模型，開始對話" : "目前無法開始工作",
              )}
            </strong>
            <small>{uiError(detail.contextSetupError)}</small>
          </span>
          <button
            type="button"
            className={firstConversation ? "primary" : undefined}
            onClick={repairModel}
          >
            {uiText(hasModelOptions ? "修正此 Bot 的模型" : "設定模型連線")}
          </button>
        </div>
      )}
    </ComposerFrame>
  );
}
