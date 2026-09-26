import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-context-ui-"));
const output = resolve("artifacts/context-verification");
await mkdir(output, { recursive: true });
let quoted = "";
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    quoted = options.executionContext || "";
    return { text: "完成本次工作" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
  modelSettings: { fixture: { contextWindowTokens: 32768 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.create("長期對話測試");
await app.tasks.store.mutate((state) => {
  const session = state.sessions.find((s) => s.id === bot.sessionId)!;
  for (let i = 0; i < 80; i++)
    session.messages.push({
      id: "history-" + i,
      role: i % 2 ? "assistant" : "user",
      content: i === 0 ? "舊任務唯一證據青鳥" : `歷史紀錄 ${i}`,
      status: "complete",
    });
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.locator(".bot-row").filter({ hasText: bot.name }).click();
  await expect(page.locator("article.message")).toHaveCount(50);
  await page.getByRole("button", { name: "更早的訊息", exact: true }).click();
  await expect(page.locator("article.message")).toHaveCount(80);
  await expect(
    page.getByText("舊任務唯一證據青鳥", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新任務", exact: true }).click();
  await expect
    .poll(() => app.tasks.store.conversations.contexts(bot.sessionId).length)
    .toBe(2);
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  await page
    .locator("#bot-details")
    .getByRole("button", { name: /^記憶/ })
    .click();
  const panel = page.locator(".context-panel");
  await panel.getByRole("button", { name: "新增記憶" }).click();
  await panel.getByLabel("記憶內容").fill("請使用繁體中文");
  await panel.getByLabel("分類").selectOption("core");
  await panel.getByLabel("鎖定").check();
  await panel.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(
    panel.getByText("請使用繁體中文", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.tasks.store.state.memories.some(
        (m) => m.content === "請使用繁體中文",
      ),
    )
    .toBe(true);
  const memory = app.tasks.store.state.memories.find(
    (m) => m.content === "請使用繁體中文",
  )!;
  assert.equal(memory.locked, true);
  assert.equal(memory.tier, "core");
  await panel.getByText("歷史搜尋與任務", { exact: true }).click();
  await panel.getByLabel("搜尋歷史").fill("青鳥");
  await panel.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(
    panel.getByText("舊任務唯一證據青鳥", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "引用", exact: true }).click();
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("引用這份證據");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await expect.poll(() => quoted).toContain("舊任務唯一證據青鳥");
  await expect(
    page.locator("#conversation").getByText("完成本次工作", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "latest 50",
        "older page",
        "new task",
        "core memory and lock",
        "Chinese search",
        "quote across contexts",
        "mobile overflow",
        "no page errors",
      ],
      output,
    }),
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
