import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { createApp } from "../server/app.ts";
import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { fixtureStyle } from "./browser-style.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-tool-ui-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  "artifacts/execution-hierarchy",
  desktopOnly ? "desktop" : ".",
);
const longOutput = Array.from(
  { length: 500 },
  (_, index) => `Output line ${index + 1}: complete fixture evidence.`,
).join("\n");
const longPatch = Array.from(
  { length: 500 },
  (_, index) => `+ Patch line ${index + 1}: original change evidence.`,
).join("\n");
const longError =
  "無效的虛擬檔案路徑。\n" +
  Array.from(
    { length: 120 },
    (_, index) => `    at fixtureStack ${index + 1}: original error evidence`,
  ).join("\n");
await mkdir(output, { recursive: true });
let finish!: () => void;
let failNext = true;
const recoveryPrompt = "請先檢查現有檔案，再繼續製作番茄鐘";
let startTools!: () => void;
let advancePlan!: () => void;
const preparationGate = new Promise<void>((resolve) => {
  startTools = resolve;
});
const gate = new Promise<void>((r) => {
  finish = r;
});
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    if (options.prompt === recoveryPrompt) {
      if (failNext) {
        failNext = false;
        options.emit({ type: "delta", text: "準備寫入，但還沒完成。" });
        throw new Error("terminated");
      }
      return { text: "重試已完成。" };
    }
    options.emit({ type: "progress", text: "正在準備寫入文件（尚未執行）" });
    await preparationGate;
    options.emit({
      type: "commentary",
      id: "note-1",
      text: "我會先確認檔案路徑，再建立遊戲。",
    });
    const startedAt = new Date().toISOString();
    await options.recordOperation?.({
      id: "bad-path",
      name: "scratch_write_file",
      target: "C:/snake.html",
      mutating: true,
      status: "started",
      startedAt,
    });
    await options.recordOperation?.({
      id: "bad-path",
      name: "scratch_write_file",
      target: "C:/snake.html",
      mutating: true,
      status: "failed",
      startedAt,
      endedAt: startedAt,
      error: desktopOnly ? longError : "無效的虛擬檔案路徑。",
    });
    options.emit({
      type: "commentary",
      id: "note-2",
      text: "確認是路徑格式錯誤，接著改用工作區工具。",
    });
    await options.recordOperation?.({
      id: "retry",
      name: "model_retry",
      target: "1/3 · 0.5s",
      mutating: false,
      status: "started",
      startedAt,
    });
    const child = {
      id: "native-1",
      name: "Test analysis",
      task: "檢查 concurrency coverage",
      status: "running" as const,
      progress: "正在閱讀 auth-client.test.ts",
      startedAt,
    };
    options.emit({
      type: "execution",
      evidence: { kind: "subagent", activity: child },
    });
    options.emit({
      type: "execution",
      evidence: {
        kind: "planning",
        todos: [
          { content: "檢查登入流程", status: "completed" },
          { content: "補上測試", status: "in_progress" },
          {
            content: "確認成果的可讀內容與檔案位置，再回報尚未驗證的範圍",
            status: "pending",
          },
        ],
      },
    });
    advancePlan = () => {
      options.emit({
        type: "execution",
        evidence: {
          kind: "planning",
          todos: [
            { content: "檢查登入流程", status: "completed" },
            { content: "補上測試", status: "completed" },
            {
              content: "確認成果的可讀內容與檔案位置，再回報尚未驗證的範圍",
              status: "in_progress",
            },
          ],
        },
      });
      options.emit({
        type: "execution",
        evidence: {
          kind: "planning",
          subagentId: child.id,
          todos: [{ content: "子代理的獨立計畫", status: "completed" }],
        },
      });
    };
    await options.authorize?.(
      "shell",
      { command: "git push origin fixture" },
      options.signal,
    );
    await gate;
    options.emit({
      type: "execution",
      evidence: {
        kind: "subagent",
        activity: {
          ...child,
          status: "completed",
          resultSummary: "找到缺少 concurrent refresh test",
          endedAt: new Date().toISOString(),
        },
      },
    });
    await options.recordOperation?.({
      id: "retry",
      name: "model_retry",
      target: "1/3 · 0.5s",
      mutating: false,
      status: "succeeded",
      startedAt,
      endedAt: new Date().toISOString(),
      evidence: { output: longOutput, patch: longPatch },
    });
    return { text: "路徑已修正，工作完成。" };
  },
});
app.product.settings.update(
  { approvalMode: "manual" },
  app.product.settings.read().revision,
);
const c = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({ connectionId: c.id, model: c.model });
const bot = await app.product.bots.create("工具進度測試");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
    { waitUntil: "networkidle" },
  );
  await page.locator(`button.bot-row[title="${bot.name}"]`).click();
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("建立貪吃蛇");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const live = page.locator(".message.live .execution-evidence");
  await page
    .locator(".header-profile")
    .getByText("正在準備寫入文件（尚未執行）", { exact: true })
    .waitFor();
  assert.equal(await live.locator(".execution-recent li").count(), 0);
  assert.equal(await live.locator(".execution-plan-count").count(), 0);
  startTools();
  await live
    .locator(".execution-collaboration-count")
    .getByText("1 個子代理正在協作", { exact: true })
    .waitFor({ state: "attached" });
  await live
    .locator(".execution-recent li")
    .nth(1)
    .waitFor({ state: "attached" });
  assert.equal(await live.locator(".execution-recent li").count(), 2);
  assert.match(
    (await live.locator(".execution-recent").textContent()) || "",
    /寫入暫存檔 snake.html[\s\S]*失敗/,
  );
  assert.equal(
    await live
      .locator(".execution-recent")
      .getByText("無效的虛擬檔案路徑。", { exact: true })
      .count(),
    0,
  );
  const rosterCount = await page.locator("button.bot-row").count();
  await expect(live.locator(".execution-recent")).toBeHidden();
  await expect(live.locator(".execution-attention")).toHaveText("有操作失敗");
  assert.equal(await live.locator(":scope > details").count(), 1);
  for (const name of ["execution-subagents", "execution-tools"])
    assert.equal(await live.locator(`.${name}`).getAttribute("open"), null);
  assert.equal(
    await live
      .getByText("正在閱讀 auth-client.test.ts", { exact: true })
      .isVisible(),
    false,
  );
  const approval = page.locator(".approval-card");
  await approval.waitFor();
  const planSummary = live.locator(".execution-tools > summary");
  assert.match(await planSummary.innerText(), /1\/3 項完成/);
  assert.equal(
    await live.locator(".execution-plan-current").textContent(),
    "補上測試",
  );
  assert.equal(await live.locator(".execution-plan-list").isVisible(), false);
  await expect(live.locator(".execution-plan-current")).toBeHidden();
  await expect(live.locator(".execution-collaboration-count")).toBeHidden();
  const approvalMode = page.locator(
    ".composer-tools .approval-mode-control > details > summary",
  );
  await expect(approvalMode).toHaveAccessibleName("一般核准");
  await expect(approvalMode).toHaveAttribute("title", "一般核准");
  await approvalMode.press("Enter");
  await expect(
    page.getByRole("radiogroup", { name: "對話核准模式" }),
  ).toBeVisible();
  await approvalMode.press("Escape");
  await expect(approvalMode).toBeFocused();
  await page.screenshot({ path: join(output, "execution-collapsed.png") });
  assert.equal(await approval.locator("xpath=ancestor::details").count(), 0);
  await approval.getByRole("button", { name: "核准並繼續" }).click();
  await planSummary.focus();
  await page.keyboard.press("Enter");
  await live.locator(".execution-subagents > summary").click();
  await live
    .getByText("正在閱讀 auth-client.test.ts", { exact: true })
    .waitFor();
  await live.getByText("檢查 concurrency coverage", { exact: true }).waitFor();
  await live
    .locator('.execution-plan-list li[data-state="completed"]')
    .getByText("檢查登入流程", { exact: true })
    .waitFor();
  advancePlan();
  await page.waitForFunction(() =>
    document
      .querySelector(".message.live .execution-plan-count")
      ?.textContent?.includes("2/3"),
  );
  assert.notEqual(
    await live.locator(".execution-tools").getAttribute("open"),
    null,
  );
  assert.match(await planSummary.innerText(), /2\/3 項完成/);
  assert.equal(
    await live
      .locator('.execution-plan-list li[data-state="in_progress"]')
      .count(),
    1,
  );
  assert.equal(await live.locator(".execution-plan-list li").count(), 3);
  assert.equal(
    await live
      .locator(".execution-plan-list")
      .getByText("子代理的獨立計畫", { exact: true })
      .count(),
    0,
  );
  assert.equal(await live.locator(".work-commentary").count(), 2);
  const updates = live.locator(".execution-updates");
  assert.equal(await live.locator(".execution-current").isVisible(), true);
  assert.equal(await updates.getAttribute("open"), null);
  assert.equal(
    await updates.locator(".work-commentary").first().isVisible(),
    false,
  );
  assert.match(
    await updates.locator(":scope > summary").innerText(),
    /進度回報.*2/,
  );
  await updates.locator(":scope > summary").press("Enter");
  assert.equal(
    await updates.locator(".work-commentary").first().isVisible(),
    true,
  );
  const operation = live
    .locator(".task-row")
    .filter({ hasText: "scratch_write_file" });
  assert.equal(
    await operation
      .getByText("無效的虛擬檔案路徑。", { exact: true })
      .isVisible(),
    false,
  );
  await operation.locator(":scope > summary").click();
  await operation.getByText("無效的虛擬檔案路徑。", { exact: true }).waitFor();
  if (desktopOnly) {
    const errorDetails = operation.locator(".operation-error-details");
    const errorEvidence = errorDetails.getByRole("region", {
      name: "完整錯誤內容",
      exact: true,
    });
    await expect(errorEvidence).toBeHidden();
    await errorDetails.locator(":scope > summary").press("Enter");
    await expect(errorEvidence).toHaveText(longError);
    await errorEvidence.focus();
    await errorEvidence.press("Control+End");
    await expect
      .poll(() =>
        errorEvidence.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(2);
    await expect(errorEvidence).toBeFocused();
    await errorDetails.locator(":scope > summary").press("Enter");
    await expect(errorEvidence).toBeHidden();
  }
  await page.screenshot({ path: join(output, "execution-expanded.png") });
  for (const size of desktopOnly
    ? [{ width: 1024, height: 768 }]
    : [
        { width: 375, height: 812 },
        { width: 812, height: 375 },
      ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await planSummary.click();
    assert.equal(
      await live.locator(".execution-plan-current").isVisible(),
      size.width < 901,
    );
    await page.screenshot({
      path: join(output, `plan-collapsed-${size.width}.png`),
    });
    await planSummary.click();
  }
  assert.notEqual(
    await live.locator(".execution-subagents").getAttribute("open"),
    null,
  );
  assert.notEqual(await operation.getAttribute("open"), null);
  assert.notEqual(await updates.getAttribute("open"), null);
  assert.equal(
    await operation
      .getByText("無效的虛擬檔案路徑。", { exact: true })
      .isVisible(),
    true,
  );
  assert.ok(
    await live
      .locator(".execution-subagents > summary")
      .evaluate((el) => el.getBoundingClientRect().height >= 44),
  );
  const planReports = [];
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const width of desktopOnly ? [1440, 1024] : [1440, 375])
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
        });
        const sample = await context.newPage();
        sample.on("pageerror", (e) => errors.push(e.message));
        await sample.goto(
          `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
        );
        assert.equal(
          await sample
            .locator(`button.bot-row[title="${bot.name}"]`)
            .getAttribute("aria-current"),
          "page",
        );
        const plan = sample.locator(".message.live .execution-tools");
        await plan
          .locator(".execution-plan-count")
          .getByText(locale === "en" ? "2/3 steps done" : "2/3 項完成", {
            exact: true,
          })
          .waitFor();
        const summary = plan.locator(":scope > summary");
        await summary.focus();
        await sample.keyboard.press("Enter");
        await plan.locator(".execution-plan-list").waitFor();
        assert.equal(await plan.locator(".execution-plan-list li").count(), 3);
        const progress = plan.locator(".execution-updates");
        assert.ok(
          await progress
            .locator(":scope > summary")
            .evaluate((el) => el.getBoundingClientRect().height >= 44),
        );
        assert.equal(await progress.getAttribute("open"), null);
        assert.equal(
          await progress.locator(".work-commentary").first().isVisible(),
          false,
        );
        await progress.locator(":scope > summary").press("Enter");
        assert.equal(
          await progress.locator(".work-commentary").first().isVisible(),
          true,
        );
        assert.equal(
          await sample
            .locator(".message.live .execution-evidence > details")
            .count(),
          1,
        );
        assert.ok(
          await summary.evaluate(
            (el) => el.getBoundingClientRect().height >= 44,
          ),
        );
        if (desktopOnly) {
          const failed = plan
            .locator(".task-row")
            .filter({ hasText: "scratch_write_file" });
          await failed.locator(":scope > summary").press("Enter");
          const errorDetails = failed.locator(".operation-error-details");
          const evidence = errorDetails.getByRole("region", {
            name: locale === "en" ? "Full error" : "完整錯誤內容",
            exact: true,
          });
          await expect(evidence).toBeHidden();
          await expect(errorDetails.locator(":scope > summary")).toHaveText(
            locale === "en" ? "Error details" : "錯誤詳情",
          );
          await errorDetails.locator(":scope > summary").press("Enter");
          await expect(evidence).toHaveText(longError);
          const size = await evidence.boundingBox();
          assert.ok(size && size.height <= 405);
        }
        const audit = await new AxeBuilder({ page: sample }).analyze();
        assert.deepEqual(audit.violations, []);
        await sample.screenshot({
          path: join(output, `plan-${width}-${locale}-${theme}.png`),
        });
        if (locale === "en") {
          await fixtureStyle(sample, {
            content: "html { font-size:200% !important; }",
          });
          await sample.screenshot({
            path: join(output, `plan-${width}-${locale}-${theme}-200pct.png`),
          });
        }
        assert.equal(
          await sample.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        planReports.push({
          locale,
          width,
          theme,
          violations: audit.violations,
          incomplete: audit.incomplete,
        });
        await context.close();
      }
  }
  app.product.settings.update(
    { locale: "zh-Hant" },
    app.product.settings.read().revision,
  );
  await page.screenshot({
    path: join(
      output,
      desktopOnly
        ? "desktop-before-work-details.png"
        : "landscape-before-work-details.png",
    ),
  });
  const landscape = await page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      messages: rect(".messages"),
      composer: rect(".composer-wrap"),
      summary: rect(".message.live .execution-tools > summary"),
    };
  });
  assert.ok(
    landscape.messages && landscape.messages.height >= 112,
    `Short landscape must retain room to read and operate conversation details: ${JSON.stringify(landscape)}`,
  );
  await live.locator(".execution-tools > summary").click();
  finish();
  await page
    .locator(".message.assistant")
    .getByText("路徑已修正，工作完成。", { exact: true })
    .waitFor();
  assert.equal(await page.locator("button.bot-row").count(), rosterCount);
  await page.reload();
  const history = page.locator(".message.assistant .execution-evidence");
  await history
    .locator(".execution-collaboration-count")
    .getByText("1 個子代理完成", { exact: true })
    .waitFor({ state: "attached" });
  assert.match(
    await history.locator(".execution-plan-count").innerText(),
    /2\/3 項完成/,
  );
  assert.equal(await history.locator(".execution-plan-current").count(), 0);
  assert.equal(await history.locator(".execution-recent").count(), 0);
  assert.match(
    await history.locator(".execution-tools > summary").innerText(),
    /回覆結束.*2 項操作/,
  );
  assert.equal(await history.locator(":scope > details").count(), 1);
  for (const name of ["execution-subagents", "execution-tools"])
    assert.equal(await history.locator(`.${name}`).getAttribute("open"), null);
  await history.locator(".execution-tools > summary").focus();
  await page.keyboard.press("Enter");
  const finalPlan = history.locator(".execution-plan-list");
  await expect(finalPlan.locator('[data-state="unconfirmed"]')).toHaveCount(1);
  await expect(
    finalPlan.locator('[data-state="unconfirmed"] .execution-plan-state'),
  ).toHaveText("未確認完成");
  await expect(finalPlan.locator('[data-state="in_progress"]')).toHaveCount(0);
  await expect(finalPlan.locator('[data-state="completed"]')).toHaveCount(2);
  await history.locator(".execution-subagents > summary").click();
  assert.equal(
    await history.locator(".execution-updates").getAttribute("open"),
    null,
  );
  await history.locator(".execution-updates > summary").press("Enter");
  await history
    .getByText("找到缺少 concurrent refresh test", { exact: true })
    .waitFor();
  await history
    .getByText("我會先確認檔案路徑，再建立遊戲。", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".message.assistant")
      .evaluate(
        (el) =>
          !!el.querySelector(".message-body") &&
          (el
            .querySelector(".message-body")!
            .compareDocumentPosition(el.querySelector(".execution-evidence")!) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(output, "execution-completed.png") });
  const evidenceReports = [];
  if (desktopOnly) {
    for (const width of [1440, 1024])
      for (const locale of ["zh-Hant", "en"] as const)
        for (const theme of ["light", "dark"]) {
          app.product.settings.update(
            { locale },
            app.product.settings.read().revision,
          );
          const profile = await browser.newContext({
            viewport: { width, height: 900 },
            reducedMotion: "reduce",
          });
          await profile.addInitScript(
            ({ id, theme }) => {
              localStorage.setItem("apsis.bot", id);
              localStorage.setItem("apsis.theme", theme);
            },
            { id: bot.id, theme },
          );
          const sample = await profile.newPage();
          sample.on("pageerror", (error) => errors.push(error.message));
          await sample.goto(page.url());
          const record = sample.locator(".message.assistant .execution-tools");
          await record.locator(":scope > summary").press("Enter");
          const row = record.locator(":scope > .task-row").nth(1);
          await row.locator(":scope > summary").press("Enter");
          const outputRegion = row.getByRole("region", {
            name: locale === "en" ? "Tool output" : "工具輸出",
            exact: true,
          });
          const patchRegion = row.getByRole("region", {
            name: locale === "en" ? "File changes" : "檔案變更",
            exact: true,
          });
          await expect(outputRegion).toHaveText(longOutput);
          await expect(patchRegion).toHaveText(longPatch);
          await outputRegion.scrollIntoViewIfNeeded();
          await outputRegion.focus();
          const before = await outputRegion.evaluate((element) => ({
            height: element.clientHeight,
            content: element.scrollHeight,
            top: element.scrollTop,
          }));
          assert.ok(before.content > before.height && before.height <= 405);
          await outputRegion.press("Control+End");
          await expect
            .poll(() =>
              outputRegion.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop,
              ),
            )
            .toBeLessThanOrEqual(2);
          await expect(outputRegion).toBeFocused();
          await outputRegion.press("Control+Home");
          await expect
            .poll(() => outputRegion.evaluate((element) => element.scrollTop))
            .toBe(0);
          assert.equal(
            await sample.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          assert.equal(
            await row.locator("summary > svg").getAttribute("aria-hidden"),
            "true",
          );
          const audit = await new AxeBuilder({ page: sample })
            .include(".execution-evidence")
            .analyze();
          await writeFile(
            join(output, `evidence-${width}-${locale}-${theme}-axe.json`),
            JSON.stringify(audit, null, 2),
          );
          assert.deepEqual(audit.violations, []);
          await sample.screenshot({
            path: join(output, `evidence-${width}-${locale}-${theme}.png`),
          });
          await patchRegion.scrollIntoViewIfNeeded();
          await patchRegion.press("Control+End");
          await expect
            .poll(() =>
              patchRegion.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop,
              ),
            )
            .toBeLessThanOrEqual(2);
          await record.locator(".task-raw-activity > summary").press("Enter");
          const raw = record.getByRole("region", {
            name: locale === "en" ? "Raw run record" : "原始執行紀錄",
            exact: true,
          });
          await expect(raw).toContainText("Output line 500");
          await raw.press("Control+End");
          await expect
            .poll(() =>
              raw.evaluate(
                (element) =>
                  element.scrollHeight -
                  element.clientHeight -
                  element.scrollTop,
              ),
            )
            .toBeLessThanOrEqual(2);
          if (locale === "en") {
            await fixtureStyle(sample, {
              content: "html { font-size:200% !important; }",
            });
            await outputRegion.scrollIntoViewIfNeeded();
            await outputRegion.press("Control+End");
            await expect(outputRegion).toBeFocused();
            await expect
              .poll(() =>
                outputRegion.evaluate(
                  (element) =>
                    element.scrollHeight -
                    element.clientHeight -
                    element.scrollTop,
                ),
              )
              .toBeLessThanOrEqual(2);
            assert.ok(
              await outputRegion.evaluate(
                (element) =>
                  parseFloat(getComputedStyle(element).fontSize) >= 28,
              ),
            );
            assert.equal(
              await sample.evaluate(
                () => document.documentElement.scrollWidth > innerWidth,
              ),
              false,
            );
            await sample.screenshot({
              path: join(
                output,
                `evidence-${width}-${locale}-${theme}-200.png`,
              ),
            });
          }
          evidenceReports.push({
            width,
            locale,
            theme,
            audit,
            fullOutputPreserved: true,
            keyboardScroll: true,
          });
          await profile.close();
        }
    app.product.settings.update(
      { locale: "zh-Hant" },
      app.product.settings.read().revision,
    );
    await page.reload();
  }
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill(recoveryPrompt);
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const failure = page.locator(".message.assistant.failed").last();
  await failure.getByText("模型回應中斷", { exact: true }).waitFor();
  assert.equal(
    await failure.getByText("terminated", { exact: true }).isVisible(),
    false,
  );
  assert.equal(
    await failure
      .getByText("準備寫入，但還沒完成。", { exact: true })
      .isVisible(),
    false,
  );
  await failure.locator(".execution-partial > summary").click();
  await failure.getByText("準備寫入，但還沒完成。", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "execution-failed.png") });
  await failure.getByRole("button", { name: "重新交辦", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "傳送訊息", exact: true })
      .inputValue(),
    recoveryPrompt,
  );
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page
    .locator(".message.assistant .message-body")
    .getByText("重試已完成。", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "plan-report.json"),
    JSON.stringify(
      {
        fixtureOnly: true,
        initialCount: "1/3",
        updatedCount: "2/3",
        preservedExpandedState: true,
        excludedChildPlan: true,
        historicalCount: "2/3",
        noAutomaticCompletion: true,
        singleTopLevelDisclosure: true,
        nestedExpansionSurvivesCollapse: true,
        landscape,
        profiles: planReports,
        evidenceProfiles: evidenceReports,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: single work disclosure, collapsed desktop evidence with visible failure notice, preserved expansion and real plan count, nested collaboration/tools, finished summary, interrupted partial response, original-prompt retry, keyboard approval picker, persistence/reload, final answer first, keyboard/${desktopOnly ? "desktop" : "mobile"}, no browser errors`,
  );
} finally {
  startTools();
  finish();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
