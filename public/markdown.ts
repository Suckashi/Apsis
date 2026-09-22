import MarkdownIt from "markdown-it";

// Model output is untrusted: raw HTML stays text, and unsafe link schemes are rejected.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderer.renderToken(tokens, index, options);
};
// Do not automatically request model-supplied image URLs from a private workspace.
markdown.renderer.rules.image = (tokens, index) =>
  `<span class="markdown-image">[圖片：${markdown.utils.escapeHtml(tokens[index].content || "未提供說明")}]</span>`;
markdown.renderer.rules.table_open = () =>
  '<div class="markdown-table" role="region" aria-label="表格，可左右捲動" tabindex="0"><table>';
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
