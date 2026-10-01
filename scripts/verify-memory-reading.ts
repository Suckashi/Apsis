import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Page } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

async function reviewMemoryContrast(
  page: Page,
  audit: Awaited<ReturnType<AxeBuilder["analyze"]>>,
) {
  const reviews = [];
  for (const finding of audit.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const node of finding.nodes) {
      assert.ok(
        node.any.some(
          (check) =>
            (check.data as { messageKey?: string })?.messageKey ===
            "elmPartiallyObscuring",
        ),
      );
      for (const target of node.target) {
        assert.ok(
          [
            ".memory-reading-intro > p",
            ".memory-empty > p",
            "small > span",
          ].includes(String(target)),
        );
        const painted = await page
          .locator(".memory-modal")
          .locator(String(target))
          .evaluateAll((elements) =>
            elements.map((element) => {
              const port = element.closest<HTMLElement>(".memory-modal-body");
              if (!port || !element.closest(".memory-reading"))
                throw new Error("Unexpected memory contrast target");
              const previousScroll = port.scrollTop;
              element.scrollIntoView({ block: "center" });
              const parse = (value: string) =>
                value.match(/[\d.]+/g)!.map(Number);
              const luminance = (rgb: number[]) =>
                rgb
                  .slice(0, 3)
                  .map((value) => value / 255)
                  .map((value) =>
                    value <= 0.04045
                      ? value / 12.92
                      : ((value + 0.055) / 1.055) ** 2.4,
                  )
                  .reduce(
                    (sum, value, index) =>
                      sum + value * [0.2126, 0.7152, 0.0722][index],
                    0,
                  );
              const foreground = getComputedStyle(element).color;
              let backdrop: Element | null = element;
              while (
                backdrop &&
                parse(getComputedStyle(backdrop).backgroundColor)[3] === 0
              )
                backdrop = backdrop.parentElement;
              if (!backdrop) throw new Error("No opaque memory backdrop");
              const background = getComputedStyle(backdrop).backgroundColor;
              const a = luminance(parse(foreground)),
                b = luminance(parse(background));
              const range = document.createRange();
              range.selectNodeContents(element);
              const rects = Array.from(range.getClientRects()).filter(
                (rect) => rect.width > 0 && rect.height > 0,
              );
              const bounds = port.getBoundingClientRect();
              const hits = rects.flatMap((rect) =>
                [0.25, 0.5, 0.75].map((fraction) => {
                  const x = rect.left + rect.width * fraction,
                    y = rect.top + rect.height / 2;
                  return (
                    x >= bounds.left &&
                    x <= bounds.right &&
                    y >= bounds.top &&
                    y <= bounds.bottom &&
                    element.contains(document.elementFromPoint(x, y))
                  );
                }),
              );
              let opaque = true;
              for (
                let ancestor: Element | null = element;
                ancestor;
                ancestor = ancestor.parentElement
              )
                opaque &&= Number(getComputedStyle(ancestor).opacity) === 1;
              port.scrollTop = previousScroll;
              return {
                foreground,
                background,
                contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                opaque:
                  opaque &&
                  (parse(foreground)[3] ?? 1) === 1 &&
                  (parse(background)[3] ?? 1) === 1,
                hits,
              };
            }),
          );
        assert.ok(painted.length > 0);
        for (const review of painted)
          assert.ok(
            review.opaque &&
              review.contrast >= 4.5 &&
              review.hits.length >= 3 &&
              review.hits.every(Boolean),
            `${String(target)}: ${JSON.stringify(review)}`,
          );
        reviews.push({ target, painted });
      }
    }
  }
  return reviews;
}

