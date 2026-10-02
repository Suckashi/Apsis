import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportDocx } from "../server/document-export.ts";
import { documentReadingNodes, previewDocx } from "../server/docx-preview.ts";
import type { DocumentNode } from "../shared/document-preview.ts";

const flat = (nodes: DocumentNode[]): Exclude<DocumentNode, string>[] =>
  nodes.flatMap((node) =>
    typeof node === "string" ? [] : [node, ...flat(node.children)],
  );

test("DOCX reading preview retains native headings, lists, table, emphasis and literal text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-docx-reading-"));
  const file = join(dir, "proposal.docx");
  await writeFile(
    file,
    await exportDocx(
      `# 文件標題\n\n## 第一章\n\n保留 **粗體** 與 *斜體*。\n\n- 第一項\n- 第二項\n\n| 書名 | 狀態 |\n| --- | --- |\n| 保留來源 | 已讀 |\n\n[參考](https://example.com/guide)\n\n<script>literal()</script>`,
      "proposal",
      "markdown",
    ),
  );
  const result = await previewDocx(file);
  assert.equal(result.truncated, false);
  assert.ok(result.document);
  const nodes = flat(result.document);
  assert.equal(nodes.filter((n) => n.tag === "h2").length, 1);
  assert.equal(nodes.filter((n) => n.tag === "h3").length, 1);
  assert.equal(nodes.filter((n) => n.tag === "li").length, 2);
  assert.equal(nodes.filter((n) => n.tag === "table").length, 1);
  assert.equal(nodes.filter((n) => n.tag === "tbody").length, 1);
  assert.ok(
    nodes.some((n) => n.tag === "strong" && n.children.includes("粗體")),
  );
  assert.equal(nodes.filter((n) => n.tag === "th").length, 2);
  assert.equal(nodes.filter((n) => n.tag === "td").length, 2);
  assert.equal(nodes.filter((n) => n.tag === "em").length, 1);
  assert.equal(
    nodes.find((n) => n.tag === "a")?.href,
    "https://example.com/guide",
  );
  assert.ok(
    JSON.stringify(result.document).includes("<script>literal()</script>"),
  );
  assert.ok(result.text.includes("保留來源"));
});

test("document structure drops executable markup, URLs, style and clobbering attributes", () => {
  const result = documentReadingNodes(
    `<h1 id="safe">Title</h1><p onclick="run()" style="color:red">Text &amp; retained</p><a href="javascript:run()">unsafe link</a><a href="data:text/html,attack">data</a><a href="https://example.com">safe link</a><a href="#safe">note</a><img src="https://example.com/track" alt="Image description"/><script>attack()</script><style>body{display:none}</style><iframe src="https://example.com"/><table><tr><td colspan="2" rowspan="3">cell</td></tr></table>`,
  );
  const json = JSON.stringify(result);
  assert.doesNotMatch(
    json,
    /javascript:|data:text|onclick|color:red|attack\(\)|track|display:none/,
  );
  assert.ok(json.includes("unsafe link"));
  assert.ok(json.includes("Image description"));
  assert.ok(json.includes("Text & retained"));
  const nodes = flat(result);
  assert.deepEqual(
    nodes.filter((n) => n.tag === "a").map((n) => n.href),
    ["https://example.com/", "#safe"],
  );
  assert.equal(nodes.find((n) => n.tag === "td")?.colSpan, 2);
  assert.equal(nodes.find((n) => n.tag === "td")?.rowSpan, 3);
});

test("reading structure bounds reject excessive nesting rather than dropping unseen content", () => {
  assert.throws(
    () =>
      documentReadingNodes(
        "<p>" +
          "<strong>".repeat(70) +
          "deep" +
          "</strong>".repeat(70) +
          "</p>",
      ),
    /structure too large/,
  );
  assert.throws(
    () => documentReadingNodes("x".repeat(500_001)),
    /preview too large/,
  );
  assert.throws(
    () => documentReadingNodes("<p>broken</h1>"),
    /Invalid document fragment/,
  );
});

test("document parsing rejects warnings, unknown entities and mismatched tags", () => {
  for (const fragment of [
    "<p class=bare>unquoted attribute</p>",
    "<p>&missing;</p>",
    "<p>broken</h1>",
  ]) {
    assert.throws(
      () => documentReadingNodes(fragment),
      /Invalid document fragment/,
      fragment,
    );
  }
});

test("oversized DOCX text explicitly falls back to bounded text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-docx-limit-"));
  const file = join(dir, "long.docx");
  await writeFile(
    file,
    await exportDocx("內容".repeat(60_000), "long", "plain"),
  );
  const result = await previewDocx(file);
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, 100_000);
  assert.equal(result.document, undefined);
});
