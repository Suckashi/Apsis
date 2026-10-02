import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { verificationLaunch } from "./verification-browser.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-assistant-browser-"));
const output = resolve("artifacts/single-assistant");
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (o) => {
    if (o.prompt.includes("failure")) throw new Error("Synthetic work failure");
    if (o.prompt.includes("approval"))
      await o.authorize?.(
        "shell",
        { command: "rm -rf important", cwd: "." },
        o.signal,
      );
    if (o.prompt.includes("long")) {
      o.registerSteer?.(async (_text, applied) => {
        await applied?.();
      });
      await new Promise<void>((done) =>
        o.signal.addEventListener("abort", () => done(), { once: true }),
      );
    }
    return { text: "Completed: " + o.prompt };
  },
});
const c = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({ connectionId: c.id, model: c.model });
app.product.settings.update({
  revision: app.product.settings.read().revision,
  locale: "en",
});
await app.product.bootstrap();
const bot = app.product.db.bots.list()[0];
await app.product.bots.update(bot.id, { avatar: "cloud" });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await verificationLaunch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.locator("#background-prompt")).toBeVisible();
  assert.equal(
    await page.locator(".new-bot, .chat-roster, .menu-new-topic").count(),
    0,
  );
  await page.locator("#background-prompt").fill("A long background work");
  await page
    .getByRole("button", { name: "Start background work", exact: true })
    .click();
  const card = page
    .locator(".work-card")
    .filter({ hasText: "A long background work" });
  await expect(card.locator('[data-presence="running"]')).toBeVisible();
  await expect(card.locator('[data-avatar="cloud"]')).toBeVisible();
  const composer = page
    .locator("textarea")
    .filter({ hasNot: page.locator("#background-prompt") });
  const chat = page.locator("textarea:not(#background-prompt)");
  await chat.fill("B main chat");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".conversation")).toContainText(
    "Completed: B main chat",
  );
  await expect(card.locator('[data-presence="running"]')).toBeVisible();
  const activeJob = app.product.db.jobs
    .list()
    .find((j) => j.prompt === "A long background work")!;
  const activeRun = app.tasks.runs.records.get(activeJob.runId!)!;
  const startedAt = activeRun.createdAt;
  activeRun.createdAt = new Date(Date.now() - 90000).toISOString();
  app.product.notify(bot.id, activeJob.id);
  await expect(card.locator('[data-presence="stale"]')).toBeVisible();
  assert.equal(
    await card
      .locator(".presence-avatar")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.screenshot({
    path: join(output, "stale-progress.png"),
    fullPage: true,
  });
  activeRun.createdAt = startedAt;
  app.product.notify(bot.id, activeJob.id);
  await expect(card.locator('[data-presence="running"]')).toBeVisible();
  await Promise.all([
    app.product.browser.act(activeJob.sessionId!, {
      action: "navigate",
      url: base + "#background",
      selector: "",
      text: "",
    }),
    app.product.browser.act(bot.sessionId, {
      action: "navigate",
      url: base + "#chat",
      selector: "",
      text: "",
    }),
  ]);
  assert.notEqual(
    app.product.browser.pages.get(activeJob.sessionId!),
    app.product.browser.pages.get(bot.sessionId),
  );
  assert.equal(
    app.product.browser.pages.get(activeJob.sessionId!)!.url(),
    base + "/#background",
  );
  assert.equal(
    app.product.browser.pages.get(bot.sessionId)!.url(),
    base + "/#chat",
  );
  await page.screenshot({
    path: join(output, "desktop-working.png"),
    fullPage: true,
  });
  await page.locator("#background-prompt").fill("approval work");
  await page
    .getByRole("button", { name: "Start background work", exact: true })
    .click();
  await expect(
    page.locator('.work-card [data-presence="approval"]'),
  ).toBeVisible();
  assert.equal(
    await page
      .locator(".presence-approval .presence-avatar")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.screenshot({
    path: join(output, "desktop-approval.png"),
    fullPage: true,
  });
  await page
    .locator(".work-approval")
    .getByRole("button", { name: "Deny", exact: true })
    .click();
  await page.locator("#background-prompt").fill("failure work");
  await page
    .getByRole("button", { name: "Start background work", exact: true })
    .click();
  await expect(
    page
      .locator(".work-card")
      .filter({ hasText: "failure work" })
      .locator('[data-presence="failed"]'),
  ).toBeVisible();
  await page.context().setOffline(true);
  await expect(
    page.locator('.conversation > [data-presence="disconnected"]'),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, "disconnected.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await expect(
    page.locator('.conversation > [data-presence="idle"]'),
  ).toBeVisible({ timeout: 15000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await card
      .locator(".presence-avatar")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await card.locator("summary").first().click();
  await card
    .getByRole("button", { name: "Stop this work", exact: true })
    .click();
  await expect(card.locator('[data-presence="cancelled"]')).toBeVisible();
  await page.reload();
  await expect(page.locator(".conversation")).toContainText(
    "Completed: B main chat",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await chat.fill("Mobile reply");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".conversation")).toContainText(
    "Completed: Mobile reply",
  );
  await page.screenshot({
    path: join(output, "mobile-chat.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Assistant desktop/mobile: chat B during A, lifecycle motion, approvals, failure, disconnect/reconnect, reduced motion, stop and reload passed.",
  );
} finally {
  await browser.close();
  await app.close();
}
