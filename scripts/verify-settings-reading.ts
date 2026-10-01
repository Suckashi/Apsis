import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { fixtureStyle } from "./browser-style.ts";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

const baseline = process.argv.includes("--baseline");
const desktop = process.argv.includes("--desktop");
const directory = await mkdtemp(join(tmpdir(), "apsis-settings-reading-"));
const output = resolve("artifacts/settings-reading", desktop ? "desktop" : ".");
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
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
await app.product.bootstrap();
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
try {
  for (const width of desktop ? [1440, 1024] : [1440, 375, 812])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        app.product.settings.update({
          ...DEFAULT_SETTINGS,
          locale,
          revision: app.product.settings.read().revision,
        });
        const context = await browser.newContext({
          viewport: { width, height: width === 812 ? 375 : 900 },
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
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base);
        if (width < 640)
          await page
            .getByRole("button", { name: /開啟 Bot 名單|Open Bot list/ })
            .click();
        await page
          .getByRole("button", { name: /^(設定與工具|Settings & tools)$/ })
          .click();
        await page
          .getByRole("button", { name: /^(執行與語言|Execution & language)$/ })
          .click();
        const execution = page.locator(".execution-settings");
        await expect(
          execution.getByLabel(/介面語言|Interface language/),
        ).toHaveValue(locale);
        const save = execution.getByRole("button", {
          name: /^(儲存變更|Save changes)$/,
        });
        const inView = () =>
          save.evaluate((button) => {
            const rect = button.getBoundingClientRect(),
              modal = button
                .closest(".settings-modal")!
                .getBoundingClientRect();
            const form = button.closest("form")!;
            const body = form
              .querySelector(".execution-settings-body")
              ?.getBoundingClientRect();
            const footer = button
              .closest(".settings-save-row")!
              .getBoundingClientRect();
            return (
              rect.top >= modal.top &&
              rect.bottom <= Math.min(modal.bottom, innerHeight) &&
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              !!body &&
              body.height > 0 &&
              body.bottom <= footer.top + 1
            );
          });
        const initiallyVisibleSave = await inView();
        if (!baseline) {
          for (const tab of await page.locator(".settings-tabs button").all()) {
            await expect(tab).toBeInViewport({ ratio: 1 });
            const box = (await tab.boundingBox())!;
            assert.ok(box.width >= 44 && box.height >= 44);
          }
        }
        const name = `${width}-${locale}-${theme}`;
        await page.screenshot({
          path: join(output, `${baseline ? "before" : "after"}-${name}.png`),
        });
        if (!baseline) {
          if (desktop) {
            const modes = execution.getByRole("radio");
            const boxes = await modes.evaluateAll((elements) =>
              elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                };
              }),
            );
            assert.equal(boxes.length, 3);
            assert.ok(boxes.every((box) => box.top === boxes[0].top));
            assert.ok(
              boxes.every((box) => box.width >= 44 && box.height >= 56),
            );
            const selected = modes.filter({ has: page.locator(".mode-check") });
            await selected.press("ArrowRight");
            await expect(selected).toHaveAttribute("aria-checked", "true");
            assert.equal(
              app.product.settings.read().approvalMode,
              DEFAULT_SETTINGS.approvalMode,
            );
            await modes.nth(0).press("Space");
            await expect(modes.nth(0)).toHaveAttribute("aria-checked", "true");
            assert.equal(
              app.product.settings.read().approvalMode,
              DEFAULT_SETTINGS.approvalMode,
            );
            await execution
              .getByRole("button", { name: /^(取消|Cancel)$/ })
              .click();
            await expect(save).toBeDisabled();
          }
          assert.ok(
            initiallyVisibleSave,
            `${name}: save must be visible before scrolling`,
          );
          const group = execution.locator("details.execution-group").first();
          await expect(group).not.toHaveAttribute("open", "");
          const turns = execution.getByLabel(
            /每次任務的回合上限|Maximum turns per task/,
          );
          await expect(turns).not.toBeVisible();
          await group.locator("summary").click();
          await turns.fill("31");
          await expect(save).toBeEnabled();
          assert.ok(
            await inView(),
            `${name}: save remains visible while editing low-frequency fields`,
          );
          assert.equal(
            app.product.settings.read().maxTurns,
            DEFAULT_SETTINGS.maxTurns,
          );
          await save.click();
          await expect(
            execution.getByText(/^(已儲存變更|Changes saved)$/),
          ).toBeVisible();
          assert.equal(app.product.settings.read().maxTurns, 31);
          await turns.fill("");
          await group.locator("summary").click();
          await save.click();
          await expect(group).toHaveAttribute("open", "");
          await expect(turns).toBeFocused();
          await expect(turns).toBeInViewport();
          assert.ok(
            await inView(),
            `${name}: validation cannot hide the save action`,
          );
          await execution
            .getByRole("button", { name: /^(取消|Cancel)$/ })
            .click();
          await expect(turns).toHaveValue("31");
          await expect(save).toBeDisabled();
          await turns.fill("32");
          app.product.settings.update(
            { maxTurns: 33 },
            app.product.settings.read().revision,
          );
          // Scroll this isolated fixture as a reader reviewing a long form
          // before using its fixed Save action.
          await execution
            .locator(".settings-reset button")
            .scrollIntoViewIfNeeded();
          await save.click();
          await expect(execution.getByRole("alert")).toBeInViewport();
          await expect(turns).toHaveValue("32");
          await expect(save).toBeDisabled();
          await execution
            .getByRole("button", { name: /^(重新載入|Reload)$/ })
            .click();
          await expect(turns).toHaveValue("33");
          const audit = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(audit.violations, []);
          const scrollReview: object[] = [];
          // Retain the original incomplete result. Scroll clipped helper text
          // fully into view and recheck its actual visible presentation.
          for (const item of audit.incomplete) {
            for (const node of item.nodes) {
              const target = node.target[0];
              if (typeof target !== "string") continue;
              await page.locator(target).scrollIntoViewIfNeeded();
              const visibleAudit = await new AxeBuilder({ page })
                .include(target)
                .analyze();
              scrollReview.push({
                target,
                violations: visibleAudit.violations,
                incomplete: visibleAudit.incomplete,
              });
              assert.deepEqual(visibleAudit.violations, []);
              if (
                visibleAudit.incomplete.length &&
                (await page
                  .locator(target)
                  .evaluate((element) =>
                    element.matches(".settings-tabs button > span"),
                  ))
              ) {
                assert.ok(
                  visibleAudit.incomplete.every(
                    (finding) => finding.id === "color-contrast",
                  ),
                );
                const painted = await page
                  .locator(target)
                  .evaluate((element) => {
                    const parse = (color: string) =>
                      color.match(/[\d.]+/g)!.map(Number);
                    const luminance = (rgb: number[]) =>
                      rgb
                        .slice(0, 3)
                        .map((v) => v / 255)
                        .map((v) =>
                          v <= 0.04045
                            ? v / 12.92
                            : ((v + 0.055) / 1.055) ** 2.4,
                        )
                        .reduce(
                          (sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i],
                          0,
                        );
                    const foreground = parse(getComputedStyle(element).color);
                    let backgroundElement: Element | null = element;
                    while (
                      backgroundElement &&
                      parse(
                        getComputedStyle(backgroundElement).backgroundColor,
                      )[3] === 0
                    )
                      backgroundElement = backgroundElement.parentElement;
                    const background = parse(
                      getComputedStyle(backgroundElement!).backgroundColor,
                    );
                    const a = luminance(foreground),
                      b = luminance(background);
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    const rects = [...range.getClientRects()];
                    return {
                      contrast:
                        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                      opaque:
                        (foreground[3] ?? 1) === 1 &&
                        (background[3] ?? 1) === 1,
                      lines: rects.length,
                      visible: rects.every(
                        (rect) =>
                          rect.top >= 0 &&
                          rect.bottom <= innerHeight &&
                          rect.left >= 0 &&
                          rect.right <= innerWidth &&
                          [0.25, 0.5, 0.75].every((y) =>
                            element.contains(
                              document.elementFromPoint(
                                (rect.left + rect.right) / 2,
                                rect.top + rect.height * y,
                              ),
                            ),
                          ),
                      ),
                    };
                  });
                assert.ok(
                  painted.contrast >= 4.5 &&
                    painted.opaque &&
                    painted.lines > 0 &&
                    painted.visible,
                  JSON.stringify(painted),
                );
                scrollReview.push({ target, painted });
              } else assert.deepEqual(visibleAudit.incomplete, []);
              assert.ok(
                await inView(),
                `${name}: reviewing helper text cannot obscure Save`,
              );
            }
          }
          reports.push({
            name,
            initiallyVisibleSave,
            collapsedLimits: true,
            draftOnlyUntilSave: true,
            invalidFieldOpenedAndFocused: true,
            cancelRestoredSavedValues: true,
            failedSaveExplanationVisible: true,
            scrollReview,
            violations: audit.violations,
            incomplete: audit.incomplete.map((item) => ({
              id: item.id,
              nodes: item.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
              })),
            })),
            errors,
          });
          if (locale === "en") {
            await fixtureStyle(page, {
              content: "html { font-size: 200% !important; }",
            });
            assert.ok(await inView(), `${name}: save visible with 200% text`);
            if (desktop) {
              const modes = execution.getByRole("radio");
              const tops = await modes.evaluateAll((elements) =>
                elements.map((element) => element.getBoundingClientRect().top),
              );
              assert.ok(tops[1] > tops[0] && tops[2] > tops[1]);
              assert.equal(
                await execution.evaluate(
                  (element) => element.scrollWidth > element.clientWidth,
                ),
                false,
              );
            }
            await page.screenshot({
              path: join(output, `after-${name}-200pct.png`),
            });
          }
        } else reports.push({ name, initiallyVisibleSave, errors });
        assert.deepEqual(errors, []);
        await context.close();
      }
  await writeFile(
    join(output, baseline ? "before.json" : "after.json"),
    JSON.stringify({ baseline, reports }, null, 2),
  );
  console.log(JSON.stringify({ baseline, reports: reports.length }));
} finally {
  await browser.close();
  await app.close();
}
