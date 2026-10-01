import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";

const label =
  process.argv.find((arg) => arg.startsWith("--label="))?.slice(8) ?? "current";
assert.match(label, /^[a-z0-9-]+$/);
const trace = process.argv.includes("--trace");
const isolated = process.argv.includes("--isolated");
const verify = process.argv.includes("--verify");
if (verify)
  assert.ok(isolated, "Performance gates require an isolated fixture.");
const count = process.argv.includes("--repeat") ? 3 : 1;
const output = resolve("artifacts/startup-performance");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-startup-"));
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
const bot = await app.product.bots.create("啟動測試夥伴");
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
const reports: object[] = [];
try {
  for (let trial = 0; trial < count; trial++) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      reducedMotion: "reduce",
    });
    await context.addInitScript((id) => {
      localStorage.setItem("apsis.bot", id);
      const metrics = {
        mounted: 0,
        ready: 0,
        longTasks: [] as { startTime: number; duration: number }[],
        lifecycle: [] as { name: string; time: number }[],
      };
      (window as unknown as { startupMetrics: typeof metrics }).startupMetrics =
        metrics;
      new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) =>
          metrics.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          }),
        ),
      ).observe({ type: "longtask", buffered: true });
      const observer = new MutationObserver(() => {
        if (!metrics.mounted && document.querySelector(".app"))
          metrics.mounted = performance.now();
        if (document.querySelectorAll(".message").length === 16) {
          metrics.ready = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      for (const name of ["DOMContentLoaded", "load"])
        window.addEventListener(name, () =>
          metrics.lifecycle.push({ name, time: performance.now() }),
        );
    }, bot.id);
    const page = await context.newPage();
    const blockedExternal: string[] = [];
    if (isolated)
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        blockedExternal.push(url.origin + url.pathname);
        return route.abort("blockedbyclient");
      });
    const errors: string[] = [];
    let stateReads = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v2/state") stateReads++;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
      connectionType: "cellular4g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const events: object[] = [];
    if (trace && trial === 0) {
      cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
      await cdp.send("Tracing.start", {
        categories:
          "devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline",
        transferMode: "ReportEvents",
      });
    }
    // No screenshot or font readiness wait participates in readiness measurement.
    await page.goto(base, { waitUntil: "commit" });
    await expect(page.locator(".message")).toHaveCount(16, { timeout: 30000 });
    const report = await page.evaluate(() => ({
      metrics: (window as unknown as { startupMetrics: object }).startupMetrics,
      paints: performance
        .getEntriesByType("paint")
        .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
      navigation: performance
        .getEntriesByType("navigation")
        .map((entry) => entry.toJSON()),
      resources: performance.getEntriesByType("resource").map((item) => {
        const entry = item as PerformanceResourceTiming;
        return {
          name: new URL(entry.name).pathname,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        };
      }),
    }));
    assert.deepEqual(errors, []);
    if (verify) {
      const metrics = report.metrics as { mounted: number; ready: number };
      const program = report.resources.find(
        (entry) => entry.name === "/bot.js",
      );
      assert.ok(
        program && program.decodedBodySize <= 700000,
        "Measure the production browser, never a development rebuild.",
      );
      assert.ok(metrics.mounted > 0 && metrics.ready > metrics.mounted);
      assert.ok(
        stateReads <= 2,
        "Initial Bot reads must not be invalidated by redundant refreshes.",
      );
      assert.ok(
        metrics.ready <= 5000,
        "Investigate startup readiness above the fixture's 5s budget.",
      );
      const paint = report.paints.find(
        (entry) => entry.name === "first-contentful-paint",
      );
      assert.ok(
        paint && paint.startTime <= 1500,
        "The preparation screen must paint within the fixture's 1.5s budget.",
      );
    }
    reports.push({ trial, ...report, errors, blockedExternal, stateReads });
    console.log(
      JSON.stringify({
        trial,
        metrics: report.metrics,
        paints: report.paints,
        blockedExternal,
        stateReads,
      }),
    );
    if (trace && trial === 0) {
      const completed = new Promise<void>((resolve) =>
        cdp.once("Tracing.tracingComplete", () => resolve()),
      );
      await cdp.send("Tracing.end");
      await completed;
      await writeFile(
        join(output, `${label}-trace.json`),
        JSON.stringify({ traceEvents: events }),
      );
    }
    await page.screenshot({ path: join(output, `${label}-${trial}.png`) });
    await context.close();
  }
  await writeFile(
    join(output, `${label}.json`),
    JSON.stringify(
      {
        label,
        isolated,
        verified: verify,
        conditions: {
          viewport: "375x812",
          reducedMotion: true,
          latencyMs: 150,
          downloadBytesPerSecond: 200000,
          cpuSlowdown: 4,
          cacheDisabled: true,
        },
        reports,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
