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

// Deterministic integration fixture: never calls a model provider.
const dir = await mkdtemp(join(tmpdir(), "apsis-workspace-ux-"));
const output = resolve("artifacts/workspace-ux");
await mkdir(output, { recursive: true });
let finishRun: (() => void) | undefined;
let adopt: (() => Promise<void>) | undefined;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    if (options.prompt.startsWith("hold")) {
      options.registerSteer?.(async (_text, onApplied) => {
        adopt = async () => {
          await onApplied?.();
        };
      });
      await new Promise<void>((resolve) => {
        finishRun = resolve;
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    }
    return { text: "Fixture reply" };
  },
});
const bot = await app.product.create("UX fixture");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
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
try {
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
  );
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await input.fill("保留我的草稿");
  await expect(page.locator(".model-setup-notice")).toBeVisible();
  await expect(page.locator(".header-profile small")).not.toContainText(
    "隨時可以",
  );
  await expect(
    page.getByRole("button", { name: "傳送", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: join(output, "model-unavailable.png") });
  await page.getByRole("button", { name: "設定模型連線", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "設定與工具", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("保留我的草稿");

  const connection = await app.connections.save({
    name: "Searchable provider",
    provider: "openai-compatible",
    model: "alpha",
    models: ["alpha", "beta"],
    modelSettings: { beta: { displayName: "Beta writer" } },
    url: "http://127.0.0.1:1/v1",
  });
  await app.connections.setDefault({
    connectionId: connection.id,
    model: "alpha",
  });
  app.product.notify(bot.id);
  await expect(page.locator(".model-setup-notice")).toHaveCount(0);
  const picker = page.locator(".composer-tools .model-picker");
  await picker.locator("summary").click();
  const search = picker.getByRole("combobox", {
    name: "搜尋模型",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill("not-a-model");
  await expect(
    picker.getByText("找不到符合的模型", { exact: true }),
  ).toBeVisible();
  await search.fill("Beta");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await search.press("Enter");
  await expect(picker.locator("summary")).toContainText("Beta writer");
  await expect(picker.locator("summary")).toBeFocused();
  await expect(input).toHaveValue("保留我的草稿");
  await picker.locator("summary").click();
  await search.press("Escape");
  await expect(picker).not.toHaveAttribute("open", "");
  await picker.locator("summary").click();
  await page.locator(".chat-header").click({ position: { x: 5, y: 5 } });
  await expect(picker).not.toHaveAttribute("open", "");
  await page.reload();
  await expect(picker.locator("summary")).toContainText("Beta writer");
  await expect(input).toHaveValue("保留我的草稿");

  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  await noOverflow();
  await page.screenshot({ path: join(output, "desktop-light.png") });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.screenshot({ path: join(output, "desktop-dark.png") });
  await input.fill("hold adoption");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.locator(".task-progress").waitFor();
  await input.fill("請使用繁體中文");
  await page.getByRole("button", { name: "補充指示", exact: true }).click();
  await expect(
    page.locator('.message-delivery[data-state="pending"]'),
  ).toHaveText("待採用");
  assert.ok(adopt);
  await adopt();
  await expect(
    page.locator('.message-delivery[data-state="applied"]'),
  ).toHaveText("已帶入下一回合");
  finishRun?.();
  await page.locator(".task-progress").waitFor({ state: "hidden" });
  await input.fill("hold cancellation");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.locator(".task-progress").waitFor();
  await input.fill("這則補充還沒有採用");
  await page.getByRole("button", { name: "補充指示", exact: true }).click();
  await expect(
    page.locator('.message-delivery[data-state="pending"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止任務", exact: true }).click();
  await expect(
    page.locator('.message-delivery[data-state="not-applied"]'),
  ).toHaveText("未採用");
  await expect(
    page.locator('.message-delivery[data-state="applied"]'),
  ).toHaveCount(1);
  await page.screenshot({ path: join(output, "steering-delivery.png") });
  await page.setViewportSize({ width: 720, height: 450 });
  await noOverflow();
  await page.screenshot({ path: join(output, "zoom-equivalent-200.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS workspace UX: unavailable state and repair, draft retention, searchable model keyboard/save/reload, outside dismissal, real steering delivery/cancellation, themes and 200% equivalent viewport",
  );
} finally {
  finishRun?.();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
