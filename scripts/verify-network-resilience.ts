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

const baseline = process.argv.includes("--baseline");
const output = resolve("artifacts/network-resilience");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-network-"));
let finishRun = () => {},
  releaseBoot = () => {},
  releaseTimeout = () => {},
  runStarted = false;
let progressTimer: ReturnType<typeof setInterval> | undefined;
const received: string[] = [];
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    received.push(options.prompt);
    if (options.prompt === "長任務連線測試") {
      runStarted = true;
      let index = 0;
      progressTimer = setInterval(
        () => options.emit({ type: "progress", text: `同步進度 ${++index}` }),
        80,
      );
      await new Promise<void>((resolve) => {
        finishRun = resolve;
      });
      clearInterval(progressTimer);
    }
    return { text: "連線恢復後的回覆。" };
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
const bot = await app.product.bots.create("網路測試夥伴");
for (let i = 0; i < 16; i++)
  app.tasks.store.conversations.append(bot.sessionId, {
    id: crypto.randomUUID(),
    role: i % 2 ? "assistant" : "user",
    status: "complete",
    createdAt: new Date().toISOString(),
    content: `第 ${i + 1} 則對話。\n\n` + "這是持續合作的對話內容。".repeat(20),
  });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
try {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    (id) => localStorage.setItem("apsis.bot", id),
    bot.id,
  );
  await context.addInitScript(() => {
    const timing: { mounted?: number; ready?: number } = ((
      window as unknown as {
        networkTimings: { mounted?: number; ready?: number };
      }
    ).networkTimings = {});
    const observer = new MutationObserver(() => {
      if (!timing.mounted && document.querySelector(".app"))
        timing.mounted = performance.now();
      if (document.querySelectorAll(".message").length === 16) {
        timing.ready = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  const externalResourceOrigins = new Set<string>();
  page.on("request", (request) => {
    const origin = new URL(request.url()).origin;
    if (origin !== base) externalResourceOrigins.add(origin);
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const conditions = {
    offline: false,
    latency: 150,
    downloadThroughput: 200000,
    uploadThroughput: 93750,
    connectionType: "cellular4g" as const,
  };
  await cdp.send("Network.emulateNetworkConditions", conditions);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const started = performance.now();
  await page.goto(base, { waitUntil: "commit" });
  await page.locator("#root").waitFor({ state: "attached" });
  await page.screenshot({
    path: join(
      output,
      baseline ? "baseline-pending-data.png" : "pending-data.png",
    ),
  });
  await expect(page.locator(".message")).toHaveCount(16, { timeout: 30000 });
  const readyMs = Math.round(performance.now() - started);
  const browserTimings = await page.evaluate(
    () => (window as unknown as { networkTimings: object }).networkTimings,
  );
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((item) => {
        const entry = item as PerformanceResourceTiming;
        return {
          name: new URL(entry.name).pathname,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          transferSize: entry.transferSize,
          startTime: entry.startTime,
          responseStart: entry.responseStart,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
        };
      })
      .filter((item) => /\.(js|css)$/.test(item.name)),
  );
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  const conversation = page.getByRole("region", {
    name: `與 ${bot.name} 的對話`,
    exact: true,
  });
  await input.pressSequentially("慢網路下的草稿", { delay: 10 });
  await expect(input).toHaveValue("慢網路下的草稿");
  await page.screenshot({
    path: join(output, baseline ? "baseline-ready.png" : "limited-ready.png"),
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.send("Network.emulateNetworkConditions", {
    ...conditions,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await page.route("**/api/v2/state", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "暫時無法同步" }),
    }),
  );
  await page.reload();
  if (baseline)
    await expect(page.getByText("暫時無法同步", { exact: true })).toBeVisible();
  else {
    await expect(page.locator(".sync-banner")).toBeVisible();
    await page.locator(".sync-banner summary").click();
    await expect(page.getByText("暫時無法同步", { exact: true })).toBeVisible();
    await page.locator(".sync-banner summary").click();
  }
  const retryAvailable = await page
    .getByRole("button", { name: "重新同步", exact: true })
    .count();
  await page.screenshot({
    path: join(output, baseline ? "baseline-load-error.png" : "load-error.png"),
  });
  if (!baseline)
    assert.equal(
      retryAvailable,
      1,
      "read failures have a direct recovery action",
    );
  const audits: unknown[] = [];
  let visibleStreamingProgress = "",
    maxConcurrentAutomaticReads = 0;
  if (!baseline) {
    const audit = async (name: string) => {
      const result = await new AxeBuilder({ page })
        .withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21aa",
          "wcag22aa",
          "best-practice",
        ])
        .analyze();
      audits.push({
        name,
        violations: result.violations,
        incomplete: result.incomplete.map(({ id, nodes }) => ({
          id,
          targets: nodes.map((node) => node.target),
        })),
      });
      assert.deepEqual(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map((node) => node.target),
        })),
        [],
        name,
      );
    };
    await expect(
      page.getByText("為你的工作新增一位幫手。", { exact: true }),
    ).toHaveCount(0);
    await audit("phone-initial-read-failure");
    await page.unroute("**/api/v2/state");
    await page.getByRole("button", { name: "重新同步", exact: true }).click();
    await expect(page.locator(".message")).toHaveCount(16);
    await expect(input).toHaveValue("慢網路下的草稿");
    await expect(page.locator(".sync-banner")).toHaveCount(0);
    await expect(input).toBeFocused();
    await page.route("**/api/v2/state", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "再次同步失敗" }),
      }),
    );
    app.product.notify(bot.id);
    await expect(page.locator(".sync-banner")).toContainText(
      "已載入的內容與草稿仍保留",
    );
    await expect(page.locator(".message")).toHaveCount(16);
    await expect(input).toHaveValue("慢網路下的草稿");
    await audit("phone-loaded-read-failure");
    await page.screenshot({ path: join(output, "loaded-read-failure.png") });
    await page.unroute("**/api/v2/state");
    await page.getByRole("button", { name: "重新同步", exact: true }).click();
    await expect(page.locator(".sync-banner")).toHaveCount(0);
    let inFlight = 0;
    await page.route("**/api/v2/state", async (route) => {
      inFlight++;
      maxConcurrentAutomaticReads = Math.max(
        maxConcurrentAutomaticReads,
        inFlight,
      );
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 450));
      await route.fulfill({ response });
      inFlight--;
    });
    await input.fill("長任務連線測試");
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    await expect.poll(() => runStarted).toBe(true);
    const progress = page.locator(".header-profile");
    await expect(progress).toContainText(/同步進度 \d+/, { timeout: 5000 });
    visibleStreamingProgress = await progress.innerText();
    assert.ok(
      maxConcurrentAutomaticReads <= 2,
      "automatic reads coalesce; a manual post-send sync may overlap once",
    );
    await page.unrouteAll({ behavior: "wait" });
    await input.fill("離線也保留這份草稿");
    await context.setOffline(true);
    await expect(
      page.getByText("目前離線。恢復網路後會自動同步。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "補充指示", exact: true }),
    ).toBeDisabled();
    await expect(input).toBeEditable();
    await audit("phone-offline-running");
    await page.screenshot({ path: join(output, "offline-running.png") });
    finishRun();
    await expect
      .poll(() => app.product.queries.detail(bot.id).jobs[0]?.status)
      .toBe("completed");
    await expect(
      conversation.getByText("連線恢復後的回覆。", { exact: true }),
    ).toHaveCount(0);
    await context.setOffline(false);
    await expect(
      conversation.getByText("連線恢復後的回覆。", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(input).toHaveValue("離線也保留這份草稿");
    await expect(
      page.getByRole("button", { name: "傳送", exact: true }),
    ).toBeEnabled();
    assert.deepEqual(received, ["長任務連線測試"]);
    await audit("phone-reconnected");
    await page.screenshot({ path: join(output, "reconnected.png") });
    const timeoutGate = new Promise<void>((resolve) => {
      releaseTimeout = resolve;
    });
    await page.route("**/api/v2/state", async (route) => {
      await timeoutGate;
      await route.abort().catch(() => {});
    });
    app.product.notify(bot.id);
    await expect(page.locator(".sync-banner")).toBeVisible({ timeout: 20000 });
    await page.locator(".sync-banner summary").click();
    await expect(
      page.getByText("同步逾時，請再試一次。", { exact: true }),
    ).toBeVisible();
    await expect(input).toHaveValue("離線也保留這份草稿");
    releaseTimeout();
    await page.unrouteAll({ behavior: "wait" });
    await page.getByRole("button", { name: "重新同步", exact: true }).click();
    await expect(page.locator(".sync-banner")).toHaveCount(0);
    await expect(input).toBeFocused();
    app.product.settings.update(
      { locale: "en" },
      app.product.settings.read().revision,
    );
    const bootContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    await bootContext.addInitScript((id) => {
      localStorage.setItem("apsis.bot", id);
      localStorage.setItem("apsis.theme", "dark");
      localStorage.setItem("apsis.locale", "en");
    }, bot.id);
    const bootPage = await bootContext.newPage();
    const bootGate = new Promise<void>((resolve) => {
      releaseBoot = resolve;
    });
    await bootPage.route("**/bot.js", async (route) => {
      await bootGate;
      await route.continue();
    });
    await bootPage.goto(base, { waitUntil: "commit" });
    await expect(bootPage.locator("#apsis-boot")).toBeVisible();
    await expect(
      bootPage.getByText("Preparing your conversations", { exact: true }),
    ).toBeVisible();
    await expect(bootPage.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await bootPage.screenshot({
      path: join(output, "before-application-dark-en.png"),
      timeout: 5000,
    });
    const bootAudit = await new AxeBuilder({ page: bootPage })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    assert.deepEqual(
      bootAudit.violations.map((value) => value.id),
      [],
    );
    audits.push({
      name: "before-application-dark-en",
      violations: bootAudit.violations,
      incomplete: bootAudit.incomplete.map(({ id }) => ({ id })),
    });
    await expect(
      bootPage.getByRole("link", { name: "Reload", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await bootPage.screenshot({
      path: join(output, "before-application-delayed.png"),
    });
    releaseBoot();
    await expect(bootPage.locator(".message")).toHaveCount(18, {
      timeout: 10000,
    });
    await expect(bootPage.locator("#apsis-boot")).toHaveCount(0);
    await bootContext.close();
  }
  const report = {
    baseline,
    conditions,
    cpuSlowdown: 4,
    readyMs,
    browserTimings,
    resources,
    externalResourceOrigins: [...externalResourceOrigins],
    retryAvailable,
    errors,
    audits,
    visibleStreamingProgress,
    maxConcurrentAutomaticReads,
    draftAndBackgroundRunSurvivedOffline: !baseline,
    readTimeoutRecovery: !baseline,
    preApplicationThemeLocaleAndFallback: !baseline,
  };
  await writeFile(
    join(output, baseline ? "baseline.json" : "report.json"),
    JSON.stringify(report, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  finishRun();
  releaseBoot();
  releaseTimeout();
  clearInterval(progressTimer);
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
