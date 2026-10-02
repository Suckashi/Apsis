import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToHtml, extractRawText } from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  documentHtml,
  exportDocx,
  exportPdf,
} from "../server/document-export.ts";

const content = `# 讀書清單專案提案

## 目標

保留 **本機資料**，可以 *編輯* 與依狀態篩選。

3. 第一個步驟
4. 第二個步驟
   - 子項目
5. 第三個步驟

- 第一份清單

- 第二份清單

| 狀態 | 說明 |
| --- | --- |
| 已讀 | 留下心得 |

> 限本機使用。

閱讀 [官方說明](https://example.com/guide)。

\`\`\`text
# 程式碼保持原樣
\`\`\`

![圖例](https://example.com/private.png)

<script>shouldStayText()</script>`;

test("formatted DOCX retains native headings, emphasis, lists and table content", async () => {
  const buffer = await exportDocx(content, "讀書清單", "markdown");
  const { value } = await convertToHtml(
    { buffer },
    { styleMap: ["p[style-name='Title'] => h1:fresh"] },
  );
  assert.match(value, /<h1>讀書清單專案提案<\/h1>/);
  assert.match(value, /<h2>目標<\/h2>/);
  assert.match(value, /<strong>本機資料<\/strong>/);
  assert.match(value, /<em>編輯<\/em>/);
  assert.match(value, /<ol>[\s\S]*第一個步驟[\s\S]*第三個步驟[\s\S]*<\/ol>/);
  assert.match(value, /<ul>[\s\S]*子項目[\s\S]*<\/ul>/);
  assert.match(value, /<table>[\s\S]*已讀[\s\S]*留下心得[\s\S]*<\/table>/);
  assert.match(value, /href="https:\/\/example.com\/guide"/);
  assert.match(value, /# 程式碼保持原樣/);
  assert.match(value, /\[圖片：圖例\]/);
  assert.match(value, /&lt;script&gt;shouldStayText\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(value, /<img|<script>/);
  assert.doesNotMatch(value, /## 目標|\*\*本機資料\*\*/);
});

test("plain export preserves literal Markdown and newlines", async () => {
  const literal = "# 原始文字\n\n**不轉換粗體**\n最後一行";
  const buffer = await exportDocx(literal, "原始文字", "plain");
  assert.match((await extractRawText({ buffer })).value, /# 原始文字/);
  assert.match((await extractRawText({ buffer })).value, /\*\*不轉換粗體\*\*/);
  const html = documentHtml(literal, "<標題>", "plain");
  assert.match(html, /<title>&lt;標題&gt;<\/title>/);
  assert.match(html, /class="plain"># 原始文字\n\n\*\*不轉換粗體\*\*/);
});

test("PDF reports actual pages, tagged structure and text without fetching supplied media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-document-export-"));
  const file = join(directory, "reading-list.pdf");
  const pageCount = await exportPdf(file, content, "讀書清單", "markdown");
  const loading = getDocument({ data: new Uint8Array(await readFile(file)) });
  try {
    const pdf = await loading.promise;
    assert.equal(pageCount, pdf.numPages);
    assert.equal(pageCount, 1);
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    assert.match(text, /讀書清單專案提案/);
    assert.match(text, /本機資料/);
    assert.match(text, /3\./);
    assert.match(text.normalize("NFKC").replace(/\s/g, ""), /\[圖片:圖例\]/);
    assert.doesNotMatch(text, /\*\*本機資料\*\*|## 目標/);
    assert.ok(await page.getStructTree());
    assert.ok((await pdf.getOutline())?.length);
  } finally {
    await loading.destroy();
  }
  const html = documentHtml(content, "讀書清單", "markdown");
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /default-src 'none'/);
});

test("cancelled PDF export never starts rendering", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    exportPdf("unused.pdf", content, "讀書清單", "markdown", controller.signal),
    { name: "AbortError" },
  );
});
