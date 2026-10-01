import assert from "node:assert/strict";
import { once } from "node:events";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import MarkdownIt from "markdown-it";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { exportDocx } from "../server/document-export.ts";
import type { Artifact } from "../shared/product.ts";
import type { Workspace } from "../server/workspace.ts";
import { fixtureStyle } from "./browser-style.ts";
import { reviewPreviewContrast } from "./preview-contrast.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-document-reading-"));
const output = resolve("artifacts/document-reading");
await mkdir(output, { recursive: true });
const proposal = await readFile(
  resolve("test/fixtures/reading-list-proposal.md"),
  "utf8",
);
const content = `${proposal}\n\n## 閱讀範例\n\n保留 **重要內容** 與 *閱讀層級*。\n\n| 書名 | 作者 | 狀態 | 心得 |\n| --- | --- | --- | --- |\n| 第一份完整文件 | 測試作者 | 已讀 | 保留原始段落與最後一欄的完整內容 |\n| 第二份完整文件 | 另一位作者 | 閱讀中 | 手機可以左右捲動表格 |\n\n[參考說明](https://example.invalid/guide)\n\n[不安全的連結](javascript:alert(1))\n\n<script>window.fixtureAttack=1</script>\n\n## 文件末尾\n\n最後一段內容保留。`;
let artifact: Artifact;
let workspace: Workspace;
let calls = 0;
const filename = "閱讀提案.docx";
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    calls++;
    workspace = options.workspace;
    const tools = createTools(options);
    const result = await tools
      .find((tool) => tool.name === "create_document")!
      .execute(
        crypto.randomUUID(),
        { format: "docx", name: filename, content, content_format: "markdown" },
        options.signal,
      );
    artifact = JSON.parse(
      result.content.find((block) => block.type === "text")!.text,
    );
    await copyFile(
      await workspace.resolve(artifact.path),
      await workspace.resolve(filename, true),
    );
    return { text: "文件閱讀成果已交付。" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
await app.product.bots.create("文件閱讀夥伴");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
const blocks = new MarkdownIt()
  .parse(proposal, {})
  .filter((token) => token.type === "inline")
  .map((token) => token.content.replace(/\s+/g, ""));
try {
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const theme of ["light", "dark"]) {
      const sizes = [
        { width: 1440, height: 900, scale: 1 },
        { width: 375, height: 812, scale: 1 },
      ];
      if (locale === "en" && theme === "dark")
        sizes.push(
          { width: 375, height: 812, scale: 2 },
          { width: 812, height: 375, scale: 2 },
        );
      for (const size of sizes) {
        const name = `${size.width}-${size.height}-${locale}-${theme}-${size.scale}x`;
        const context = await browser.newContext({
          viewport: size,
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ theme, locale }) => {
            localStorage.setItem("apsis.theme", theme);
            localStorage.setItem("apsis.locale", locale);
          },
          { theme, locale },
        );
        const page = await context.newPage();
        const errors: string[] = [],
          externalRequests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await context.route("https://example.invalid/**", (route) => {
          externalRequests.push(route.request().url());
          return route.abort();
        });
        await page.goto(base);
        const input = page.getByRole("textbox", {
          name: /^(傳送訊息|Send message)$/,
        });
        if (!calls) {
          await input.fill("建立可閱讀的文件");
          await page.getByRole("button", { name: /^(傳送|Send)$/ }).click();
        }
        const card = page.getByRole("button", {
          name: new RegExp(`^(預覽成果|Preview result) ${filename}`),
        });
        await expect(card).toBeVisible();
        if (size.scale === 2)
          await fixtureStyle(page, {
            content: "html {font-size:200% !important;}",
          });
        await input.fill("保留下一句草稿");
        for (const surface of ["published", "working"]) {
          if (surface === "published") await card.click();
          else {
            await page
              .locator(".artifact-preview")
              .getByRole("button", { name: /^(返回檔案|Back to files)$/ })
              .click();
            await page
              .locator(".file-tree")
              .getByRole("button", { name: filename, exact: true })
              .click();
          }
          const root = page.locator(".file-panel.file-preview");
          const reading = root.locator(".document-reading");
          await expect(reading.locator("h2")).toHaveText(
            "共用讀書清單（小團隊版）專案提案",
          );
          await expect(reading.locator("h3")).toHaveCount(7);
          await expect(reading.locator("li")).toHaveCount(23);
          await expect(reading.locator("table")).toHaveCount(1);
          await expect(reading.locator("th")).toHaveCount(4);
          await expect(reading.locator("td")).toHaveCount(8);
          await expect(reading.locator("strong")).toContainText(["重要內容"]);
          await expect(reading.locator("em")).toHaveText("閱讀層級");
          const text = (await reading.innerText()).replace(/\s+/g, "");
          for (const block of blocks)
            assert.ok(text.includes(block), `${name}: ${block}`);
          assert.ok(text.includes("<script>window.fixtureAttack=1</script>"));
          assert.equal(
            await reading
              .locator("script,img,iframe,[onclick],a[href^='javascript:']")
              .count(),
            0,
          );
          await expect(
            reading.getByRole("link", { name: "參考說明", exact: true }),
          ).toHaveAttribute("rel", "noreferrer noopener");
          for (const expanded of [false, true]) {
            if (expanded)
              await root
                .getByRole("button", { name: /^(展開預覽|Expand preview)$/ })
                .click();
            const table = reading.locator(".markdown-table");
            await table.focus();
            if (size.width < 900) {
              for (let step = 0; step < 32; step++)
                await table.press("ArrowRight");
              await expect
                .poll(() => table.evaluate((el) => el.scrollLeft))
                .toBeGreaterThan(0);
              await expect
                .poll(() =>
                  table.evaluate((el) =>
                    Math.abs(el.scrollWidth - el.clientWidth - el.scrollLeft),
                  ),
                )
                .toBeLessThan(2);
              await expect(
                reading.getByText("手機可以左右捲動表格", { exact: true }),
              ).toBeVisible();
            }
            const body = root.locator(".file-content");
            await body.focus();
            await body.press("Home");
            await expect
              .poll(() => body.evaluate((el) => el.scrollTop))
              .toBe(0);
            const startAudit = await new AxeBuilder({ page }).analyze();
            await writeFile(
              join(
                output,
                `${name}-${surface}-${expanded ? "expanded" : "inline"}-axe.json`,
              ),
              JSON.stringify(startAudit, null, 2),
            );
            assert.deepEqual(startAudit.violations, [], name);
            const paintReview = await reviewPreviewContrast(
              page,
              startAudit,
              name,
            );
            await page.screenshot({
              path: join(
                output,
                `${name}-${surface}-${expanded ? "expanded" : "inline"}.png`,
              ),
            });
            await body.press("End");
            await expect
              .poll(() =>
                body.evaluate((el) =>
                  Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
                ),
              )
              .toBeLessThan(2);
            await expect(
              reading.getByText("最後一段內容保留。", { exact: true }),
            ).toBeVisible();
            const tailIsReadable = await reading
              .getByText("最後一段內容保留。", { exact: true })
              .evaluate((node) => {
                const bounds = node.getBoundingClientRect();
                const bodyBounds = node
                  .closest(".file-content")!
                  .getBoundingClientRect();
                return (
                  bounds.top >= bodyBounds.top &&
                  bounds.bottom <= bodyBounds.bottom
                );
              });
            assert.equal(tailIsReadable, true, `${name}: document tail`);
            const controls = await root
              .locator(
                ".file-preview-header button,.file-preview-header a,.file-preview-header summary",
              )
              .evaluateAll((nodes) =>
                nodes.map((node) => {
                  const r = node.getBoundingClientRect();
                  return {
                    label: node.getAttribute("aria-label") || node.textContent,
                    width: r.width,
                    height: r.height,
                    visible:
                      r.x >= 0 &&
                      r.y >= 0 &&
                      r.right <= innerWidth &&
                      r.bottom <= innerHeight,
                    onTop: node.contains(
                      document.elementFromPoint(
                        r.x + r.width / 2,
                        r.y + r.height / 2,
                      ),
                    ),
                  };
                }),
              );
            assert.ok(
              controls.every(
                (control) =>
                  control.width >= 44 &&
                  control.height >= 44 &&
                  control.visible &&
                  control.onTop,
              ),
              JSON.stringify(controls),
            );
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              true,
            );
            reports.push({
              name,
              surface,
              expanded,
              violations: startAudit.violations,
              incomplete: startAudit.incomplete,
              paintReview,
              controls,
            });
            if (expanded) {
              await page.keyboard.press("Escape");
              await expect(
                root.getByRole("button", {
                  name: /^(展開預覽|Expand preview)$/,
                }),
              ).toBeFocused();
            }
          }
        }
        await page
          .getByRole("button", {
            name: /^(關閉工作內容|Close work inspector)$/,
          })
          .click();
        await expect(input).toHaveValue("保留下一句草稿");
        assert.deepEqual(errors, []);
        assert.deepEqual(externalRequests, []);
        await context.close();
      }
    }
  }
  const snapshot = await readFile(
    join(directory, "data", "artifacts", artifact!.snapshotPath!),
  );
  const replacement = await exportDocx(
    "# 工作檔已更新\n\n新的工作內容。",
    "replacement",
    "markdown",
  );
  await writeFile(await workspace!.resolve(artifact!.path), replacement);
  await writeFile(await workspace!.resolve(filename), replacement);
  const saved = await (
    await fetch(`${base}/api/v2/artifacts/${artifact!.id}/preview`)
  ).json();
  assert.ok(saved.content.includes("最後一段內容保留。"));
  assert.ok(!saved.content.includes("新的工作內容。"));
  const downloaded = Buffer.from(
    await (
      await fetch(`${base}/api/v2/artifacts/${artifact!.id}`)
    ).arrayBuffer(),
  );
  assert.deepEqual(downloaded, snapshot);
  const location = artifact!.location!.id;
  const changed = await (
    await fetch(
      `${base}/api/v2/work-locations/${location}/preview?path=${encodeURIComponent(filename)}`,
    )
  ).json();
  assert.ok(changed.text.includes("新的工作內容。"));
  assert.ok(changed.document);
  assert.equal(calls, 1);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        fixtureOnly: true,
        profiles: 10,
        reports,
        immutableSnapshot: true,
        workingFileUpdate: true,
        externalRequests: [],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 10 DOCX reading profiles, 40 working/published views, headings/lists/emphasis/tables, all source blocks, keyboard scrolling, drafts, immutable download and no external requests/errors.",
  );
} finally {
  await browser.close();
  await app.close();
}
