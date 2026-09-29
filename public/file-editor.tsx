import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { uiText as t } from "./settings-dictionary.ts";
export type FileContent = {
  content: string;
  revision: string;
  editable: boolean;
  size: number;
};
export type FileDraft = FileContent & { original: string };
export const fileDrafts = new Map<string, FileDraft>();
// Keep the navigation warning active even when the file panel is closed.
window.addEventListener("beforeunload", (event) => {
  if (
    [...fileDrafts.values()].some((draft) => draft.content !== draft.original)
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
export function readDraft(key: string) {
  if (fileDrafts.has(key)) return fileDrafts.get(key);
  try {
    const raw = sessionStorage.getItem("apsis.file." + key);
    if (raw) {
      const value = JSON.parse(raw) as FileDraft;
      fileDrafts.set(key, value);
      return value;
    }
  } catch {}
}
export function saveDraft(key: string, draft: FileDraft) {
  fileDrafts.set(key, draft);
  try {
    if (draft.content !== draft.original)
      sessionStorage.setItem("apsis.file." + key, JSON.stringify(draft));
    else sessionStorage.removeItem("apsis.file." + key);
  } catch {}
}
export function moveDrafts(locationId: string, from: string, to: string) {
  const prefix = locationId + ":" + from;
  const keys = new Set(fileDrafts.keys());
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("apsis.file.")) keys.add(key.slice(11));
    }
  } catch {}
  for (const key of keys) {
    if (key !== prefix && !key.startsWith(prefix + "/")) continue;
    const draft = readDraft(key);
    if (draft)
      saveDraft(
        locationId + ":" + to.replaceAll("\\", "/") + key.slice(prefix.length),
        draft,
      );
    fileDrafts.delete(key);
    try {
      sessionStorage.removeItem("apsis.file." + key);
    } catch {}
  }
}
export function TextEditor({
  value,
  path,
  onChange,
}: {
  value: string;
  path: string;
  onChange: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView>(null),
    change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const ext = path.split(".").at(-1)?.toLowerCase();
    const language =
      ext === "json"
        ? json()
        : ext === "md"
          ? markdown()
          : ext === "py"
            ? python()
            : ext === "html"
              ? html()
              : ext === "css"
                ? css()
                : javascript({
                    typescript: ["ts", "tsx"].includes(ext || ""),
                    jsx: ["jsx", "tsx"].includes(ext || ""),
                  });
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          language,
          syntaxHighlighting(defaultHighlightStyle),
          EditorView.lineWrapping,
          EditorView.cspNonce.of(
            document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')
              ?.content || "",
          ),
          EditorView.contentAttributes.of({
            "aria-label": t("文字編輯器"),
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, [path]);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  return <div className="file-editor" ref={host} />;
}
