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
    const child = {
      id: "native-1",
      name: "Test analysis",
      task: "檢查 concurrency coverage",
      status: "running" as const,
      progress: "正在閱讀 auth-client.test.ts",
      startedAt,
    };
    options.emit({
      type: "execution",
      evidence: { kind: "subagent", activity: child },
    });
    options.emit({
      type: "execution",
      evidence: {
        kind: "planning",
        todos: [
          { content: "檢查登入流程", status: "completed" },
          { content: "補上測試", status: "in_progress" },
        ],
      },
    });
    await options.authorize?.(
      "shell",
      { command: "git push origin fixture" },
      options.signal,
    );
    await gate;
    options.emit({
      type: "execution",
      evidence: {
        kind: "subagent",
        activity: {
          ...child,
          status: "completed",
          resultSummary: "找到缺少 concurrent refresh test",
          endedAt: new Date().toISOString(),
        },
      },
    });
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
app.product.settings.update(
  { approvalMode: "manual" },
  app.product.settings.read().revision,
);
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
  const live = page.locator(".message.live .execution-evidence");
  await live.getByText("1 個子代理正在協作", { exact: true }).waitFor();
  const rosterCount = await page.locator("button.bot-row").count();
  for (const name of [
    "execution-thinking",
    "execution-subagents",
    "execution-tools",
  ])
    assert.equal(await live.locator(`.${name}`).getAttribute("open"), null);
  assert.equal(
    await live
      .getByText("正在閱讀 auth-client.test.ts", { exact: true })
      .isVisible(),
    false,
  );
  const approval = page.locator(".approval-card");
  await approval.waitFor();
  await page.screenshot({ path: join(output, "execution-collapsed.png") });
  assert.equal(await approval.locator("xpath=ancestor::details").count(), 0);
  await approval.getByRole("button", { name: "核准並繼續" }).click();
  await live.locator(".execution-subagents > summary").click();
  await live
    .getByText("正在閱讀 auth-client.test.ts", { exact: true })
    .waitFor();
  await live.getByText("檢查 concurrency coverage", { exact: true }).waitFor();
  await live.locator(".execution-thinking > summary").focus();
  await page.keyboard.press("Enter");
  await live.getByText("✓ 檢查登入流程", { exact: true }).waitFor();
  assert.equal(await live.locator(".work-commentary").count(), 2);
  await live.locator(".execution-tools > summary").click();
  const operation = live
    .locator(".task-row")
    .filter({ hasText: "scratch_write_file" });
  assert.equal(
    await operation
      .getByText("無效的虛擬檔案路徑。", { exact: true })
      .isVisible(),
    false,
  );
  await operation.locator("summary").click();
  await operation.getByText("無效的虛擬檔案路徑。", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "execution-expanded.png") });
  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await live.locator(".execution-tools > summary").click();
  finish();
  await page
    .locator(".message.assistant")
    .getByText("路徑已修正，工作完成。", { exact: true })
    .waitFor();
  assert.equal(await page.locator("button.bot-row").count(), rosterCount);
  await page.reload();
  const history = page.locator(".message.assistant .execution-evidence");
  await history.getByText("1 個子代理完成", { exact: true }).waitFor();
  for (const name of [
    "execution-thinking",
    "execution-subagents",
    "execution-tools",
  ])
    assert.equal(await history.locator(`.${name}`).getAttribute("open"), null);
  await history.locator(".execution-subagents > summary").click();
  await history
    .getByText("找到缺少 concurrent refresh test", { exact: true })
    .waitFor();
  await history.locator(".execution-thinking > summary").click();
  await history
    .getByText("我會先確認檔案路徑，再建立遊戲。", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".message.assistant")
      .evaluate(
        (el) =>
          !!el.querySelector(".message-body") &&
          (el
            .querySelector(".message-body")!
            .compareDocumentPosition(el.querySelector(".execution-evidence")!) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
      ),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(output, "execution-completed.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: native child visibility, collapsed thinking/subagents/tools, nested evidence, prominent approval, persistence/reload, unchanged roster, final answer first, keyboard/mobile, no browser errors",
  );
} finally {
  finish();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
