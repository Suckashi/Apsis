import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { createApp } from "../server/app.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-tool-ui-"));
const output = resolve("artifacts/tool-feedback");
await mkdir(output, { recursive: true });
let finish!: () => void;
const gate = new Promise<void>((r) => {
  finish = r;
});
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
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
      error: "無效的虛擬檔案路徑。",
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
    await gate;
    await options.recordOperation?.({
      id: "retry",
      name: "model_retry",
      target: "1/3 · 0.5s",
      mutating: false,
      status: "succeeded",
      startedAt,
      endedAt: new Date().toISOString(),
    });
    return { text: "路徑已修正，工作完成。" };
  },
});
const c = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({ connectionId: c.id, model: c.model });
const bot = await app.product.create("工具進度測試");
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
  const live = page.locator(".message.live .task-history");
  await live
    .getByText("確認是路徑格式錯誤，接著改用工作區工具。", { exact: true })
    .waitFor();
  const commentary = await live.locator(".work-commentary").allTextContents();
  assert.equal(commentary.length, 2);
  await page.screenshot({ path: join(output, "work-timeline.png") });
  for (const group of await live.locator(".task-tool-group > summary").all())
    await group.click();
  await live
    .locator(".task-row")
    .filter({ hasText: "model_retry" })
    .locator("summary")
    .click();
  await live.getByText(/工具：model_retry/).waitFor();
  assert.equal(
    await live.locator(".task-summary").getAttribute("aria-expanded"),
    "true",
  );
  assert.match(await live.innerText(), /寫入暫存檔/);
  assert.match(await live.innerText(), /1\/3/);
  await live.locator(".task-row > summary").first().click();
  await live.getByText("無效的虛擬檔案路徑。", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "live-tools.png") });
  await live.locator(".task-summary").click();
  assert.equal(
    await live.locator(".task-summary").getAttribute("aria-expanded"),
    "false",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  finish();
  await page
    .locator(".message.assistant")
    .getByText("路徑已修正，工作完成。", { exact: true })
    .waitFor();
  const history = page.locator(".message.assistant .task-history");
  assert.equal(
    await history.locator(".task-summary").getAttribute("aria-expanded"),
    "false",
  );
  await history.locator(".task-summary").focus();
  await page.keyboard.press("Enter");
  await history.locator(".work-commentary").first().waitFor();
  await page.reload();
  await history.locator(".task-summary").click();
  await history
    .getByText("我會先確認檔案路徑，再建立遊戲。", { exact: true })
    .waitFor();
  for (const group of await history.locator(".task-tool-group").all())
    if ((await group.getAttribute("open")) === null)
      await group.locator(":scope > summary").click();
  const operation = history
    .locator(".task-row")
    .filter({ hasText: "scratch_write_file" });
  if ((await operation.getAttribute("open")) === null)
    await operation.locator("summary").click();
  await history.getByText(/工具：scratch_write_file/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: live tools and retry visible, error details, collapse, completion history, keyboard, mobile, no browser errors",
  );
} finally {
  finish();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
