import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Locator } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { createTools } from "../server/tools.ts";
import { fixtureStyle } from "./browser-style.ts";
import { reviewPreviewContrast } from "./preview-contrast.ts";

const baseline = process.argv.includes("--baseline");
const output = resolve("artifacts/markdown-reading");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-markdown-reading-"));
const code =
  '  const greeting = "你好 <reader> & friends";\n' +
  '  const source = "' +
  "長內容 / readable code / ".repeat(12) +
  '";\n';
const content =
  "## 閱讀與交付\n\n保留原始內容，讓成果更容易閱讀和使用。\n\n" +
  "```ts\n" +
  code +
  "```\n\n" +
  "| 文件 | 狀態 | 負責人 | 驗收 | 日期 | 備註 |\n" +
  "| :--- | :---: | :--- | :--- | ---: | :--- |\n" +
  "| 繁體中文閱讀清單 | 完成 | Reading assistant | 保留全部內容 | 2026-10-01 | 確認預覽與下載 |\n" +
  "| Unicode & punctuation | 待確認 | Another teammate | Keyboard navigation | 2026-10-02 | Review the full source |\n\n" +
  "```text\n第二段程式碼\n  exact whitespace\n```\n\n" +
  "<script>window.__unsafeMarkdown = true</script>\n\n" +
  "![No remote request](https://example.invalid/private-tracker.png)";
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    options.emit({ type: "commentary", id: "reading-note", text: content });
    const publish = createTools(options).find(
      (tool) => tool.name === "publish_file",
    )!;
    await publish.execute(
      crypto.randomUUID(),
      { path: "reading.md", name: "閱讀成果.md" },
      options.signal,
    );
    return { text: content };
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
  model: "fixture",
});
const bot = await app.product.bots.create("閱讀助理");
const location = app.product.workLocation(bot);
await app.product.files.save(location.id, "reading.md", content, null);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: unknown[] = [];
try {
  for (const locale of baseline
    ? (["zh-Hant"] as const)
    : (["zh-Hant", "en"] as const)) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const theme of baseline
      ? (["light"] as const)
      : (["light", "dark"] as const)) {
      const sizes: { width: number; height: number; fontScale?: number }[] = [
        { width: 1440, height: 900 },
        ...(!baseline ? [{ width: 1024, height: 768 }] : []),
        { width: 375, height: 812 },
      ];
      if (!baseline && locale === "en" && theme === "dark")
        sizes.push(
          { width: 1440, height: 900, fontScale: 2 },
          { width: 375, height: 812, fontScale: 2 },
          { width: 812, height: 375, fontScale: 2 },
        );
      for (const size of sizes) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: theme,
          reducedMotion: "reduce",
          permissions: ["clipboard-read", "clipboard-write"],
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
          const writes: string[] = [];
          Object.assign(window, { __markdownWrites: writes });
          const state = {
            fail: false,
            hold: false,
            completed: 0,
            release: () => {},
          };
          Object.assign(window, { __markdownClipboard: state });
          const write = navigator.clipboard.writeText.bind(navigator.clipboard);
          navigator.clipboard.writeText = async (value: string) => {
            writes.push(value);
            if (state.fail)
              throw new DOMException(
                "Fixture clipboard denied",
                "NotAllowedError",
              );
            if (state.hold)
              await new Promise<void>((resolve) => {
                state.release = resolve;
              });
            await write(value);
            state.completed++;
          };
        });
        const errors: string[] = [];
        const remoteRequests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("request", (request) => {
          if (request.url().startsWith("https://example.invalid"))
            remoteRequests.push(request.url());
        });
        await page.goto(base);
        if (size.fontScale)
          await fixtureStyle(page, {
            content: "html { font-size: 200% !important }",
          });
        const input = page.getByRole("textbox", {
          name: locale === "en" ? "Send message" : "傳送訊息",
          exact: true,
        });
        await expect(input).toBeVisible();
        // Submit one deterministic reply only. Subsequent profiles inspect the
        // same saved conversation rather than creating extra runs.
        if (app.product.db.all("job").length === 0) {
          await input.fill("請整理閱讀內容");
          await page.locator(".composer-send-actions .send").click();
        }
        const reply = page
          .locator(".message.assistant > .message-body > .markdown")
          .first();
        await expect(reply.locator(".code-block")).toHaveCount(2);
        await expect(page.locator(".header-profile small")).toHaveAttribute(
          "data-phase",
          "ready",
        );
        await expect(page.locator(".header-profile small")).toBeHidden();
        await input.fill("保留下一句草稿");
        const measurements: unknown[] = [];
        const scopes: Record<string, string> = {
          reply: ".message.assistant .message-body > .markdown",
          record: ".work-commentary",
          file: ".file-content > .markdown",
          published: ".artifact-preview .markdown",
        };
        const inspect = async (root: Locator, surface: string) => {
          const block = root.locator(".code-block").first();
          const button = block.locator(".copy-code");
          await button.scrollIntoViewIfNeeded();
          const geometry = await block.evaluate((element) => {
            const button = element.querySelector("button")!;
            const pre = element.querySelector("pre")!;
            const code = pre.querySelector("code")!;
            const bounds = button.getBoundingClientRect();
            return {
              width: bounds.width,
              height: bounds.height,
              fontSize: parseFloat(getComputedStyle(code).fontSize),
              whiteSpace: getComputedStyle(pre).whiteSpace,
              scrollable: pre.scrollWidth > pre.clientWidth,
              text: code.textContent,
            };
          });
          // The actual browser clipboard proves that the visible action writes
          // the original Unicode, indentation, punctuation and newline bytes.
          await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
          let clickError: string | undefined;
          if (baseline) {
            try {
              await button.click({ timeout: 1500 });
            } catch (error) {
              clickError = String(error);
              await button.focus();
              await button.press("Enter");
            }
          } else await button.click();
          if (!baseline)
            await expect(button).toHaveText(
              locale === "en" ? "Copied" : "已複製",
            );
          if (baseline && surface === "reply")
            await expect(button).toHaveText("已複製");
          const copied = await page.evaluate(() =>
            navigator.clipboard.readText(),
          );
          const payload = await page.evaluate(() =>
            (
              window as unknown as { __markdownWrites: string[] }
            ).__markdownWrites.at(-1),
          );
          const nativeText =
            process.platform === "win32" ? code.replaceAll("\n", "\r\n") : code;
          measurements.push({
            surface,
            ...geometry,
            exactWritePayload: payload === code,
            nativeClipboardMatches: copied === nativeText,
            copied,
            clickError,
          });
          if (!baseline) {
            assert.equal(payload, code, `${surface} writes exact source`);
            assert.equal(
              copied,
              nativeText,
              `${surface} native clipboard, including platform newline conversion`,
            );
            assert.equal(geometry.text, code);
            assert.ok(
              geometry.width >= 44 && geometry.height >= 44,
              `${surface} touch target`,
            );
            assert.ok(geometry.fontSize >= 14, `${surface} legible code`);
            assert.equal(
              geometry.whiteSpace,
              "pre",
              `${surface} keeps code lines intact`,
            );
            assert.equal(await input.inputValue(), "保留下一句草稿");
            const pre = block.locator("pre");
            await button.focus();
            await button.press("Tab");
            await expect(pre).toBeFocused();
            const focus = await pre.evaluate((element) => ({
              width: getComputedStyle(element).outlineWidth,
              style: getComputedStyle(element).outlineStyle,
            }));
            assert.notEqual(focus.style, "none");
            assert.ok(parseFloat(focus.width) >= 2);
            if (geometry.scrollable) {
              await pre.press("ArrowRight");
              await expect
                .poll(() => pre.evaluate((element) => element.scrollLeft))
                .toBeGreaterThan(0);
            }
            const scrollPositions = () =>
              pre.evaluate((element) => {
                const positions: number[] = [];
                let node: HTMLElement | null = element as HTMLElement;
                while (node) {
                  positions.push(node.scrollTop);
                  node = node.parentElement;
                }
                return positions;
              });
            const readingBeforeKeys = await scrollPositions();
            await pre.press("End");
            await expect
              .poll(() =>
                pre.evaluate(
                  (element) =>
                    element.scrollWidth -
                    element.clientWidth -
                    element.scrollLeft,
                ),
              )
              .toBeLessThan(2);
            assert.deepEqual(await scrollPositions(), readingBeforeKeys);
            if (geometry.scrollable) {
              const rightEdge = await pre.evaluate(
                (element) => element.scrollLeft,
              );
              await pre.press("ArrowLeft");
              await expect
                .poll(() => pre.evaluate((element) => element.scrollLeft))
                .toBeLessThan(rightEdge);
              assert.deepEqual(await scrollPositions(), readingBeforeKeys);
            }
            await pre.press("Home");
            await expect
              .poll(() => pre.evaluate((element) => element.scrollLeft))
              .toBe(0);
            assert.deepEqual(await scrollPositions(), readingBeforeKeys);
            await expect(pre).toBeFocused();
            const table = root.locator(".markdown-table").first();
            await pre.press("Tab");
            await expect(table).toBeFocused();
            assert.equal(
              await table.evaluate(
                (element) => getComputedStyle(element).outlineStyle,
              ),
              "solid",
            );
            if (
              await table.evaluate(
                (element) => element.scrollWidth > element.clientWidth,
              )
            ) {
              await table.press("ArrowRight");
              await expect
                .poll(() => table.evaluate((element) => element.scrollLeft))
                .toBeGreaterThan(0);
            }
            await table.evaluate((element) => {
              element.scrollLeft = 0;
            });
            const audit = await new AxeBuilder({ page })
              .include(scopes[surface])
              .analyze();
            if (audit.violations.length || audit.incomplete.length) {
              await writeFile(
                join(
                  output,
                  `failed-${surface}-${size.width}-${locale}-${theme}.json`,
                ),
                JSON.stringify(
                  {
                    violations: audit.violations,
                    incomplete: audit.incomplete,
                  },
                  null,
                  2,
                ),
              );
              await page.screenshot({
                path: join(
                  output,
                  `failed-${surface}-${size.width}-${locale}-${theme}.png`,
                ),
              });
            }
            assert.deepEqual(audit.violations, [], `${surface} axe violations`);
            const contrastReview =
              surface === "file" || surface === "published"
                ? await reviewPreviewContrast(page, audit, surface)
                : undefined;
            if (!contrastReview)
              assert.deepEqual(
                audit.incomplete,
                [],
                `${surface} axe incomplete`,
              );
            measurements.push({
              surface,
              violations: audit.violations,
              incomplete: audit.incomplete,
              contrastReview,
            });
            if (
              locale === "zh-Hant" &&
              theme === "light" &&
              size.width === 1440
            ) {
              await page.evaluate(() => {
                (
                  window as unknown as {
                    __markdownClipboard: { fail: boolean };
                  }
                ).__markdownClipboard.fail = true;
              });
              await button.focus();
              await button.press("Enter");
              await expect(button).toHaveText("複製失敗");
              const feedback = block.getByRole("status");
              await expect(feedback).toHaveText(
                "無法複製，請選取程式碼後手動複製。",
              );
              await expect(feedback).toBeVisible();
              assert.equal(await button.getAttribute("aria-busy"), null);
              await page.screenshot({
                path: join(output, `copy-denied-${surface}.png`),
              });
              const deniedAudit = await new AxeBuilder({ page })
                .include(scopes[surface])
                .analyze();
              assert.deepEqual(
                deniedAudit.violations,
                [],
                `${surface} denied-copy axe violations`,
              );
              const deniedContrastReview =
                surface === "file" || surface === "published"
                  ? await reviewPreviewContrast(page, deniedAudit, surface)
                  : undefined;
              if (!deniedContrastReview)
                assert.deepEqual(
                  deniedAudit.incomplete,
                  [],
                  `${surface} denied-copy axe incomplete`,
                );
              await page.evaluate(() => {
                const state = (
                  window as unknown as {
                    __markdownClipboard: { fail: boolean; hold: boolean };
                  }
                ).__markdownClipboard;
                state.fail = false;
                state.hold = true;
              });
              const count = await page.evaluate(
                () =>
                  (window as unknown as { __markdownWrites: string[] })
                    .__markdownWrites.length,
              );
              await button.press("Enter");
              await expect(button).toHaveText("複製中…");
              await expect(button).toHaveAttribute("aria-busy", "true");
              await expect(button).toBeFocused();
              await button.press("Enter");
              assert.equal(
                await page.evaluate(
                  () =>
                    (window as unknown as { __markdownWrites: string[] })
                      .__markdownWrites.length,
                ),
                count + 1,
                "one pending write per code block",
              );
              await page.evaluate(() => {
                const state = (
                  window as unknown as {
                    __markdownClipboard: { hold: boolean; release: () => void };
                  }
                ).__markdownClipboard;
                state.hold = false;
                state.release();
              });
              await expect(button).toHaveText("已複製");
              await expect(feedback).toHaveText("程式碼已複製");
              await expect(feedback).toHaveClass(/visually-hidden/);
              assert.equal(await button.getAttribute("aria-busy"), null);
              assert.equal(await block.locator("code").textContent(), code);
              assert.equal(await input.inputValue(), "保留下一句草稿");
              measurements.push({
                surface,
                deniedThenRetried: true,
                pendingWriteDeduplicated: true,
                keyboardFocusPreserved: true,
                deniedAudit: {
                  violations: deniedAudit.violations,
                  incomplete: deniedAudit.incomplete,
                  contrastReview: deniedContrastReview,
                },
              });
            }
          }
          await block.locator("pre").evaluate((element) => {
            element.scrollLeft = 0;
          });
          await block.locator(".code-header").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: join(
              output,
              `${baseline ? "before" : "after"}-${surface}-${size.width}-${locale}-${theme}${size.fontScale ? "-200pct" : ""}.png`,
            ),
          });
        };
        await inspect(reply, "reply");
        const history = page
          .locator(".message.assistant .execution-tools")
          .first();
        const recordAction = page
          .locator(".message.assistant .reply-record-action")
          .first();
        if (size.width > 768 && (await recordAction.count())) {
          // Plain replies expose their record through the reply action row.
          if ((await recordAction.getAttribute("aria-expanded")) !== "true")
            await recordAction.press("Enter");
          await expect(recordAction).toHaveAttribute("aria-expanded", "true");
        } else if ((await history.getAttribute("open")) === null) {
          await history.locator("summary").first().click();
        }
        await expect(history).toHaveAttribute("open", "");
        const updates = history.locator(".execution-updates");
        if ((await updates.getAttribute("open")) === null)
          await updates.locator(":scope > summary").press("Enter");
        await expect(updates).toHaveAttribute("open", "");
        const record = history.locator(".work-commentary").first();
        await expect(record).toBeVisible();
        await expect(record.locator(".code-block")).toHaveCount(2);
        await inspect(record, "record");
        await page
          .getByRole("button", {
            name: locale === "en" ? "Toggle work inspector" : "切換工作內容",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: locale === "en" ? "Files" : "檔案",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "reading.md", exact: true })
          .click();
        await expect(
          page.locator(".file-content .markdown .code-block"),
        ).toHaveCount(2);
        if (!baseline && size.width >= 1150) {
          const bounds = await reply.evaluate((element) => {
            const region = element
              .closest(".messages")!
              .getBoundingClientRect();
            return {
              left: region.left,
              right: region.right,
              blocks: [
                ...element.querySelectorAll(".code-block, .markdown-table"),
              ].map((block) => {
                const box = block.getBoundingClientRect();
                return { left: box.left, right: box.right };
              }),
            };
          });
          assert.equal(bounds.blocks.length, 3);
          assert.ok(
            bounds.blocks.every(
              (block) =>
                block.left >= bounds.left - 1 &&
                block.right <= bounds.right + 1,
            ),
            "Opening the desktop inspector keeps reply code and table scrollports within the reading area",
          );
          measurements.push({ surface: "reply-with-inspector", bounds });
        }
        await inspect(page.locator(".file-content .markdown"), "file");
        if (
          !baseline &&
          locale === "zh-Hant" &&
          theme === "light" &&
          size.width === 1440
        ) {
          const copy = page.locator(".file-content .copy-code").first();
          await page.evaluate(() => {
            (
              window as unknown as { __markdownClipboard: { hold: boolean } }
            ).__markdownClipboard.hold = true;
          });
          await copy.click();
          await expect(copy).toHaveText("複製中…");
          await page
            .getByRole("button", { name: "返回檔案", exact: true })
            .click();
          await expect(page.locator(".file-content")).toHaveCount(0);
          await page
            .getByRole("button", { name: "reading.md", exact: true })
            .click();
          await expect(copy).toHaveText("複製");
          const completed = await page.evaluate(
            () =>
              (
                window as unknown as {
                  __markdownClipboard: { completed: number };
                }
              ).__markdownClipboard.completed,
          );
          await page.evaluate(() => {
            const state = (
              window as unknown as {
                __markdownClipboard: { hold: boolean; release: () => void };
              }
            ).__markdownClipboard;
            state.hold = false;
            state.release();
          });
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  (
                    window as unknown as {
                      __markdownClipboard: { completed: number };
                    }
                  ).__markdownClipboard.completed,
              ),
            )
            .toBe(completed + 1);
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(
              process.platform === "win32"
                ? code.replaceAll("\n", "\r\n")
                : code,
            );
          await expect(copy).toHaveText("複製");
          measurements.push({
            surface: "file",
            replacedPreviewDoesNotInheritCopyFeedback: true,
          });
        }
        if (!baseline) {
          await page
            .getByRole("button", {
              name: locale === "en" ? "Close work inspector" : "關閉工作內容",
              exact: true,
            })
            .click();
          await page
            .locator(".message.assistant .artifact-card")
            .first()
            .click();
          const published = page.locator(".artifact-preview .markdown");
          await expect(published.locator(".code-block")).toHaveCount(2);
          await inspect(published, "published");
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(remoteRequests, []);
        assert.equal(
          await page.evaluate(() => "__unsafeMarkdown" in window),
          false,
        );
        const noHorizontalOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        );
        if (!baseline) assert.equal(noHorizontalOverflow, true);
        reports.push({
          locale,
          theme,
          size,
          measurements,
          errors,
          remoteRequests,
          noHorizontalOverflow,
        });
        await context.close();
      }
    }
  }
  await writeFile(
    join(output, baseline ? "before.json" : "after.json"),
    JSON.stringify({ baseline, passed: !baseline, reports }, null, 2),
  );
  console.log(
    baseline
      ? "Captured Markdown reading baseline."
      : `PASS Markdown reading: exact clipboard payloads and native clipboard in reply, record, file and published result; denial/retry/pending/replaced-preview safety, readable code, keyboard scrolling, touch controls and ${reports.length} profile audits.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
