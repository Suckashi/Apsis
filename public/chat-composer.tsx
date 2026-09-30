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
  status: React.ReactNode;
  repairModel: () => void;
  hasModelOptions: boolean;
}
export function ChatComposer({
  composer,
  detail,
  selected,
  botName,
  running,
  smallScreen,
  status,
  repairModel,
  hasModelOptions,
}: Props) {
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
  return (
    <ComposerFrame as="div" className="composer-card">
      {status}
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
                {ref.path}
                <button
                  aria-label={uiText("移除 {0}", [ref.path])}
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
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDismissedSuggestion(true);
                input.current?.focus();
              }
            }}
          >
            {suggestions.map((s) => (
              <button key={s.id} onClick={() => insertChoice(s.value, true)}>
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
              document
                .querySelector<HTMLButtonElement>(".suggestions button")
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
              {[{ label: "連接器 @", items: connectorChoices }].map((group) => (
                <section key={group.label} aria-label={uiText(group.label)}>
                  <h3>{uiText(group.label)}</h3>
                  {group.items.length ? (
                    group.items.map((item) => (
                      <button
                        key={item.id}
                        disabled={busy || !detail}
                        onClick={(e) => {
                          e.currentTarget.closest("details")!.open = false;
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
          </div>
          <div className="composer-send-actions">
            <button
              className={`send ${running ? "queue-send" : ""}`}
              aria-label={running ? uiText("補充指示") : uiText("傳送")}
              title={running ? uiText("補充指示") : uiText("傳送")}
              disabled={
                busy ||
                !detail ||
                !!detail.contextSetupError ||
                (!text.trim() && !attachments.length)
              }
              onClick={() => void send()}
            >
              {busy ? <ActivityMark /> : <Icon name="send" size={18} />}
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
            {uiText(hasModelOptions ? "修正此 Bot 的模型" : "設定模型連線")}
          </button>
        </div>
      )}
    </ComposerFrame>
  );
}
