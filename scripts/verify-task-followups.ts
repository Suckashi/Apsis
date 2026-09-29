import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { Job } from "../shared/product.ts";

// Real UI and API with a controlled local runner; no provider requests.
const directory = await mkdtemp(join(tmpdir(), "apsis-task-followups-"));
const output = resolve("artifacts/task-followups");
await mkdir(output, { recursive: true });
const adopted: (() => Promise<void>)[] = [];
let runs = 0;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  worktreeRoot: join(directory, "isolated-worktrees"),
  runner: async (options) => {
    if (++runs > 1) return { text: "已處理重新送出的補充。" };
    options.registerSteer?.(async (_prompt, onApplied) => {
      if (onApplied) adopted.push(onApplied);
    });
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(new Error("fixture work stopped"));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener("abort", abort, { once: true });
    });
    return { text: "unreachable" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
  modelSettings: { fixture: { contextWindowTokens: 128000 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.create("工作夥伴");
const task = await app.product.coding.create(bot.id, {
  prompt: "補充分帳工具的測試",
});
await expect.poll(() => app.product.steers.has(task.id)).toBe(true);
// A historical task may have a much longer title than today's creation limit.
app.product.db.put("coding-task", {
  ...app.product.coding.get(task.id),
  title: "舊任務名稱".repeat(20),
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
  );
  await page.locator(".bot-row").filter({ hasText: "工作夥伴" }).click();
  await page
    .getByRole("button", { name: "工作夥伴 的任務 · 1", exact: true })
    .click();
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "舊任務名稱" })
    .click();
  await page.getByLabel("補充指示", { exact: true }).waitFor();
  assert.equal(
    Array.from((await page.locator(".cw-header h1").textContent())!).length,
    32,
  );
  assert.equal(
    await page.locator(".cw-header h1").getAttribute("title"),
    "舊任務名稱".repeat(20),
  );

  await page.getByRole("button", { name: "重新命名任務", exact: true }).click();
  const rename = page.getByRole("dialog", {
    name: "重新命名任務",
    exact: true,
  });
  await rename
    .getByLabel("任務名稱", { exact: true })
    .fill("分帳工具的互動與驗證");
  await rename.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.locator(".cw-header h1")).toHaveText(
    "分帳工具的互動與驗證",
  );
  await expect(rename).toHaveCount(0);
  assert.equal(app.product.coding.get(task.id).prompt, "補充分帳工具的測試");

  // A rejected steering request keeps the draft; retry uses the real endpoint.
  await page.route("**/coding-tasks/*/steer", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "fixture 暫時無法採用" }),
    }),
  );
  await page.getByLabel("補充指示", { exact: true }).fill("請保留小數點兩位");
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "補充指示", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("fixture 暫時無法採用");
  assert.equal(
    await page.getByLabel("補充指示", { exact: true }).inputValue(),
    "請保留小數點兩位",
  );
  await page.unroute("**/coding-tasks/*/steer");
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "補充指示", exact: true })
    .click();
  await expect(
    page.locator('.cw-message .message-delivery[data-state="pending"]'),
  ).toHaveText("待採用");
  assert.equal(
    await page.getByLabel("補充指示", { exact: true }).inputValue(),
    "",
  );
  assert.equal(adopted.length, 1);
  await adopted[0]();
  await expect(
    page.locator('.cw-message .message-delivery[data-state="applied"]'),
  ).toHaveText("已採用");

  let rejectedRequestId = "";
  await page.route("**/coding-tasks/*/steer", (route) => {
    rejectedRequestId = route.request().postDataJSON().requestId;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ delivery: { state: "not-applied" } }),
    });
  });
  await page.getByLabel("補充指示", { exact: true }).fill("也顯示剩餘金額");
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "補充指示", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("補充未採用，草稿已保留");
  assert.equal(
    await page.getByLabel("補充指示", { exact: true }).inputValue(),
    "也顯示剩餘金額",
  );
  await page.unroute("**/coding-tasks/*/steer");
  const resendRequest = page.waitForRequest((request) =>
    request.url().endsWith(`/coding-tasks/${task.id}/steer`),
  );
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "補充指示", exact: true })
    .click();
  assert.notEqual(
    (await resendRequest).postDataJSON().requestId,
    rejectedRequestId,
    "confirmed not-applied receipt permits a new steering attempt",
  );
  await expect(
    page.locator('.cw-message .message-delivery[data-state="pending"]'),
  ).toHaveCount(1);
  assert.equal(adopted.length, 2);
  await adopted[1]();
  await expect(
    page.locator('.cw-message .message-delivery[data-state="applied"]'),
  ).toHaveCount(2);

  // The verification receipt can change while the task timestamp stays fixed.
  const updatedAt = app.product.coding.get(task.id).updatedAt;
  const html = '<!doctype html><h1 id="result">120</h1>';
  await mkdir(task.location.path, { recursive: true });
  await writeFile(join(task.location.path, "index.html"), html);
  app.product.db.put("web-verification", {
    id: "fixture-receipt",
    taskId: task.id,
    runId: app.product.coding.detail(task.id).runs[0].id,
    path: "index.html",
    checkedAt: new Date().toISOString(),
    status: "passed",
    assertions: 1,
    steps: [
      {
        action: "expect_text",
        selector: "#result",
        value: "120",
        status: "passed",
      },
    ],
    errors: [],
    files: { "index.html": createHash("sha256").update(html).digest("hex") },
  });
  await expect(page.getByLabel("網頁驗證", { exact: true })).toContainText(
    "最近一次網頁檢查通過 · 1 項結果",
    { timeout: 4500 },
  );
  assert.equal(app.product.coding.get(task.id).updatedAt, updatedAt);
  await writeFile(
    join(task.location.path, "index.html"),
    html.replace("120", "150"),
  );
  await expect(page.getByLabel("網頁驗證", { exact: true })).toContainText(
    "檔案已變更，網頁需要重新驗證",
    { timeout: 4500 },
  );
  assert.equal(app.product.coding.get(task.id).updatedAt, updatedAt);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("傳送方式", { exact: true }).selectOption("queue");
  await page
    .getByLabel("補充指示", { exact: true })
    .fill("再加入平均分帳與重新計算的操作測試");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const header = (await page.locator(".cw-header").boundingBox())!;
  assert.ok(
    header.height <= 180,
    `mobile task header is compact (${header.height}px)`,
  );
  await page.screenshot({
    path: join(output, "mobile-current-or-queue.png"),
    fullPage: true,
  });
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "排入下一項", exact: true })
    .click();
  await expect(page.locator(".cw-queued-message")).toContainText(
    "再加入平均分帳與重新計算的操作測試",
  );
  const queued = app.product.db
    .all<Job>("job")
    .find((job) => job.taskId === task.id && job.status === "queued")!;
  assert.ok(queued && !queued.runId);
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  assert.equal(
    await page.locator(".queued").count(),
    0,
    "task queue stays in its own discussion",
  );
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "分帳工具的互動與驗證", exact: true })
    .click();
  await page
    .locator(".cw-compose")
    .getByRole("button", { name: "停止", exact: true })
    .click();
  const unexecuted = page.locator(
    `.cw-unexecuted-message[data-job-id="${queued.id}"]`,
  );
  await expect(unexecuted).toContainText("補充尚未執行");
  await expect
    .poll(() => app.product.coding.busy(app.product.coding.get(task.id)))
    .toBe(false);
  // Emulate the durable queued-job state produced by a service restart.
  app.product.db.put("job", {
    ...app.product.db.get<Job>("job", queued.id)!,
    status: "interrupted",
    error: "服務重新啟動，這則補充尚未執行。",
  });
  await page.reload();
  await expect(unexecuted).toContainText("再加入平均分帳與重新計算的操作測試");
  await expect(unexecuted.locator("small")).not.toBeEmpty();
  await page.screenshot({
    path: join(output, "mobile-unexecuted-retained.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  assert.equal(
    await page.locator(".job-error").count(),
    0,
    "interrupted coding requests do not create a main-chat retry banner",
  );
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "分帳工具的互動與驗證", exact: true })
    .click();
  await unexecuted
    .getByRole("button", { name: "重新送出", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(unexecuted).toContainText("補充已重新送出");
  await expect
    .poll(
      () =>
        app.product.db
          .all<Job>("job")
          .filter((job) => job.retryOf === queued.id).length,
    )
    .toBe(1);
  await expect(page.locator(".cw-message.assistant").last()).toContainText(
    "已處理重新送出的補充。",
  );
  assert.equal(
    app.product.db.all<Job>("job").find((job) => job.retryOf === queued.id)!
      .prompt,
    queued.prompt,
  );
  await page.reload();
  await expect(unexecuted).toContainText("補充已重新送出");
  assert.equal(
    await unexecuted
      .getByRole("button", { name: "重新送出", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        model: "deterministic fixture",
        checks: [
          "legacy long title compact, full title preserved",
          "rename saves without changing request",
          "steering rejection preserves draft",
          "steering pending and adopted receipts",
          "confirmed not-applied receipt preserves draft and renews request ID",
          "current work versus queued next request",
          "stopped queued request survives reload with original prompt and reason",
          "double click retries exactly once",
          "phone header and overflow",
          "running verification receipts refresh without task timestamp changes",
          "local edits invalidate browser verification on the next polling interval",
          "task queue and interrupted retry banners stay out of main chat",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Task follow-up browser verification passed.");
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  console.error(
    await page.locator(".cw-compose").evaluate((form) => ({
      text: form.textContent,
      draft: form.querySelector("textarea")?.value,
      disabled: form.querySelector("button.primary")?.hasAttribute("disabled"),
    })),
  );
  throw error;
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
