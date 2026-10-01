// Isolated product test: delay a successful DELETE response while its SSE
// notification has already arrived. Never controls user Chrome or model keys.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";

const baseline = process.argv.includes("--baseline");
const output = resolve("artifacts/bot-removal-sync");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-removal-sync-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => {
    throw new Error("This test must not submit work");
  },
});
const bot = await app.product.bots.create("刪除同步測試");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ executablePath: browserExecutable() });
let releaseDelete = () => {};
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await page.goto(base);
  await page.locator(".header-profile").click();
  await page.locator(".profile-management > summary").click();
  await page.getByRole("button", { name: "刪除 Bot", exact: true }).click();
  await page
    .getByRole("dialog", { name: "刪除 Bot", exact: true })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(app.product.bots.bot(bot.id).id, bot.id);
  await page.getByRole("button", { name: "刪除 Bot", exact: true }).click();
  let removed = false,
    deletionRequests = 0;
  const staleReads: string[] = [];
  page.on("request", (request) => {
    if (
      removed &&
      request.method() === "GET" &&
      request.url().includes(`/bots/${bot.id}?view=summary`)
    )
      staleReads.push(request.url());
  });
  let markRemoved = () => {};
  const serverRemoved = new Promise<void>((resolve) => {
    markRemoved = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  await page.route(`**/api/v2/bots/${bot.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletionRequests++;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    removed = true;
    markRemoved();
    await responseGate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "確認刪除", exact: true }).click();
  await serverRemoved;
  assert.equal(app.product.queries.snapshot().bots.length, 0);
  // SSE is debounced by 160ms. Keep DELETE pending beyond that boundary.
  await page.waitForTimeout(500);
  if (!baseline)
    await expect(
      page.getByRole("button", { name: "停止回覆並刪除中…", exact: true }),
    ).toBeDisabled();
  await page.screenshot({
    path: join(output, baseline ? "before-pending.png" : "pending.png"),
  });
  releaseDelete();
  await page
    .getByRole("button", { name: "建立第一個 Bot", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "建立第一個 Bot", exact: true })
    .waitFor();
  const report = {
    baseline,
    deletionRequests,
    staleDetailReads: staleReads.length,
    noBotAfterReload: app.product.queries.snapshot().bots.length === 0,
    selectedStorageCleared: await page.evaluate(
      () => localStorage.getItem("apsis.bot") === null,
    ),
    errors,
  };
  await writeFile(
    join(output, baseline ? "before.json" : "after.json"),
    JSON.stringify(report, null, 2),
  );
  assert.equal(deletionRequests, 1);
  if (baseline)
    assert.ok(
      staleReads.length > 0,
      "Baseline must reproduce the obsolete detail read",
    );
  else {
    assert.equal(staleReads.length, 0);
    assert.equal(report.selectedStorageCleared, true);
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify(report));
} finally {
  releaseDelete();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
