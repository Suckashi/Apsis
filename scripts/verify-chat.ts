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

const dir = await mkdtemp(join(tmpdir(), "apsis-chat-ui-"));
const output = resolve("artifacts/chat-verification");
await mkdir(output, { recursive: true });
let finish: (() => void) | undefined;
let adopt: (() => Promise<void>) | undefined;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    options.emit({
      type: "commentary",
      id: crypto.randomUUID(),
      text: "我正在整理內容。",
    });
    if (options.prompt.includes("hold")) {
      options.registerSteer?.(async (_text, callback) => {
        adopt = callback;
      });
      await new Promise<void>((r) => {
        finish = r;
        options.signal.addEventListener("abort", () => r(), { once: true });
      });
    }
    return { text: "已完成，結果在這裡。" };
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
const bot = await app.product.create("聊天幫手");
const other = await app.product.create("另一位幫手");
const location = app.product.workLocation(bot);
await mkdir(location.path, { recursive: true });
await writeFile(
  join(location.path, "note.md"),
  "# 聊天中的檔案\n\n仍然可以預覽。",
);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const menu = () => page.locator(".bot-actions-menu > summary");
const input = () =>
  page.getByRole("textbox", { name: "傳送訊息", exact: true });
try {
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(page.locator(".details")).toHaveCount(0);
  await expect(
    page.locator(".cw-tabs, .cw-project-nav, .bot-task-list"),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "傳送方式" })).toHaveCount(0);
  await input().fill("保留草稿");
  await page.locator(`.bot-row[title="${other.name}"]`).click();
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(input()).toHaveValue("保留草稿");
  await menu().click();
  await page.getByRole("button", { name: "聊天選項", exact: true }).click();
  const options = page.getByRole("dialog", { name: "聊天選項", exact: true });
  await expect(options.locator(".model-picker")).toBeVisible();
  await expect(
    options.getByRole("button", { name: "工作資料夾", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input()).toHaveValue("保留草稿");
  await input().fill("hold 請幫我整理");
  await input().press("Enter");
  await expect(
    page.getByRole("button", { name: "停止回覆", exact: true }),
  ).toBeVisible();
  await input().fill("加上摘要");
  await input().press("Enter");
  await expect(page.locator(".message-delivery")).toHaveText("已收到");
  await expect.poll(() => !!adopt).toBe(true);
  await adopt!();
  await expect(page.locator(".message-delivery")).toHaveText("已採用");
  assert.equal(app.product.db.all("job").length, 1);
  await page.screenshot({ path: join(output, "desktop-working.png") });
  finish!();
  await expect(
    page.locator(".message.assistant .markdown").last(),
  ).toContainText("已完成");
  await page.reload();
  await expect(page.locator(".message-delivery")).toHaveText("已採用");
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  await page.getByRole("button", { name: "note.md", exact: true }).click();
  await expect(page.locator(".details")).toContainText("聊天中的檔案");
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await menu().click();
  await page.getByRole("button", { name: "開啟新話題", exact: true }).click();
  await expect(page.locator(".topic-divider").last()).toHaveText("新話題");
  await expect(page.locator(".message.user").first()).toContainText("hold");
  await input().fill("新的話題");
  await input().press("Enter");
  await expect(page.locator(".message.assistant .markdown")).toHaveCount(2);
  await page.screenshot({ path: join(output, "desktop-chat.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input()).toBeVisible();
  await input().fill("手機換行");
  await input().press("Enter");
  await expect(input()).toHaveValue("手機換行\n");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await expect(page.locator(".message.assistant .markdown")).toHaveCount(3);
  await menu().click();
  await page.getByRole("button", { name: "聊天選項", exact: true }).click();
  await expect(options).toBeVisible();
  await page.keyboard.press("Escape");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  await page.screenshot({ path: join(output, "mobile-chat.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "single conversation",
          "drafts",
          "options",
          "steering receipt",
          "reload",
          "files",
          "new topic",
          "mobile",
          "no page errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Chat browser verification passed.");
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") });
  throw error;
} finally {
  finish?.();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
