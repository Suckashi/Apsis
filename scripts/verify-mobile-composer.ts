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
import { git } from "../server/git-workspaces.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-mobile-composer-"));
const out = resolve("artifacts/mobile-composer"),
  repo = join(dir, "repo");
await mkdir(out, { recursive: true });
await mkdir(repo);
await git(repo, "init");
await git(repo, "config", "user.name", "Fixture");
await git(repo, "config", "user.email", "test@example.invalid");
await writeFile(join(repo, "README.md"), "# Example\n");
await git(repo, "add", ".");
await git(repo, "commit", "-m", "Initial");
let runs = 0;
let release!: () => void;
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    runs++;
    if (options.prompt.includes("長任務")) await gate;
    return { text: "已收到。" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://localhost:1/v1",
  modelSettings: { fixture: { contextWindowTokens: 128000 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const project = await app.tasks.projects.add({
  name: "很長的專案名稱 Mobile composer regression",
  path: repo,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
  );
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await input.waitFor();
  const layout = async () => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const card = (await page.locator(".composer-card").boundingBox())!;
    assert.ok(card.height <= 150, `idle composer height ${card.height}`);
    const header = (await page.locator(".chat-header").boundingBox())!;
    assert.ok(header.height <= 64, `header ${header.height}`);
    const buttons = await page
      .locator(".composer-actions")
      .locator("button:visible,summary:visible")
      .all();
    const boxes = await Promise.all(buttons.map((b) => b.boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!;
      assert.ok(a.width >= 44 && a.height >= 44, "44px targets");
      assert.ok(
        a.x >= 0 && a.x + a.width <= page.viewportSize()!.width,
        "control stays onscreen",
      );
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j]!;
        assert.ok(
          a.x + a.width <= b.x + 1 ||
            b.x + b.width <= a.x + 1 ||
            a.y + a.height <= b.y + 1 ||
            b.y + b.height <= a.y + 1,
          "toolbar controls do not overlap",
        );
      }
    }
  };
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await layout();
    await page.screenshot({ path: join(out, `idle-${width}.png`) });
  }
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await layout();
    const roster = (await page.locator(".sidebar").boundingBox())!;
    assert.equal(roster.width, 256, "desktop roster stays 256px");
    const composer = (await page.locator(".composer-wrap").boundingBox())!;
    assert.ok(composer.width <= 800, "conversation composer stays readable");
    await page.screenshot({ path: join(out, `desktop-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  const inspectorResize = page.getByRole("separator", {
    name: "調整檢視區寬度",
  });
  const handle = (await inspectorResize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 300, handle.y + 100);
  await page.mouse.up();
  assert.equal(await inspectorResize.getAttribute("aria-valuenow"), "640");
  for (const width of [1150, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const discussion = (await page.locator("main.conversation").boundingBox())!;
    const inspector = (await page.locator("#bot-details").boundingBox())!;
    assert.ok(
      discussion.width >= 480,
      "inspector drag preserves 480px discussion",
    );
    assert.ok(
      inspector.width <= width - 256 - 480,
      "inspector fits beside roster and discussion",
    );
    for (const control of await page
      .locator(".composer-actions summary:visible")
      .all()) {
      assert.ok(
        (await control.boundingBox())!.height <= 44,
        "narrow discussion keeps composer labels on one row",
      );
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "resized inspector does not overflow",
    );
    if (width === 1280)
      await page.screenshot({
        path: join(out, "desktop-inspector-max-1280.png"),
      });
  }
  await inspectorResize.press("Home");
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill("保留我的草稿");
  await input.press("End");
  await input.press("Enter");
  assert.equal(await input.inputValue(), "保留我的草稿\n");
  assert.equal(runs, 0, "phone Enter adds newline instead of sending");
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "工作選項", exact: true });
  await sheet.getByLabel("工作位置").selectOption(project.id);
  await expect(sheet.getByLabel("起始分支").locator("option")).toHaveCount(1);
  const branch = await sheet.getByLabel("起始分支").inputValue();
  await sheet.getByLabel("模式").selectOption("plan");
  await page.screenshot({ path: join(out, "options.png") });
  await sheet.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(await input.inputValue(), "保留我的草稿\n");
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  await expect(sheet.getByLabel("工作位置")).toHaveValue(project.id);
  await expect(sheet.getByLabel("起始分支")).toHaveValue(branch);
  await expect(sheet.getByLabel("模式")).toHaveValue("plan");
  await sheet.getByLabel("模式").selectOption("work");
  await sheet.getByRole("button", { name: "完成", exact: true }).click();
  await input.fill("");
  await layout();
  const approval = page.locator(".approval-mode-control summary").first();
  await approval.click();
  const popover = page.locator(
    ".approval-mode-control .composer-popover-content",
  );
  await popover.waitFor();
  const pop = (await popover.boundingBox())!;
  assert.ok(pop.x >= 0 && pop.x + pop.width <= 390);
  await approval.press("Escape");
  await page.setViewportSize({ width: 390, height: 420 });
  await input.fill("鍵盤縮小可視範圍");
  await input.focus();
  await layout();
  const card = (await page.locator(".composer-card").boundingBox())!;
  assert.ok(
    card.y + card.height <= 420,
    "composer remains in resized visual viewport",
  );
  assert.ok(
    (await page.locator(".messages").boundingBox())!.height >= 120,
    "conversation retains usable space",
  );
  await page.screenshot({ path: join(out, "short-viewport.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.screenshot({ path: join(out, "dark.png") });
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  await sheet.getByLabel("工作位置").selectOption("");
  await sheet.getByRole("button", { name: "完成", exact: true }).click();
  await input.fill("長任務");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.getByRole("button", { name: "停止任務", exact: true }).waitFor();
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  await sheet.getByLabel("傳送方式").selectOption("steer");
  await sheet.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "補充指示", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 420 });
  await input.fill("補充草稿");
  await page.screenshot({ path: join(out, "running-short-viewport.png") });
  assert.ok(
    (await page.locator(".messages").boundingBox())!.height >= 80,
    `running state leaves conversation space: ${JSON.stringify(
      await page.evaluate(() => ({
        errors: document.querySelector('[role="alert"]')?.textContent,
        scrollY,
        viewport: [innerWidth, innerHeight, visualViewport?.height],
        app: document.querySelector(".app")?.getBoundingClientRect().toJSON(),
        messages: document
          .querySelector(".messages")
          ?.getBoundingClientRect()
          .toJSON(),
        composer: document
          .querySelector(".composer-wrap")
          ?.getBoundingClientRect()
          .toJSON(),
        status: document.querySelector(".composer-status")?.textContent,
        children: [
          ...document.querySelectorAll(
            ".composer-card,.composer-status,.task-progress-main,.task-progress-actions,.composer textarea,.composer-actions,.composer-note,.jump-latest",
          ),
        ].map((el) => ({
          class: el.className,
          height: el.getBoundingClientRect().height,
          top: el.getBoundingClientRect().top,
        })),
      })),
    )}`,
  );
  const runningCard = (await page.locator(".composer-card").boundingBox())!;
  assert.ok(runningCard.y + runningCard.height <= 420);
  release();
  await page
    .getByRole("button", { name: "停止任務", exact: true })
    .waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "320/375/390/430px",
          "768/1024/1280/1440px desktop geometry",
          "maximum inspector drag preserves 480px discussion at 1150/1280/1440px",
          "compact composer and single-row header",
          "44px non-overlapping controls",
          "options retain project branch mode and draft",
          "approval popover stays onscreen",
          "phone Enter does not submit",
          "short viewport retains input and conversation",
          "light/dark",
          "no page errors",
        ],
        limitation:
          "Short viewport simulates available space; native iOS/Android keyboards are not automated.",
      },
      null,
      2,
    ),
  );
  console.log("Mobile composer browser verification passed.");
} finally {
  release();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