const directory = await mkdtemp(join(tmpdir(), "apsis-memory-reading-"));
const output = resolve("artifacts/memory-reading/desktop");
await mkdir(output, { recursive: true });
let runnerCalls = 0;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => {
    runnerCalls++;
    return { text: "Unused fixture" };
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
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
try {
  for (const width of [1440, 1024])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        app.product.settings.update(
          { locale },
          app.product.settings.read().revision,
        );
        const bot = await app.product.bots.create(
          `Memory fixture ${width}-${locale}-${theme}`,
        );
        const other = await app.product.bots.create("Other memory fixture");
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ id, theme }) => {
            localStorage.setItem("apsis.bot", id);
            localStorage.setItem("apsis.theme", theme);
          },
          { id: bot.id, theme },
        );
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base);
        if (width === 1024) {
          const projectPath = join(directory, `${width}-${locale}-${theme}`);
          await mkdir(projectPath, { recursive: true });
          const project = await app.tasks.projects.add({
            name: `Memory project ${locale}-${theme}`,
            path: projectPath,
          });
          await page
            .getByRole("button", { name: /^(工作資料夾|Working folder)$/ })
            .click();
          await page
            .locator(".folder-choices button")
            .filter({ hasText: project.name })
            .click();
          await expect(page.locator(".folder-dialog")).not.toBeVisible();
          assert.equal(
            app.product.queries.detail(bot.id).session.context!.location!
              .projectId,
            project.id,
          );
        }
        const draft = page.getByRole("textbox", {
          name: /^(傳送訊息|Send message)$/,
        });
        await draft.fill("Keep this chat draft.");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const contextEndpoint = `**/api/v2/bots/${bot.id}/context`;
        await page.route(contextEndpoint, async (route) => {
          await gate;
          await route.continue();
        });
        await page.locator(".bot-actions-menu > summary").press("Enter");
        await expect(page.locator(".bot-actions-menu")).toHaveAttribute(
          "open",
          "",
        );
        await page
          .getByRole("button", { name: /^(記憶與背景|Memory and context)$/ })
          .click();
        const dialog = page.locator(".memory-modal");
        const add = dialog.getByRole("button", {
          name: /^(新增記憶|Add memory)$/,
        });
        await expect(add).toBeDisabled();
        await expect(dialog.getByRole("status")).toHaveText(/載入中…|Loading…/);
        await expect(dialog.locator(".memory-empty")).toHaveCount(0);
        release();
        await expect(add).toBeEnabled();
        await page.unroute(contextEndpoint);
        await expect(dialog.locator(".memory-empty")).toBeVisible();
        await expect(dialog.locator(".memory-usage")).not.toHaveAttribute(
          "open",
          "",
        );
        const emptyAudit = await new AxeBuilder({ page })
          .include(".memory-modal")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-empty-axe.json`),
          JSON.stringify(emptyAudit, null, 2),
        );
        assert.deepEqual(emptyAudit.violations, []);
        const emptyReview = await reviewMemoryContrast(page, emptyAudit);
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-empty.png`),
        });
        await add.press("Enter");
        const input = dialog.getByRole("textbox", {
          name: /^(記憶內容|Memory content)$/,
        });
        await expect(input).toBeFocused();
        const advanced = dialog.locator(".memory-edit-advanced");
        await expect(advanced).not.toHaveAttribute("open", "");
        await expect(dialog.getByRole("checkbox")).not.toBeVisible();
        await input.fill("Cancelled draft.");
        await dialog.getByRole("button", { name: /^(取消|Cancel)$/ }).click();
        await expect(add).toBeFocused();
        assert.equal(app.product.queries.detail(bot.id).memories.length, 0);
        await add.press("Enter");
        const content = `Current memory ${width}-${locale}-${theme}.`;
        await input.fill(content);
        await advanced.locator("summary").press("Enter");
        await dialog.getByLabel(/分類|Category/).selectOption("core");
        await dialog.getByRole("checkbox", { name: /^(鎖定|Locked)$/ }).check();
        const save = dialog.getByRole("button", { name: /^(儲存|Save)$/ });
        await save.click();
        await expect(dialog.getByRole("status")).toHaveText(
          /記憶已儲存。|Memory saved\./,
        );
        await expect(add).toBeFocused();
        const current = app.product.queries
          .detail(bot.id)
          .memories.find((memory) => memory.content === content)!;
        assert.equal(
          current.scopeKey,
          app.product.queries.detail(bot.id).session.context!.location!
            .memoryKey,
        );
        assert.equal(current.tier, "core");
        assert.equal(current.locked, true);
        await add.press("Enter");
        await input.fill("Global preference for this Bot.");
        await dialog.getByLabel(/記憶範圍|Memory scope/).selectOption("global");
        await save.click();
        await expect(dialog.getByRole("status")).toHaveText(
          /記憶已儲存。|Memory saved\./,
        );
        const global = app.product.queries
          .detail(bot.id)
          .memories.find((memory) => memory.scopeKey === "global")!;
        assert.equal(global.agentId, bot.id);
        assert.equal(app.product.queries.detail(other.id).memories.length, 0);
        const card = dialog
          .locator(".memory-card")
          .filter({ hasText: content });
        await card
          .getByRole("button", { name: /^(編輯|Edit)$/ })
          .press("Enter");
        await expect(input).toBeFocused();
        await expect(advanced.locator("summary")).toContainText(/核心|Core/);
        await expect(advanced.locator("summary")).toContainText(/鎖定|Locked/);
        await input.fill("Retained failure draft.");
        const endpoint = `**/api/v2/bots/${bot.id}/memories`;
        await page.route(endpoint, (route) =>
          route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "Fixture memory conflict." }),
          }),
        );
        await save.click();
        await expect(dialog.getByRole("alert")).toHaveText(
          "Fixture memory conflict.",
        );
        await expect(input).toHaveValue("Retained failure draft.");
        assert.equal(
          app.product.queries
            .detail(bot.id)
            .memories.find((memory) => memory.id === current.id)!.content,
          content,
        );
        await page.unroute(endpoint);
        const finalContent = `Revised memory ${width}-${locale}-${theme}.`;
        await input.fill(finalContent);
        await save.click();
        await expect(dialog.getByRole("status")).toHaveText(
          /記憶已儲存。|Memory saved\./,
        );
        const finalCard = dialog
          .locator(".memory-card")
          .filter({ hasText: finalContent });
        await expect(
          finalCard.getByRole("button", { name: /^(編輯|Edit)$/ }),
        ).toBeFocused();
        const persisted = app.product.queries
          .detail(bot.id)
          .memories.find((memory) => memory.id === current.id)!;
        assert.equal(persisted.content, finalContent);
        assert.equal(persisted.scopeKey, current.scopeKey);
        assert.equal(persisted.revision, (current.revision ?? 1) + 1);
        const audit = await new AxeBuilder({ page })
          .include(".memory-modal")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-list-axe.json`),
          JSON.stringify(audit, null, 2),
        );
        assert.deepEqual(audit.violations, []);
        const listReview = await reviewMemoryContrast(page, audit);
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}.png`),
        });
        await finalCard.locator(".memory-source > summary").press("Enter");
        await expect(finalCard.locator("pre")).toBeVisible();
        await finalCard.locator(".memory-source > summary").press("Enter");
        if (locale === "en") {
          await fixtureStyle(page, {
            content: "html { font-size:200% !important; }",
          });
          await finalCard
            .getByRole("button", { name: "Edit", exact: true })
            .scrollIntoViewIfNeeded();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();
          await page.screenshot({
            path: join(output, `${width}-${locale}-${theme}-200.png`),
          });
          await finalCard
            .getByRole("button", { name: "Edit", exact: true })
            .press("Enter");
          await expect(input).toBeFocused();
          await expect(input).toHaveValue(finalContent);
          await dialog
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await expect(
            finalCard.getByRole("button", { name: "Edit", exact: true }),
          ).toBeFocused();
        }
        if (width === 1440 && locale === "zh-Hant" && theme === "light") {
          await dialog
            .getByRole("button", { name: "關閉 Bot 管理", exact: true })
            .press("Escape");
          await page.route(contextEndpoint, (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Fixture context load failed." }),
            }),
          );
          await page.locator(".bot-actions-menu > summary").press("Enter");
          await page
            .getByRole("button", { name: "記憶與背景", exact: true })
            .click();
          await expect(dialog.getByRole("alert")).toHaveText(
            "Fixture context load failed.",
          );
          await expect(add).toBeDisabled();
          await expect(dialog.locator(".memory-empty")).toHaveCount(0);
          await expect(dialog.locator(".memory-card")).toHaveCount(2);
          for (const edit of await dialog
            .getByRole("button", { name: "編輯", exact: true })
            .all()) {
            await expect(edit).toBeDisabled();
          }
          await page.unroute(contextEndpoint);
          await dialog
            .getByRole("button", { name: "重新載入", exact: true })
            .click();
          await expect(add).toBeEnabled();
          await expect(dialog.getByRole("alert")).toHaveCount(0);
          await expect(dialog.locator(".memory-card")).toHaveCount(2);
          assert.equal(app.product.queries.detail(bot.id).memories.length, 2);
        }
        await dialog
          .getByRole("button", {
            name: /^(關閉 Bot 管理|Close Bot management)$/,
          })
          .press("Escape");
        await expect(draft).toHaveValue("Keep this chat draft.");
        await expect(page.locator(".bot-actions-menu > summary")).toBeFocused();
        assert.deepEqual(errors, []);
        reports.push({
          width,
          locale,
          theme,
          emptyAudit,
          audit,
          emptyReview,
          listReview,
          scopesAndRevisionsPreserved: true,
          errors,
        });
        await context.close();
      }
  assert.equal(runnerCalls, 0);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      { passed: true, fixtureOnly: true, reports, runnerCalls },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${reports.length} desktop memory profiles, honest loading and empty states, keyboard editing, scope and revision persistence, error draft and retry, raw axe, English 200% text and chat draft preservation.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
