import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Locator, type Page } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";
import { reviewPreviewContrast } from "./preview-contrast.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-preview-reading-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  desktopOnly
    ? "artifacts/preview-reading/desktop"
    : "artifacts/preview-reading",
);
await mkdir(output, { recursive: true });
const filename = "長文件閱讀.md";
const publishedName =
  "閱讀成果/版本一/產品設計與交付紀錄 — " +
  "保留完整檔名與來源 ".repeat(12) +
  ".md";
const content =
  "# 閱讀與交付\n\n" +
  Array.from(
    { length: 40 },
    (_, index) =>
      `## 閱讀段落 ${index + 1}\n\n保留原始內容、閱讀位置與下一句草稿。下載、引用與返回應隨時可用。\n\n`,
  ).join("");
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    const tools = createTools(options);
    for (const [name, args] of [
      ["write_file", { path: filename, content }],
      ["publish_file", { path: filename, name: publishedName }],
    ] as const)
      await tools
        .find((tool) => tool.name === name)!
        .execute(crypto.randomUUID(), args, options.signal);
    return { text: "閱讀測試成果已交付。" };
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
await app.product.bots.create("閱讀夥伴");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];

async function visibleControls(root: Locator) {
  const result = await root
    .locator(".file-preview-header")
    .evaluate((header) => {
      const frame =
        header.closest(".file-panel-expanded") || header.closest(".details")!;
      const boundary = frame.getBoundingClientRect();
      return Array.from(
        header.querySelectorAll<HTMLElement>("button,a,summary"),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") || element.textContent,
          width: rect.width,
          height: rect.height,
          inView:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= boundary.top &&
            rect.bottom <= Math.min(boundary.bottom, innerHeight),
          onTop: element.contains(
            document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            ),
          ),
        };
      });
    });
  for (const control of result)
    assert.ok(
      control.inView &&
        control.onTop &&
        control.width >= 44 &&
        control.height >= 44,
      JSON.stringify(control),
    );
  return result;
}
async function audit(page: Page, name: string) {
  const result = await new AxeBuilder({ page }).analyze();
  await writeFile(
    join(output, `${name}-axe.json`),
    JSON.stringify(
      { violations: result.violations, incomplete: result.incomplete },
      null,
      2,
    ),
  );
  const paintedText = await reviewPreviewContrast(page, result, name);
  await writeFile(
    join(output, `${name}-axe.json`),
    JSON.stringify(
      {
        violations: result.violations,
        incomplete: result.incomplete,
        paintedText,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(result.violations, [], name);
  return {
    violations: result.violations,
    incomplete: result.incomplete,
    paintedText,
  };
}
try {
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const theme of ["light", "dark"] as const) {
      const sizes = [
        { width: 1440, height: 900, scale: 1 },
        ...(desktopOnly ? [] : [{ width: 375, height: 812, scale: 1 }]),
      ];
      if (locale === "en" && theme === "dark")
        sizes.push(
          ...(desktopOnly
            ? [
                { width: 1440, height: 900, scale: 2 },
                { width: 1024, height: 768, scale: 2 },
              ]
            : [
                { width: 375, height: 812, scale: 2 },
                { width: 812, height: 375, scale: 2 },
              ]),
        );
      for (const size of sizes) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          (theme) => localStorage.setItem("apsis.theme", theme),
          theme,
        );
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.goto(base);
        const input = page.getByRole("textbox", {
          name: /^(傳送訊息|Send message)$/,
        });
        if (!app.product.db.all("job").length) {
          await input.fill("整理閱讀內容");
          await page.getByRole("button", { name: /^(傳送|Send)$/ }).click();
        }
        const card = page.locator(".message.assistant .artifact-card").first();
        await expect(card).toBeVisible();
        await input.fill("保留下一句草稿");
        if (size.scale === 2)
          await fixtureStyle(page, {
            content: "html { font-size: 200% !important }",
          });
        const name = `${size.width}-${size.height}-${locale}-${theme}-${size.scale}x`;
        const measurements: object[] = [];
        for (const surface of ["published", "working"]) {
          if (surface === "published") {
            if (
              size.width === 1440 &&
              size.scale === 1 &&
              locale === "zh-Hant" &&
              theme === "light"
            ) {
              const artifact = app.product.db.artifacts
                .list()
                .find((item) => item.name === publishedName)!;
              const endpoint = `**/artifacts/${artifact.id}/preview`;
              let releaseRead!: () => void;
              let finishRead!: () => void;
              const readGate = new Promise<void>((resolve) => {
                releaseRead = resolve;
              });
              const readFinished = new Promise<void>((resolve) => {
                finishRead = resolve;
              });
              await page.route(endpoint, async (route) => {
                await readGate;
                try {
                  await route.continue();
                } finally {
                  finishRead();
                }
              });
              await card.click();
              const result = page.locator(".artifact-preview .file-content");
              await expect(result.getByRole("status")).toHaveText("載入中");
              await expect(result.getByRole("alert")).toContainText(
                "讀取逾時，請再試一次。",
                { timeout: 17000 },
              );
              await expect(input).toHaveValue("保留下一句草稿");
              await page.screenshot({
                path: join(output, "published-timeout.png"),
              });
              releaseRead();
              await readFinished;
              await page.unroute(endpoint);
              await result
                .getByRole("button", { name: "重新載入", exact: true })
                .press("Enter");
              await expect(result).toBeFocused();
            } else await card.click();
          } else {
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
          await expect(
            root.getByRole("heading", { name: "閱讀段落 40", exact: true }),
          ).toHaveCount(1);
          const title = root.locator(".file-preview-path");
          if (size.width > 900) {
            await expect(title.locator(".file-preview-fullname")).toBeHidden();
            await expect(
              title.locator(".file-preview-identity > span"),
            ).toHaveText(
              (surface === "published" ? publishedName : filename)
                .split("/")
                .at(-1)!,
            );
          }
          assert.equal(
            await title.getAttribute("title"),
            surface === "published" ? publishedName : filename,
          );
          if (surface === "published") {
            const information = root.locator(".file-preview-info > summary");
            await information.focus();
            await information.press("Enter");
            await expect(root.locator(".artifact-version time")).toBeVisible();
            await expect(root.locator(".file-preview-location")).toHaveText(
              publishedName,
            );
            const infoContent = root.locator(".file-preview-info > div");
            await infoContent.focus();
            await infoContent.press("End");
            await expect
              .poll(() =>
                infoContent.evaluate((node) =>
                  Math.abs(
                    node.scrollHeight - node.clientHeight - node.scrollTop,
                  ),
                ),
              )
              .toBeLessThan(2);
            await infoContent.press("Home");
            await expect
              .poll(() => infoContent.evaluate((node) => node.scrollTop))
              .toBe(0);
            const infoBox = (await root
              .locator(".file-preview-info > div")
              .boundingBox())!;
            assert.ok(
              infoBox.x >= 0 &&
                infoBox.x + infoBox.width <= size.width &&
                infoBox.y + infoBox.height <= size.height,
            );
            await information.press("Enter");
            await expect(root.locator(".artifact-version")).toBeHidden();
          }
          for (const expanded of [false, true]) {
            if (expanded)
              await root
                .getByRole("button", { name: /^(展開預覽|Expand preview)$/ })
                .click();
            const scroll = root.locator(".file-content");
            await scroll.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            await expect
              .poll(() => scroll.evaluate((element) => element.scrollTop))
              .toBeGreaterThan(100);
            await scroll.focus();
            await scroll.press("Home");
            await expect
              .poll(() => scroll.evaluate((element) => element.scrollTop))
              .toBe(0);
            await scroll.press("End");
            await expect
              .poll(() =>
                scroll.evaluate((element) =>
                  Math.abs(
                    element.scrollHeight -
                      element.clientHeight -
                      element.scrollTop,
                  ),
                ),
              )
              .toBeLessThan(2);
            const controls = await visibleControls(root);
            const tail = root.getByRole("heading", {
              name: "閱讀段落 40",
              exact: true,
            });
            await expect(tail).toBeVisible();
            await page.screenshot({
              path: join(
                output,
                `${name}-${surface}-${expanded ? "expanded" : "inline"}.png`,
              ),
            });
            const accessibility = await audit(
              page,
              `${name}-${surface}-${expanded ? "expanded" : "inline"}`,
            );
            assert.equal(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              true,
            );
            if (expanded) {
              if (surface === "published") {
                const information = root.locator(
                  ".file-preview-info > summary",
                );
                await information.press("Enter");
                await root.locator(".file-preview-info > div").press("Escape");
                await expect(root).toHaveClass(/file-panel-expanded/);
                await expect(
                  root.locator(".file-preview-info"),
                ).not.toHaveAttribute("open", "");
                await expect(information).toBeFocused();
                await information.press("Enter");
                await root
                  .getByRole("button", { name: /^(收合|Collapse)$/ })
                  .focus();
                await expect(
                  root.locator(".file-preview-info"),
                ).not.toHaveAttribute("open", "");
              }
              await root
                .getByRole("button", { name: /^(原始碼|Source)$/ })
                .click();
              await expect(root.locator(".file-document")).toHaveText(content);
              assert.equal(
                await root
                  .locator(".file-document")
                  .evaluate((node) =>
                    parseFloat(getComputedStyle(node).fontSize),
                  ),
                14 * size.scale,
              );
              await visibleControls(root);
              await root
                .getByRole("button", { name: /^(預覽|Preview)$/ })
                .click();
              await page.keyboard.press("Escape");
              await expect(
                root.getByRole("button", {
                  name: /^(展開預覽|Expand preview)$/,
                }),
              ).toBeFocused();
            }
            measurements.push({ surface, expanded, controls, accessibility });
          }
        }
        await page
          .getByRole("button", {
            name: /^(關閉工作內容|Close work inspector)$/,
          })
          .click();
        await expect(input).toHaveValue("保留下一句草稿");
        assert.deepEqual(errors, []);
        reports.push({ name, measurements, errors });
        await context.close();
      }
    }
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ passed: true, reports }, null, 2),
  );
  console.log(
    `PASS: ${reports.length} preview reading profiles, working and published files, filename/path hierarchy, keyboard metadata reading, fixed visible 44px controls after scrolling, expanded/source/Escape/drafts, 200% text, axe and no console errors.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
