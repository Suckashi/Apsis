import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../public/markdown.ts";

test("assistant Markdown supports headings, nested lists, quotes, code and aligned tables", () => {
  const html = renderMarkdown(
    '# 計畫\n\n**粗體**與 `npm run dev`\n\n1. 安裝\n   - 執行\n\n> 提醒\n\n```ts\nconst html = "<div>";\n```\n\n| 名稱 | 狀態 |\n| :--- | ---: |\n| Pi | 可用 |',
  );
  for (const expected of [
    "<h1>計畫</h1>",
    "<strong>粗體</strong>",
    "<code>npm run dev</code>",
    "<ol>",
    "<ul>",
    "<blockquote>",
    '<pre><code class="language-ts">',
    "&lt;div&gt;",
    "<table>",
    'class="align-right"',
  ])
    assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /style=/);
});

test("untrusted HTML and unsafe links cannot create active elements or image requests", () => {
  const html = renderMarkdown(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) [bad](vbscript:alert) [bad](data:text/html,test)\n\n![private](https://example.com/track)\n\n[safe](https://example.com "Example")',
  );
  assert.doesNotMatch(
    html,
    /<(script|img|iframe|svg)\b|href="(?:javascript|vbscript|data):/i,
  );
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\[圖片：private\]/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("partial streaming fences render safely and the complete source keeps code whitespace", () => {
  assert.match(renderMarkdown('```ts\nconst tag = "<'), /&lt;/);
  assert.equal(
    renderMarkdown('```ts\n  const tag = "<b>";\n```'),
    '<pre><code class="language-ts">  const tag = &quot;&lt;b&gt;&quot;;\n</code></pre>\n',
  );
  assert.match(renderMarkdown("第一行\n第二行"), /第一行<br>\n第二行/);
});
