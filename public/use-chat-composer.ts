import { useEffect, useRef, useState } from "react";
import { api } from "./chat-api.ts";
import { useAutoGrowTextarea } from "./workspace-primitives.tsx";
import { uiText } from "./settings-dictionary.ts";
import { taskText } from "./task-locale.ts";
import { useSettingsLocale } from "./settings-locale.ts";
import type { Artifact } from "../shared/product.ts";
import type { SendMessageRequest } from "../shared/api.ts";
import type { useChatData } from "./use-chat-data.ts";

type Dependencies = Pick<
  ReturnType<typeof useChatData>,
  | "state"
  | "detail"
  | "selected"
  | "selectedRef"
  | "refresh"
  | "perform"
  | "setError"
> & { onSent: () => void };

/** Drafts, attachments and idempotent message delivery belong to the composer. */
export function useChatComposer({
  state,
  detail,
  selected,
  selectedRef,
  refresh,
  perform,
  setError,
  onSent,
}: Dependencies) {
  const locale = useSettingsLocale();
  const feedbackText = (text: string) => taskText(locale, text);
  const [text, setText] = useState("");
  const [fileReferences, setFileReferences] = useState<
    { locationId: string; path: string; revision: string }[]
  >([]);
  const [caret, setCaret] = useState(0);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const draftSelection = useRef({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    botId: string;
    label: string;
    pending: boolean;
  }>();
  const [attachments, setAttachments] = useState<Artifact[]>([]);
  const [retryOf, setRetryOf] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  const [quotedPreview, setQuotedPreview] = useState<{
    id: string;
    content: string;
  }>();
  const input = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(input, detail ? text : "\0");
  const upload = useRef<HTMLInputElement>(null);
  const pendingRequest = useRef<
    { scope?: string; prompt: string; botId: string; id: string } | undefined
  >(undefined);
  useEffect(() => {
    if (!actionFeedback || actionFeedback.pending) return;
    const timer = setTimeout(() => setActionFeedback(undefined), 5000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);
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
      } satisfies SendMessageRequest);
      pendingRequest.current = undefined;
      if (selectedRef.current === botId) {
        setText("");
        sessionStorage.removeItem("apsis.bot-draft." + botId);
        setAttachments([]);
        setFileReferences([]);
        setReplyTo(undefined);
        setRetryOf(undefined);
        onSent();
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
  useEffect(() => {
    setText(sessionStorage.getItem(`apsis.bot-draft.${selected}`) || "");
    setFileReferences([]);
    setDismissedSuggestion(false);
    draftSelection.current = { start: 0, end: 0 };
    setAttachments([]);
    setReplyTo(undefined);
    setRetryOf(undefined);
    setQuotedPreview(undefined);
    pendingRequest.current = undefined;
  }, [selected]);
  return {
    text,
    setText,
    fileReferences,
    setFileReferences,
    caret,
    setCaret,
    dismissedSuggestion,
    setDismissedSuggestion,
    draftSelection,
    busy,
    actionFeedback,
    attachments,
    setAttachments,
    retryOf,
    setRetryOf,
    replyTo,
    setReplyTo,
    quotedPreview,
    setQuotedPreview,
    input,
    upload,
    pendingRequest,
    send,
    referenceArtifact,
    uploadFiles,
    suggestions,
    insertChoice,
    connectorChoices,
  };
}
