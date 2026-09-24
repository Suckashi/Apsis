import MarkdownIt from "markdown-it";

const t = (message: string, ...args: string[]) =>
  message.replace(
    /\{(\d+)\}/g,
    (_, index: string) => args[Number(index)] || "",
  );

// Model output is untrusted: raw HTML stays text, and unsafe link schemes are rejected.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
const codeLanguages: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  md: "Markdown",
  markdown: "Markdown",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  powershell: "PowerShell",
  ps1: "PowerShell",
  py: "Python",
  python: "Python",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  text: t("純文字"),
  plaintext: t("純文字"),
};

// Re-rendering a streamed fence creates one complete block. Code stays escaped
// text, so the copy action can read textContent without a second encoded payload.
markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = markdown.utils
    .unescapeAll(token.info)
    .trim()
    .split(/\s+/)[0];
  const normalizedLanguage = language.toLowerCase();
  const label = language
    ? Object.hasOwn(codeLanguages, normalizedLanguage)
      ? codeLanguages[normalizedLanguage]
      : language
    : t("純文字");
  const languageClass =
    language && /^[a-z0-9_+-]+$/i.test(language)
      ? ` class="language-${language}"`
      : "";
  return `<div class="code-block"><div class="code-header"><span class="code-language">${markdown.utils.escapeHtml(label)}</span><button class="copy-code" type="button" data-copy-code aria-label="${t("複製程式碼")}">${t("複製")}</button></div><pre tabindex="0" aria-label="${t("程式碼，可左右捲動")}"><code${languageClass}>${markdown.utils.escapeHtml(token.content)}</code></pre></div>\n`;
};
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};
// Do not automatically request model-supplied image URLs from a private workspace.
markdown.renderer.rules.image = (tokens, index) =>
  `<span class="markdown-image">${markdown.utils.escapeHtml(t("[圖片：{0}]", tokens[index].content || t("未提供說明")))}</span>`;
markdown.renderer.rules.table_open = () =>
  `<div class="markdown-table" role="region" aria-label="${t("表格，可左右捲動")}" tabindex="0"><table>`;
markdown.renderer.rules.table_close = () => "</table></div>\n";
// Use classes for alignment because the app's CSP disallows inline styles.
for (const name of ["th_open", "td_open"]) {
  markdown.renderer.rules[name] = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const alignment = String(token.attrGet("style") || "").match(
      /^text-align:(left|center|right)$/,
    )?.[1];
    if (token.attrs)
      token.attrs = token.attrs.filter(([name]) => name !== "style");
    if (alignment) token.attrSet("class", "align-" + alignment);
    return renderer.renderToken(tokens, index, options);
  };
}

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
