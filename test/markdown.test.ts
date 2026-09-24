import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../public/markdown.ts";

test("assistant Markdown supports headings, nested lists, quotes, code and aligned tables", () => {
  const html = renderMarkdown(
    '# 計畫\n\n**粗體**與 `npm run dev`\n\n1. 安裝\n   - 執行\n\n> 提醒\n\n```ts\nconst html = "<div>";\n```\n\n| 名稱 | 狀態 |\n| :--- | ---: |\n| Deep Agents | 可用 |',
  );
  for (const expected of [
    "<h1>計畫</h1>",
    "<strong>粗體</strong>",
    "<code>npm run dev</code>",
    "<ol>",
    "<ul>",
    "<blockquote>",
    '<code class="language-ts">',
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
  const complete = renderMarkdown('```ts\n  const tag = "<b>";\n```');
  assert.ok(
    complete.includes(
      '<code class="language-ts">  const tag = &quot;&lt;b&gt;&quot;;\n</code>',
    ),
  );
  assert.match(complete, /class="code-language">TypeScript<\/span>/);
  assert.match(complete, /<pre tabindex="0" aria-label="程式碼，可左右捲動">/);
  assert.match(renderMarkdown("第一行\n第二行"), /第一行<br>\n第二行/);
});

test("fenced code gets exactly one copy action per block during partial streaming", () => {
  for (const source of [
    "```",
    "```js",
    "```js\n",
    "```js\nalert('<script>');\n",
    "```js\nalert('<script>');\n``` ",
  ]) {
    const html = renderMarkdown(source);
    assert.equal(html.match(/class="code-block"/g)?.length, 1);
    assert.equal(html.match(/data-copy-code/g)?.length, 1);
    assert.match(html, /<button class="copy-code" type="button"/);
    assert.doesNotMatch(html, /<script>/);
  }
  const multiple = renderMarkdown("```\none\n```\n\n```ts\ntwo\n```");
  assert.equal(multiple.match(/data-copy-code/g)?.length, 2);
  assert.match(multiple, /class="code-language">純文字<\/span>/);
});

test("fence metadata and code cannot inject attributes, buttons, or active HTML", () => {
  const html = renderMarkdown(
    "```<img/src=x/onerror=alert(1)>\n</code></pre><script>alert(1)</script>\n<button data-copy-code>bad</button>\n```",
  );
  assert.doesNotMatch(
    html,
    /<(?:img|script)\b|class="language-<|<button data-copy-code/,
  );
  assert.match(html, /&lt;img\/src=x\/onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;\/code&gt;&lt;\/pre&gt;&lt;script&gt;/);
  assert.equal(html.match(/<button\b/g)?.length, 1);
  for (const language of ["__proto__", "constructor", "toString"]) {
    assert.ok(
      renderMarkdown(`\`\`\`${language}\ntext\n\`\`\``).includes(
        `class="code-language">${language}</span>`,
      ),
    );
  }
});
