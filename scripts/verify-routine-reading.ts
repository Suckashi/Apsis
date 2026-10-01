import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-routine-reading-"));
const output = resolve("artifacts/routine-reading/desktop");
await mkdir(output, { recursive: true });
let runnerCalls = 0;
const runnerPrompts: string[] = [];
const resultText =
  Array.from(
    { length: 300 },
    (_, index) =>
      `Result paragraph ${index + 1}: complete saved schedule output.`,
  ).join("\n\n") + "\n\nFinal schedule result marker.";
let runningGate: Promise<void> | undefined;
let releaseRun: (() => void) | undefined;
let failRun = false;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    runnerCalls++;
    runnerPrompts.push(options.prompt);
    if (runningGate) await runningGate;
    if (failRun) {
      failRun = false;
      throw new Error("Fixture scheduled run failed.");
    }
    return { text: resultText };
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
const reports = [];
try {
  for (const width of [1440, 1024])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        app.product.settings.update(
          { locale },
          app.product.settings.read().revision,
        );
        const bot = await app.product.bots.create(
          `Schedule ${width}-${locale}-${theme}`,
        );
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
        const draft = page.getByRole("textbox", {
          name: /^(傳送訊息|Send message)$/,
        });
        await draft.fill("Keep this chat draft.");
        await page.locator(".bot-actions-menu > summary").press("Enter");
        await page.getByRole("button", { name: /^(排程|Schedules)$/ }).click();
        const add = page.getByRole("button", {
          name: /^(新增排程|New schedule)$/,
        });
        await add.press("Enter");
        const dialog = page.locator(".routine-modal");
        const name = dialog.getByLabel(/^(名稱|Name)$/, { exact: true });
        const prompt = dialog.getByRole("textbox", {
          name: /^(交辦內容|Task instructions)$/,
          exact: true,
        });
        const time = dialog
          .getByLabel(/時間|Schedule/)
          .filter({ has: page.locator("option") });
        const save = dialog.getByRole("button", {
          name: /^(儲存排程|Save schedule)$/,
        });
        const cancel = dialog.getByRole("button", { name: /^(取消|Cancel)$/ });
        await expect(
          dialog.getByRole("button", { name: /^(關閉排程|Close schedule)$/ }),
        ).toBeFocused();
        await expect(dialog.getByLabel("Cron", { exact: true })).toHaveCount(0);
        await expect(
          dialog.locator(".routine-work-settings"),
        ).not.toHaveAttribute("open", "");
        const workSettings = dialog.locator(".routine-work-settings > summary");
        await expect(workSettings).toContainText(
          locale === "en" ? "General conversation" : "一般對話",
        );
        await workSettings.press("Enter");
        const workLocation = dialog.getByRole("combobox", {
          name: locale === "en" ? "Work location" : "工作位置",
          exact: true,
        });
        await expect(workLocation).toBeVisible();
        await expect(workLocation).toHaveValue("");
        await workSettings.press("Enter");
        await name.fill("Cancelled schedule");
        await cancel.click();
        await expect(add).toBeFocused();
        assert.equal(app.product.queries.detail(bot.id).routines.length, 0);
        await add.press("Enter");
        await save.click();
        await expect(name).toBeFocused();
        await name.fill("Saved schedule");
        await prompt.fill("Read the saved fixture report.");
        await dialog.getByRole("checkbox").uncheck();
        await time.selectOption("0 9 * * *");
        await dialog
          .getByLabel(/^(時區|Time zone)$/, { exact: true })
          .fill("Europe/London");
        await save.click();
        await expect(dialog).not.toBeVisible();
        const persisted = app.product.queries.detail(bot.id).routines[0];
        assert.equal(persisted.cron, "0 9 * * *");
        assert.equal(persisted.timezone, "Europe/London");
        assert.equal(persisted.enabled, false);
        await page.getByRole("button", { name: /Saved schedule/ }).click();
        await expect(name).toHaveValue("Saved schedule");
        await expect(dialog.getByLabel("Cron", { exact: true })).toHaveCount(0);
        await time.selectOption("custom");
        const cron = dialog.getByLabel("Cron", { exact: true });
        await cron.fill("");
        await save.click();
        await expect(cron).toBeFocused();
        await cron.fill("15 10 * * 2");
        await name.fill("Revised schedule");
        const failure = "Fixture schedule save failed. ".repeat(100);
        await page.route(`**/api/v2/routines/${persisted.id}`, (route) =>
          route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: failure }),
          }),
        );
        await save.click();
        await expect(dialog.getByRole("alert")).toHaveText(failure);
        await expect(name).toHaveValue("Revised schedule");
        await expect(cron).toHaveValue("15 10 * * 2");
        await expect(save).toBeInViewport();
        await expect(cancel).toBeInViewport();
        assert.equal(
          app.product.queries.detail(bot.id).routines[0].name,
          "Saved schedule",
        );
        await page.unroute(`**/api/v2/routines/${persisted.id}`);
        await save.click();
        await expect(dialog).not.toBeVisible();
        assert.equal(
          app.product.queries.detail(bot.id).routines[0].cron,
          "15 10 * * 2",
        );
        await page.getByRole("button", { name: /Revised schedule/ }).click();
        await expect(cron).toHaveValue("15 10 * * 2");
        const savedPrompt = app.product.queries.detail(bot.id).routines[0]
          .prompt;
        const history = dialog.locator(".routine-history");
        await history.locator(":scope > summary").press("Enter");
        await expect(history).toContainText(/尚無執行紀錄。|No runs yet./);
        await history.locator(":scope > summary").press("Enter");
        await prompt.fill("An unsaved draft, retained after a test failure.");
        await page.route(`**/api/v2/routines/${persisted.id}/test`, (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Fixture test failed." }),
          }),
        );
        await dialog
          .getByRole("button", { name: /^(立即試跑|Run now)$/ })
          .click();
        await expect(dialog.getByRole("alert")).toHaveText(
          "Fixture test failed.",
        );
        await expect(prompt).toHaveValue(
          "An unsaved draft, retained after a test failure.",
        );
        assert.equal(
          app.product.queries.detail(bot.id).routines[0].prompt,
          savedPrompt,
        );
        await page.unroute(`**/api/v2/routines/${persisted.id}/test`);
        const beforeTest = runnerCalls;
        const checkLive =
          width === 1440 && locale === "zh-Hant" && theme === "light";
        if (checkLive)
          runningGate = new Promise<void>((resolve) => {
            releaseRun = resolve;
          });
        await dialog
          .getByRole("button", { name: /^(立即試跑|Run now)$/ })
          .click();
        await expect(dialog.getByRole("status")).toHaveText(
          /試跑已交辦，可回到對話查看。|Test run submitted. View it in the conversation./,
        );
        await expect.poll(() => runnerCalls).toBe(beforeTest + 1);
        assert.equal(runnerPrompts.at(-1), savedPrompt);
        await expect(prompt).toHaveValue(
          "An unsaved draft, retained after a test failure.",
        );
        await history.locator(":scope > summary").press("Enter");
        await expect(history.locator(".routine-history-entry")).toHaveCount(1);
        await history
          .locator(".routine-history-entry > summary")
          .press("Enter");
        const runResult = history.getByRole("region", {
          name: /^(排程執行結果|Schedule run result)$/,
        });
        await expect(runResult).toContainText(savedPrompt);
        if (checkLive) {
          await expect(runResult).toContainText("結果會在執行結束後更新。");
          releaseRun!();
          runningGate = undefined;
        }
        await expect(runResult).toContainText("Final schedule result marker.");
        const currentRoutine = app.product.queries.detail(bot.id).routines[0];
        const job = app.product.queries
          .detail(bot.id)
          .jobs.find((job) => job.id === currentRoutine.history[0].jobId)!;
        assert.equal(job.prompt, savedPrompt);
        assert.equal(job.result, resultText.slice(0, 16000));
        assert.equal(
          app.product.queries.runRecord(bot.id, job.runId!).run.text,
          resultText,
        );
        await expect(runResult.locator(".markdown > p")).toHaveText(
          resultText.split("\n\n"),
        );
        if (checkLive) {
          const entry = history.locator(".routine-history-entry > summary");
          const toggleEntry = async () => {
            const disclosure = history.locator(".routine-history-entry");
            await disclosure.evaluate((element) => {
              const target = element as HTMLElement & {
                verificationToggle?: Promise<void>;
              };
              target.verificationToggle = new Promise((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error("Disclosure toggle did not fire")),
                  5000,
                );
                element.addEventListener(
                  "toggle",
                  () => {
                    clearTimeout(timer);
                    resolve();
                  },
                  { once: true },
                );
              });
            });
            await entry.press("Enter");
            await disclosure.evaluate(
              (element) =>
                (
                  element as HTMLElement & {
                    verificationToggle?: Promise<void>;
                  }
                ).verificationToggle,
            );
          };
          const endpoint = `**/api/v2/bots/${bot.id}/runs/${job.runId}`;
          await toggleEntry();
          await page.route(endpoint, (route) =>
            route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "Fixture run read failed." }),
            }),
          );
          await toggleEntry();
          await expect(runResult.getByRole("alert")).toHaveText(
            "Fixture run read failed.",
          );
          await expect(prompt).toHaveValue(
            "An unsaved draft, retained after a test failure.",
          );
          await page.unroute(endpoint);
          await runResult
            .getByRole("button", { name: "重新載入", exact: true })
            .press("Enter");
          await expect(runResult).toBeFocused();
          await expect(runResult.locator(".markdown > p")).toHaveText(
            resultText.split("\n\n"),
          );
          await toggleEntry();
          let releaseRead!: () => void;
          let finishRead!: () => void;
          const readFinished = new Promise<void>((resolve) => {
            finishRead = resolve;
          });
          const readGate = new Promise<void>((resolve) => {
            releaseRead = resolve;
          });
          await page.route(endpoint, async (route) => {
            await readGate;
            try {
              await route.continue();
            } finally {
              finishRead();
            }
          });
          await toggleEntry();
          await expect(runResult.getByRole("status")).toHaveText("載入中…");
          await expect(runResult.getByRole("alert")).toHaveText(
            "讀取逾時，請再試一次。",
            { timeout: 17000 },
          );
          releaseRead();
          await readFinished;
          await page.unroute(endpoint);
          await runResult
            .getByRole("button", { name: "重新載入", exact: true })
            .press("Enter");
          await expect(runResult).toBeFocused();
          await expect(runResult.locator(".markdown > p")).toHaveText(
            resultText.split("\n\n"),
          );
        }
        await expect(history.locator("time")).toHaveText(
          new Date(currentRoutine.history[0].at).toLocaleString(locale, {
            timeZone: currentRoutine.timezone,
          }),
        );
        await expect(
          history.locator(".routine-history-timezone"),
        ).toContainText("Europe/London");
        await runResult.scrollIntoViewIfNeeded();
        await runResult.press("Control+End");
        await expect
          .poll(() =>
            runResult.evaluate(
              (element) =>
                element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          )
          .toBeLessThanOrEqual(2);
        await expect(runResult).toBeFocused();
        const audit = await new AxeBuilder({ page })
          .include(".routine-modal")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-axe.json`),
          JSON.stringify(audit, null, 2),
        );
        assert.deepEqual(audit.violations, []);
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}.png`),
        });
        if (checkLive) {
          failRun = true;
          await dialog
            .getByRole("button", { name: "立即試跑", exact: true })
            .click();
          await expect(history.locator(".routine-history-entry")).toHaveCount(
            2,
          );
          const failed = history.locator(".routine-history-entry").first();
          await failed.locator("summary").press("Enter");
          await expect(failed.locator(".routine-run-error")).toHaveText(
            "Fixture scheduled run failed.",
          );
          await expect(prompt).toHaveValue(
            "An unsaved draft, retained after a test failure.",
          );
          await page.screenshot({ path: join(output, "history-failed.png") });
        }
        if (locale === "en") {
          await fixtureStyle(page, {
            content: "html {font-size:200% !important;}",
          });
          await expect(save).toBeInViewport();
          await expect(cancel).toBeInViewport();
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await runResult.scrollIntoViewIfNeeded();
          await runResult.press("Control+End");
          await expect
            .poll(() =>
              runResult.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop,
              ),
            )
            .toBeLessThanOrEqual(2);
          await expect(
            dialog.getByRole("heading", { level: 2 }),
          ).toBeInViewport();
          await page.screenshot({
            path: join(output, `${width}-${locale}-${theme}-200.png`),
          });
          if (width === 1024) {
            await page.setViewportSize({ width, height: 540 });
            await expect(save).toBeInViewport();
            await expect(cancel).toBeInViewport();
            await expect(
              dialog.getByRole("heading", { level: 2 }),
            ).toBeInViewport();
            for (const action of [save, cancel])
              assert.ok(
                await action.evaluate((element) => {
                  const rect = element.getBoundingClientRect();
                  return (
                    rect.width >= 44 &&
                    rect.height >= 44 &&
                    element.contains(
                      document.elementFromPoint(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                      ),
                    )
                  );
                }),
              );
            await page.screenshot({
              path: join(output, `${width}-${locale}-${theme}-200-short.png`),
            });
          }
        }
        await cancel.click();
        await page
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
          audit,
          errors,
          persistence: true,
          retry: true,
          testPreservesDraft: true,
          completeReply: true,
          savedTimezone: true,
          ...(checkLive
            ? {
                liveHistory: true,
                readFailureRetry: true,
                readTimeoutRetry: true,
                retryFocus: true,
              }
            : {}),
        });
        await context.close();
      }
  assert.equal(runnerCalls, 9);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      { passed: true, fixtureOnly: true, reports, runnerCalls },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${reports.length} desktop schedule profiles, complete 300-paragraph replies, live history, failure/timeout retry with focus, saved timezone, persistence, draft retention, raw axe and English 200% text.`,
  );
} finally {
  releaseRun?.();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
