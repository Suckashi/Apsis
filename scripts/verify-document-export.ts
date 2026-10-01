import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { convertToHtml } from "mammoth";
import MarkdownIt from "markdown-it";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { toolSchema } from "../server/engines/common.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { Artifact } from "../shared/product.ts";
import { fixtureStyle } from "./browser-style.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-document-export-ui-"));
const output = resolve("artifacts/document-export");
await mkdir(output, { recursive: true });
// The exact fictional proposal from the live comparison; no private user source.
const content = await readFile(
  resolve("test/fixtures/reading-list-proposal.md"),
  "utf8",
);
const exports: (Artifact & {
  document: { pageCount?: number; layoutVerified: boolean };
})[] = [];
let originalPromptCount = 0;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    originalPromptCount++;
    const tools = createTools(options);
    const list = tools.find((tool) => tool.name === "list_files")!;
    await list.execute(randomUUID(), { path: "." }, options.signal);
    const create = tools.find((tool) => tool.name === "create_document")!;
    const schema = toolSchema(create);
    await options.workspace.write("proposal.md", content);
    assert.ok(
      schema.safeParse({
        format: "pdf",
        name: "source",
        source_path: "proposal.md",
      }).success,
    );
    assert.ok(
      schema.safeParse({ format: "docx", name: "literal", content }).success,
    );
    assert.equal(
      schema.safeParse({
        format: "pdf",
        name: "bad",
        content,
        content_format: 42,
      }).success,
      false,
    );
    for (const format of ["docx", "pdf"]) {
      const result = await create.execute(
        randomUUID(),
        schema.parse({
          format,
          name: `uiux-document-20261001/共用讀書清單.${format}`,
          ...(format === "pdf"
            ? { source_path: "proposal.md" }
            : { content, content_format: "markdown" }),
        }),
        options.signal,
      );
      const text = result.content.find((block) => block.type === "text");
      assert.ok(text);
      exports.push(JSON.parse(text.text));
    }
    return { text: "已建立兩份文件。請預覽或下載檢查內容與版面。" };
  },
});
const connection = await app.connections.save({
  name: "Document fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: "fixture",
});
await app.product.bots.create("文件交付驗證");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ executablePath: browserExecutable() });
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill("匯出提案");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const message = page.locator(".message.assistant").last();
  await expect(message.locator(":scope > .message-body")).toContainText(
    "已建立兩份文件",
    { timeout: 30_000 },
  );
  assert.equal(originalPromptCount, 1);
  assert.equal(exports.length, 2);
  const downloads: Record<string, Buffer> = {};
  for (const format of ["docx", "pdf"]) {
    const name = `共用讀書清單.${format}`;
    const artifact = exports.find((entry) => entry.name === name)!;
    assert.ok(artifact, `Normalized exported filename: ${name}`);
    assert.equal(artifact.document.layoutVerified, false);
    const wait = page.waitForEvent("download");
    await message
      .getByRole("link", { name: `下載成果 ${name}`, exact: true })
      .click();
    const download = await wait;
    assert.equal(download.suggestedFilename(), name);
    const file = await download.path();
    assert.ok(file);
    const bytes = await readFile(file);
    const saved = await readFile(
      join(directory, "data", "artifacts", artifact.snapshotPath!),
    );
    assert.deepEqual(bytes, saved);
    downloads[format] = bytes;
    await writeFile(join(output, `formatted-brief.${format}`), bytes);
  }
  const docx = await convertToHtml(
    { buffer: downloads.docx },
    { styleMap: ["p[style-name='Title'] => h1:fresh"] },
  );
  assert.match(docx.value, /<h1>共用讀書清單（小團隊版）專案提案<\/h1>/);
  assert.equal((docx.value.match(/<h2>/g) || []).length, 5);
  assert.equal((docx.value.match(/<li>/g) || []).length, 23);
  assert.doesNotMatch(docx.value, /## |\*\*/);
  const loading = getDocument({ data: new Uint8Array(downloads.pdf) });
  let pdfPages = 0;
  let pdfText = "";
  let tagged = false;
  let outlineEntries = 0;
  try {
    const pdf = await loading.promise;
    pdfPages = pdf.numPages;
    assert.equal(
      pdfPages,
      1,
      "The unchanged proposal must fit one readable page",
    );
    assert.equal(
      exports.find((entry) => entry.mime === "application/pdf")!.document
        .pageCount,
      pdfPages,
    );
    for (let i = 1; i <= pdfPages; i++) {
      const docPage = await pdf.getPage(i);
      pdfText += (await docPage.getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      tagged ||= !!(await docPage.getStructTree());
    }
    const outline = await pdf.getOutline();
    const countOutline = (items: NonNullable<typeof outline>): number =>
      items.reduce((count, item) => count + 1 + countOutline(item.items), 0);
    outlineEntries = countOutline(outline || []);
  } finally {
    await loading.destroy();
  }
  const keywords = [
    "書名",
    "作者",
    "狀態",
    "心得",
    "篩選",
    "登入",
    "同步",
    "付費",
    "分享",
    "驗收",
  ];
  // PDF extraction may split font runs and use compatibility radicals.
  const comparable = pdfText.normalize("NFKC").replace(/\s+/g, "");
  for (const keyword of keywords)
    assert.ok(comparable.includes(keyword), keyword);
  const blocks = new MarkdownIt()
    .parse(content, {})
    .filter((token) => token.type === "inline")
    .map((token) => token.content.normalize("NFKC").replace(/\s+/g, ""));
  const docxText = docx.value
    .replace(/<[^>]+>/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
  for (const block of blocks) {
    assert.ok(
      comparable.includes(block),
      `PDF retains complete text: ${block}`,
    );
    assert.ok(docxText.includes(block), `DOCX retains complete text: ${block}`);
  }
  assert.ok(tagged);
  assert.ok(outlineEntries);
  await message
    .getByRole("button", { name: "預覽成果 共用讀書清單.docx", exact: true })
    .click();
  await expect(
    page.locator(".artifact-preview .document-reading"),
  ).toContainText("共用讀書清單");
  await expect(
    page.locator(".artifact-preview .document-reading h2"),
  ).toHaveText("共用讀書清單（小團隊版）專案提案");
  await expect(
    page.locator(".artifact-preview .document-reading h3"),
  ).toHaveCount(5);
  await expect(
    page.locator(".artifact-preview .document-reading li"),
  ).toHaveCount(23);
  await page
    .getByText("此預覽保留文件結構；圖片與列印版面請下載查看。", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: join(output, "docx-preview-desktop.png") });
  await message
    .getByRole("button", { name: "預覽成果 共用讀書清單.pdf", exact: true })
    .click();
  await page.locator(".artifact-preview .file-pdf").waitFor();
  await page.screenshot({ path: join(output, "pdf-preview-desktop.png") });
  await page.reload();
  await page
    .getByRole("button", { name: "預覽成果 共用讀書清單.pdf", exact: true })
    .waitFor();
  const phone = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "dark",
  });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(base);
  await mobile
    .getByRole("button", { name: "預覽成果 共用讀書清單.docx", exact: true })
    .click();
  await expect(
    mobile.locator(".artifact-preview .document-reading"),
  ).toContainText("驗收條件");
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await mobile.screenshot({ path: join(output, "docx-preview-phone.png") });
  await mobile
    .getByRole("button", { name: "關閉工作內容", exact: true })
    .click();
  // Revisions originate from actual native publications, never filename guesses.
  const original = exports.find((a) => a.name.endsWith(".docx"))!;
  const bot = app.product.bots.bot(original.botId);
  const revised = await app.product.artifacts.createDocument(
    bot,
    original.runId!,
    {
      format: "docx",
      name: "共用讀書清單",
      content: `${content}\n\n修訂版二的確認文字。`,
      content_format: "markdown",
    },
  );
  await expect(
    message.getByRole("button", {
      name: "預覽成果 共用讀書清單.docx · 第 2 版",
      exact: true,
    }),
  ).toBeVisible();
  const previous = message.locator(".artifact-previous");
  await expect(previous).toHaveCount(1);
  await expect(previous).not.toHaveAttribute("open", "");
  await previous.locator("summary").focus();
  await previous.locator("summary").press("Enter");
  await expect(previous).toHaveAttribute("open", "");
  await previous.locator("summary").press("Enter");
  await expect(previous).not.toHaveAttribute("open", "");
  await previous.locator("summary").click();
  const latest = await app.product.artifacts.createDocument(
    bot,
    original.runId!,
    {
      format: "docx",
      name: "共用讀書清單",
      content: `${content}\n\n修訂版三的確認文字。`,
      content_format: "markdown",
    },
  );
  await expect(
    message.getByRole("button", {
      name: "預覽成果 共用讀書清單.docx · 第 3 版",
      exact: true,
    }),
  ).toBeVisible();
  await expect(previous).toHaveAttribute("open", "");
  await expect(previous.locator("summary")).toHaveText("先前版本（2）");
  for (const [artifact, bytes] of [
    [original, downloads.docx],
    [revised, undefined],
    [latest, undefined],
  ] as const) {
    const downloading = page.waitForEvent("download");
    await message
      .getByRole("link", {
        name: `下載成果 ${artifact.name} · 第 ${artifact.document!.revision} 版`,
        exact: true,
      })
      .click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), artifact.name);
    const downloaded = await readFile((await download.path())!);
    assert.deepEqual(
      downloaded,
      await readFile(
        join(directory, "data", "artifacts", artifact.snapshotPath!),
      ),
    );
    if (bytes)
      assert.deepEqual(
        downloaded,
        bytes,
        "Original publication snapshot is unchanged",
      );
  }
  await message
    .getByRole("button", {
      name: "預覽成果 共用讀書清單.docx · 第 1 版",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".artifact-preview .artifact-version"),
  ).toContainText("第 1 版");
  await expect(
    page.locator(".artifact-preview .document-reading"),
  ).not.toContainText("修訂版");
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await page.reload();
  await expect(
    message.getByRole("button", {
      name: "預覽成果 共用讀書清單.docx · 第 3 版",
      exact: true,
    }),
  ).toBeVisible();
  await expect(previous).not.toHaveAttribute("open", "");
  const profiles: string[] = [];
  const accessibility = [];
  const deliveryLayouts: unknown[] = [];
  const checkDeliveryLayout = async (profile: string) => {
    const list = message.locator(":scope > .artifact-deliveries");
    await expect(list).toHaveAttribute("role", "list");
    await expect(list.locator(":scope > li")).toHaveCount(2);
    await expect(list.locator(".artifact-previous > ul > li")).toHaveCount(2);
    const controls = [];
    for (const control of await list
      .locator("button:visible,a:visible,summary:visible")
      .all()) {
      await control.scrollIntoViewIfNeeded();
      const geometry = await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") || el.textContent,
          width: r.width,
          height: r.height,
          visible:
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= innerWidth &&
            r.bottom <= innerHeight,
          onTop: el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
        };
      });
      assert.ok(
        geometry.width >= 44 &&
          geometry.height >= 44 &&
          geometry.visible &&
          geometry.onTop,
        `${profile}: ${JSON.stringify(geometry)}`,
      );
      controls.push(geometry);
    }
    assert.equal(
      controls.length,
      9,
      `${profile}: four files and revision disclosure`,
    );
    const last = list.locator(":scope > li").last();
    await last.locator("button.artifact-card").focus();
    await page.keyboard.press("Tab");
    await expect(last.locator("a.artifact-download")).toBeFocused();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const axe = await new AxeBuilder({ page })
      .include(".artifact-deliveries")
      .analyze();
    assert.deepEqual(axe.violations, [], profile);
    assert.deepEqual(axe.incomplete, [], profile);
    deliveryLayouts.push({
      profile,
      controls,
      violations: axe.violations,
      incomplete: axe.incomplete,
    });
    await page.screenshot({ path: join(output, `deliveries-${profile}.png`) });
  };
  for (const language of ["zh-Hant", "en"] as const)
    for (const theme of ["light", "dark"])
      for (const width of [1440, 375]) {
        app.product.settings.update(
          { locale: language },
          app.product.settings.read().revision,
        );
        await page.setViewportSize({
          width,
          height: width === 375 ? 812 : 900,
        });
        await page.evaluate(
          ({ language, theme }) => {
            localStorage.setItem("apsis.locale", language);
            localStorage.setItem("apsis.theme", theme);
          },
          { language, theme },
        );
        await page.reload();
        const summary = message.locator(".artifact-previous > summary");
        assert.ok(
          (await summary.getAttribute("aria-label"))!.includes(
            "共用讀書清單.docx",
          ),
        );
        await summary.click();
        const box = (await summary.boundingBox())!;
        assert.ok(box.height >= 44, "Revision disclosure keeps a touch target");
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.equal(
          await message.locator(".artifact-delivery:visible").count(),
          4,
        );
        const expected = language === "en" ? "Version 3" : "第 3 版";
        await expect(message.locator(".artifact-series").first()).toContainText(
          expected,
        );
        const profile = `${language}-${theme}-${width}`;
        await checkDeliveryLayout(profile);
        const axe = await new AxeBuilder({ page })
          .include(".artifact-deliveries")
          .analyze();
        assert.deepEqual(axe.violations, []);
        assert.deepEqual(axe.incomplete, []);
        accessibility.push({ profile, violations: 0, incomplete: 0 });
        profiles.push(profile);
        await page.screenshot({
          path: join(output, `revisions-${profile}.png`),
        });
        if (language === "en" && width === 375 && theme === "dark") {
          await fixtureStyle(page, {
            content: "html {font-size:200% !important;}",
          });
          assert.ok(
            await page.evaluate(
              () =>
                parseFloat(
                  getComputedStyle(document.documentElement).fontSize,
                ) >= 32,
            ),
          );
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          await page.screenshot({
            path: join(output, "revisions-en-dark-375-200pct.png"),
          });
          await checkDeliveryLayout("en-dark-375-200pct");
          await page.setViewportSize({ width: 812, height: 375 });
          await checkDeliveryLayout("en-dark-812-200pct");
        }
      }
  assert.equal(originalPromptCount, 1);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        fixtureOnly: true,
        externalModelTask: false,
        source: "same fictional live-comparison Markdown, unchanged",
        isolatedBrowserDownloadVerified: true,
        userChromeDownloadVerified: false,
        snapshotBytesMatch: true,
        docx: {
          nativeTitle: true,
          headingCount: 5,
          listItems: 23,
          rendered: false,
        },
        pdf: {
          pages: pdfPages,
          tagged,
          outlineEntries,
          keywordChecks: keywords.length,
          completeTextChecks: blocks.length,
          visuallyInspected: false,
        },
        originalPromptCount,
        sourceConversion: true,
        revisions: {
          threeVersions: true,
          isolatedDownloadsMatch: true,
          originalSnapshotUnchanged: true,
          disclosureSurvivesUpdates: true,
          reloadVerified: true,
          profiles,
          accessibility,
          deliveryLayouts,
        },
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Document export browser verification passed: DOCX headings/lists, PDF ${pdfPages} page(s), ${keywords.length} keyword checks, two matching downloads, reload and phone preview.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
