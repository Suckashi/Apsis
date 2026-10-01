import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-delivery-"));
const output = resolve("artifacts/run-delivery");
await mkdir(output, { recursive: true });
const primary = "bundle/成果 說明.md";
const long = `bundle/${"很長的成果檔名".repeat(12)}.md`;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    const version = options.prompt.includes("第二版") ? "第二版" : "第一版";
    for (const [i, path] of [
      primary,
      "bundle/gone.md",
      long,
      "bundle/other.md",
      primary,
    ].entries()) {
      await options.workspace.write(path, `# ${version}\n\n${path}`);
      await options.recordOperation?.({
        id: `write-${i}`,
        name: i === 4 ? "edit_file" : "write_file",
        target: path,
        mutating: true,
        status: "succeeded",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }
    await unlink(join(options.workspace.root, "bundle", "gone.md"));
    await options.recordOperation?.({
      id: "failed",
      name: "write_file",
      target: "never.md",
      mutating: true,
      status: "failed",
      startedAt: new Date().toISOString(),
      error: "Fixture failure",
    });
    return { text: `${version}交付完成。` };
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
const bot = await app.product.bots.create("成果助理");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
let releaseTopic = () => {};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await input.fill("交付第一版");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const first = page
    .locator(".message.assistant")
    .filter({ hasText: "第一版交付完成。" });
  const cards = first.getByRole("group", { name: "修改的檔案" });
  const open = (scope: typeof first, path = primary) =>
    scope.getByRole("button", { name: `預覽檔案 ${path}`, exact: true });
  await expect(cards).toBeVisible();
  await expect(cards).not.toHaveAttribute("open", "");
  await expect(open(first)).toBeHidden();
  await cards.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(open(first)).toBeEnabled();
  await expect(cards.locator("li")).toHaveCount(3);
  await expect(open(first, "bundle/gone.md")).toBeDisabled();
  await expect(cards.getByText("已移動或移除", { exact: true })).toBeVisible();
  assert.equal(
    await cards
      .getByRole("link", { name: "下載檔案 bundle/gone.md", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await cards
      .getByRole("button", { name: "預覽檔案 never.md", exact: true })
      .count(),
    0,
  );
  await cards
    .getByRole("button", { name: "顯示其餘 1 個檔案", exact: true })
    .click();
  await expect(cards.locator("li")).toHaveCount(4);
  await cards.getByRole("button", { name: "收合檔案", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await cards
    .getByRole("link", { name: `下載檔案 ${primary}`, exact: true })
    .click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), "成果 說明.md");
  assert.match(await readFile((await download.path())!, "utf8"), /第一版/);
  await open(first).focus();
  await page.keyboard.press("Enter");
  const files = page.getByRole("region", { name: "工作資料與檔案" });
  await expect(
    files.getByRole("heading", { name: "第一版", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  const topicGate = new Promise<void>((resolve) => {
    releaseTopic = resolve;
  });
  await page.route("**/contexts", async (route) => {
    await topicGate;
    await route.continue();
  });
  await page.getByRole("button", { name: "開啟新話題", exact: true }).click();
  await input.fill("交付第二版");
  await expect(
    page.getByText("正在開啟新話題…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "傳送", exact: true }),
  ).toBeDisabled();
  await input.press("Enter");
  await expect(page.locator(".message.user")).toHaveCount(1);
  await expect(input).toHaveValue("交付第二版");
  await page.screenshot({ path: join(output, "pending-topic.png") });
  releaseTopic();
  await expect(
    page.getByRole("button", { name: "傳送", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const second = page
    .locator(".message.assistant")
    .filter({ hasText: "第二版交付完成。" });
  await second.locator(".run-files > summary").click();
  await expect(open(second)).toBeEnabled();
  await open(second).click();
  await expect(
    files.getByRole("heading", { name: "第二版", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await input.fill("保留這份草稿");
  await open(first).click();
  await expect(page.getByText("先前話題的檔案", { exact: true })).toBeVisible();
  await expect(
    files.getByRole("heading", { name: "第一版", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("保留這份草稿");
  await page.screenshot({ path: join(output, "earlier-topic-preview.png") });
  await page.getByRole("button", { name: "回到目前話題", exact: true }).click();
  await expect(
    files.getByRole("heading", { name: "第二版", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  if (!process.argv.includes("--desktop")) {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(first).click();
    await expect(
      page.getByRole("dialog", { name: "工作內容", exact: true }),
    ).toBeVisible();
    await expect(
      files.getByRole("heading", { name: "第一版", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: join(output, "mobile-preview.png") });
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("保留這份草稿");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await open(first, long).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "mobile-delivery.png") });
    for (const target of await cards.locator("button:not(:disabled),a").all()) {
      const box = await target.boundingBox();
      if (box)
        assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
    }
  }
  const location = app.product.workLocation(bot);
  const unsafe = await fetch(
    `${base}/api/v2/work-locations/${location.id}/status?path=../outside`,
  );
  assert.equal(unsafe.status, 403);
  const missing = await fetch(
    `${base}/api/v2/work-locations/${location.id}/status?path=missing.md`,
  );
  assert.deepEqual(await missing.json(), { available: false });
  assert.deepEqual(errors, []);
  console.log(
    `PASS: collapsed file evidence, keyboard disclosure, file shortcuts, deduplication, missing file state, bounded list, download, keyboard preview, pending-topic send guard, topic isolation, draft preservation, current-topic return, ${process.argv.includes("--desktop") ? "desktop only" : "mobile drawer/touch targets"}, path guard, no console errors`,
  );
} finally {
  releaseTopic();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
