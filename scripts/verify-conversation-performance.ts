import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { TaskRun } from "../shared/types.ts";
import { build } from "esbuild";
import { browserBuildOptions } from "./browser-build.ts";

// Isolated workload: 80 exchanges, 32 KiB of real operation evidence per run.
// Only the measurement page instruments Markdown; production has no counters.
const baseline = process.env.APSIS_PERF_BASELINE === "1";
const instrumented = await build({
  ...browserBuildOptions(true),
  write: false,
  sourcemap: false,
  plugins: [
    {
      name: "measure-markdown",
      setup(builder) {
        builder.onLoad(
          { filter: /public[\\/]markdown\.ts$/ },
          async (args) => ({
            contents: (await readFile(args.path, "utf8")).replace(
              "export function renderMarkdown(source: string): string {",
              "export function renderMarkdown(source: string): string { (window as any).__markdownParses = ((window as any).__markdownParses || 0) + 1;",
            ),
            loader: "ts",
          }),
        );
      },
    },
  ],
});
const bundleBytes = (await stat("dist/production-public/bot.js")).size;
const output = resolve("artifacts/conversation-performance");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-performance-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => ({ text: "已收到新的訊息。" }),
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
const bot = await app.product.bots.create("長對話助理");
const location = app.product.workLocation(bot);
const contextId = app.tasks.store.conversations.activeId(bot.sessionId);
const workspace = app.tasks.locations.workspace(location);
const runIds: string[] = [];
for (let index = 0; index < 80; index++) {
  const id = randomUUID();
  runIds.push(id);
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
  const text =
    `## 第 ${index + 1} 次交付\n\n` +
    "工作已完成，請檢閱檔案內容與執行證據。\n\n".repeat(30) +
    "```ts\nconst result = '成果';\n```\n";
  const path = `reports/report-${index + 1}.md`;
  await workspace.write(path, `# 第 ${index + 1} 次交付`);
  const run: TaskRun = {
    id,
    sessionId: bot.sessionId,
    workContextId: contextId,
    location,
    engine: "deepagents",
    agentName: bot.name,
    model: "fixture",
    permissions: { files: true, memory: true, skills: true },
    status: "completed",
    createdAt,
    endedAt: createdAt,
    text,
    activity: [],
    operations: [
      {
        id: `${id}-write`,
        name: "write_file",
        target: path,
        mutating: true,
        status: "succeeded",
        startedAt: createdAt,
        endedAt: createdAt,
        evidence: { output: "evidence ".repeat(4096) },
      },
    ],
  };
  await app.tasks.runs.save(run);
  for (const role of ["user", "assistant"] as const) {
    app.tasks.store.conversations.append(
      bot.sessionId,
      {
        id: randomUUID(),
        runId: id,
        role,
        status: "complete",
        createdAt,
        content: role === "assistant" ? text : `請交付第 ${index + 1} 份報告。`,
      },
      contextId,
    );
  }
}
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
let releaseSlowRead = () => {};
let closing = false;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/bot.js", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: instrumented.outputFiles![0].text });
  });
  const records = new Set<string>();
  let recordRequests = 0,
    statusRequests = 0,
    evidenceBytes = 0;
  const pendingResponses: Promise<void>[] = [];
  page.on("request", (request) => {
    if (/\/runs\/[a-f0-9-]+$/.test(request.url())) {
      recordRequests++;
      records.add(request.url());
    }
    if (/\/status\?path=/.test(request.url())) statusRequests++;
  });
  page.on("response", (response) => {
    if (/\/runs\/[a-f0-9-]+$/.test(response.url())) {
      pendingResponses.push(
        response
          .body()
          .then((body) => {
            evidenceBytes += body.length;
          })
          .catch((error) => {
            if (!closing) errors.push(error.message);
          }),
      );
    }
  });
  await page.goto(base);
  const started = performance.now();
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(page.locator(".message.assistant")).toHaveCount(25);
  const latest = page.locator(".message.assistant").last();
  await expect(latest.locator(".run-files > summary")).toBeVisible();
  await latest.locator(".run-files > summary").click();
  await expect(
    latest.getByRole("button", {
      name: "預覽檔案 reports/report-80.md",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    latest.getByRole("button", {
      name: "預覽檔案 reports/report-80.md",
      exact: true,
    }),
  ).toBeInViewport();
  const latestReadyMs = Math.round(performance.now() - started);
  // Allow in-flight effects to settle; the counter gate tests bounded work,
  // not wall-clock speed on this particular machine.
  await page.waitForTimeout(250);
  await Promise.all(pendingResponses);
  const initial = {
    recordRequests,
    uniqueRecords: records.size,
    statusRequests,
    evidenceBytes,
    latestReadyMs,
  };
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  const parses = () =>
    page.evaluate(
      () =>
        (window as unknown as { __markdownParses: number }).__markdownParses,
    );
  const beforeTyping = await parses();
  const typingStarted = performance.now();
  await input.pressSequentially("保留草稿，繼續閱讀前面的報告", { delay: 5 });
  await expect(input).toHaveValue("保留草稿，繼續閱讀前面的報告");
  const typingMs = Math.round(performance.now() - typingStarted);
  const parsesWhileTyping = (await parses()) - beforeTyping;
  if (!baseline) {
    assert.ok(
      bundleBytes <= 700_000,
      "Production chat JavaScript must stay within its initial-load budget",
    );
    assert.ok(initial.uniqueRecords <= 6, JSON.stringify(initial));
    assert.ok(initial.statusRequests <= 6, JSON.stringify(initial));
    assert.equal(
      parsesWhileTyping,
      0,
      "Editing a draft must not reparse unchanged messages",
    );
  }
  const first = page.locator(".message.assistant").first();
  await first.scrollIntoViewIfNeeded();
  await first.locator(".run-files > summary").click();
  await expect(
    first.getByRole("button", {
      name: "預覽檔案 reports/report-56.md",
      exact: true,
    }),
  ).toBeEnabled();
  await first.locator(".execution-tools > summary").click();
  await expect(first.locator(".task-row")).toHaveCount(1);
  await first.locator(".execution-tools > summary").click();
  await page.getByRole("button", { name: "更早的訊息", exact: true }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(50);
  await expect(input).toHaveValue("保留草稿，繼續閱讀前面的報告");
  const oldestLoaded = page.locator(".message.assistant").first();
  if (!baseline) {
    const slowGate = new Promise<void>((resolve) => {
      releaseSlowRead = resolve;
    });
    await page.route(`**/runs/${runIds[30]}`, async (route) => {
      await slowGate;
      await route.continue();
    });
    const requested = page.waitForRequest((request) =>
      request.url().endsWith(`/runs/${runIds[30]}`),
    );
    await oldestLoaded.scrollIntoViewIfNeeded();
    await requested;
    const beforeSlowTyping = await parses();
    await input.fill("檔案讀取中仍可編輯草稿");
    await expect(input).toHaveValue("檔案讀取中仍可編輯草稿");
    assert.equal((await parses()) - beforeSlowTyping, 0);
    assert.equal(
      await oldestLoaded
        .getByRole("button", {
          name: "預覽檔案 reports/report-31.md",
          exact: true,
        })
        .count(),
      0,
    );
    releaseSlowRead();
    await input.fill("保留草稿，繼續閱讀前面的報告");
  }
  await oldestLoaded.scrollIntoViewIfNeeded();
  await oldestLoaded.locator(".run-files > summary").click();
  await expect(
    oldestLoaded.getByRole("button", {
      name: "預覽檔案 reports/report-31.md",
      exact: true,
    }),
  ).toBeEnabled();
  const beforeReloadRequests = recordRequests;
  await page.getByRole("button", { name: /回到最新/ }).click();
  await expect(
    latest.getByRole("button", {
      name: "預覽檔案 reports/report-80.md",
      exact: true,
    }),
  ).toBeEnabled();
  await page.waitForTimeout(100);
  assert.equal(
    recordRequests,
    beforeReloadRequests,
    "Returning to read loaded evidence must reuse it",
  );
  await page.screenshot({
    path: join(output, baseline ? "before.png" : "after.png"),
  });
  assert.deepEqual(errors, []);
  const report = {
    fixture: {
      exchanges: 80,
      initialMessages: 50,
      operationOutputBytes: 36864,
    },
    bundleBytes,
    initial,
    parsesWhileTyping,
    typingMs,
    loadedMessages: 100,
    slowReadDraftVerified: !baseline,
    errors,
  };
  await writeFile(
    join(output, baseline ? "before.json" : "after.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  console.log(
    "PASS: production bundle budget, bounded historical loading, unchanged Markdown reuse, slow-read draft editing, older pagination and no console errors",
  );
} finally {
  releaseSlowRead();
  closing = true;
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
