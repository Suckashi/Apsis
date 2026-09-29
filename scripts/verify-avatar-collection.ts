import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { Job } from "../shared/product.ts";
import { botAvatars, botAvatarSeries } from "../shared/bot-avatars.ts";

const output = "artifacts/avatar-collection";
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-avatar-browser-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "workspace"),
  runner: async () => ({ text: "工作已完成。" }),
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture-model",
  modelSettings: { "fixture-model": { contextWindowTokens: 128000 } },
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
// Exercise the legacy empty-roster onboarding path; fresh installs are covered by verify-coding-workspace.
app.product!.db.put("migration", { id: "bot-first-v1" });
try {
  await page.goto(url);
  await page.getByRole("button", { name: "建立第一個 Bot" }).click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await expect(page.getByRole("radio")).toHaveCount(botAvatars.length);
  for (const series of botAvatarSeries) {
    await page.getByLabel("頭像系列", { exact: true }).selectOption(series.id);
    await expect(page.getByRole("radio")).toHaveCount(
      botAvatars.filter((avatar) => avatar.series === series.id).length,
    );
    if (series.id !== "basic") {
      await expect(page.getByRole("radio").first()).toBeDisabled();
    }
  }
  await page.getByRole("button", { name: "已擁有", exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.locator(".collection-empty")).toBeVisible();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByLabel("頭像系列", { exact: true }).selectOption("all");
  await expect(page.getByRole("radio", { name: /頭像 07/ })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "抽一次 · 30 點" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "已擁有", exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(6);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByLabel("名稱", { exact: true }).fill("收藏夥伴");
  await page.getByRole("radio", { name: "藍色雲朵", exact: true }).check();
  await page.getByRole("button", { name: "建立 Bot", exact: true }).click();
  await expect(page.locator(".header-profile")).toBeVisible();
  const bot = app.product.snapshot().bots[0];
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("textbox", { name: "傳送訊息" })
      .fill(`完成任務 ${i + 1}`);
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    await expect
      .poll(
        () =>
          app.product.db.all<Job>("job").filter((j) => j.status === "completed")
            .length,
      )
      .toBe(i + 1);
    await expect.poll(() => app.product.active.size).toBe(0);
  }
  assert.equal(app.product.avatarCollection.view().balance, 30);
  await page.locator(".header-profile").click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await expect(
    page.getByRole("button", { name: "抽一次 · 30 點" }),
  ).toBeEnabled();
  await page
    .locator(".collection-picker")
    .screenshot({ path: join(output, "collection-light.png") });
  const other = await context.newPage();
  await other.goto(url);
  await other.locator(".header-profile").click();
  await other.locator(".profile-avatar-disclosure > summary").click();
  await expect(other.locator(".collection-points strong")).toHaveText("30");

  // Commit the draw but drop its response: a refresh must reuse the same request ID.
  await page.route("**/api/v2/avatar-collection/draw", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "抽一次 · 30 點" }).click();
  await expect(
    page.getByRole("button", { name: "確認上次抽取結果" }),
  ).toBeEnabled();
  await expect.poll(() => app.product.db.all("avatar-draw").length).toBe(1);
  await expect(other.locator(".collection-points strong")).toHaveText("0");
  await expect(other.locator(".collection-result")).toBeVisible();
  await page.unroute("**/api/v2/avatar-collection/draw");
  await page.reload();
  await page.locator(".header-profile").click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await page.getByRole("button", { name: "確認上次抽取結果" }).click();
  await expect(page.getByRole("button", { name: "選用此頭像" })).toBeEnabled();
  assert.equal(app.product.db.all("avatar-draw").length, 1);
  assert.equal(app.product.avatarCollection.view().balance, 0);
  const avatar = app.product.avatarCollection.view().lastDraw!.avatarId;
  assert.equal(
    app.product.bot(bot.id).avatar,
    "cloud",
    "drawing does not equip automatically",
  );
  await page.getByRole("button", { name: "選用此頭像" }).click();
  await page.getByRole("button", { name: "儲存變更", exact: true }).click();
  await expect.poll(() => app.product.bot(bot.id).avatar).toBe(avatar);
  await expect(
    page.locator(`.header-profile [data-avatar="${avatar}"]`),
  ).toBeVisible();
  await page.getByRole("button", { name: "儲存為範本", exact: true }).click();
  await expect.poll(() => app.product.db.all("template").length).toBe(1);
  await page
    .locator(".collection-picker")
    .screenshot({ path: join(output, "collected-light.png") });

  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page
    .locator(".collection-picker")
    .screenshot({ path: join(output, "collection-dark.png") });
  await page
    .locator('[aria-label="系列 2"]')
    .screenshot({ path: join(output, "voyage-avatars.png") });
  await page
    .locator('[aria-label="系列 3"]')
    .screenshot({ path: join(output, "magic-avatars.png") });
  for (const series of botAvatarSeries.slice(3)) {
    await page.getByLabel("頭像系列", { exact: true }).selectOption(series.id);
    await page
      .locator(`.collection-series[aria-label="${series.label}"]`)
      .screenshot({ path: join(output, `${series.id}-avatars-dark.png`) });
  }
  await page.setViewportSize({ width: 375, height: 844 });
  // Load in mobile mode before opening the profile. A desktop-to-mobile media
  // query update is asynchronous; toggling based on visibility can close it again.
  await page.reload();
  await page.locator(".header-profile").click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await expect(page.getByRole("dialog", { name: "Bot 詳情" })).toBeVisible();
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.locator(".collection-wallet").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "collection-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await expect(
    page.getByRole("radio", {
      name: new RegExp(botAvatars.find((a) => a.id === avatar)!.label),
    }),
  ).toBeChecked();
  await page.getByLabel("頭像系列", { exact: true }).selectOption("sanrio");
  await expect(page.getByRole("radio")).toHaveCount(6);
  await page
    .locator('.collection-series[aria-label="系列 9"]')
    .screenshot({ path: join(output, "sanrio-mobile.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".collection-result-art")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  // Verify the shared picker also works in English template editing.
  await page.setViewportSize({ width: 1440, height: 1080 });
  const settings = app.product.settings.read();
  app.product.settings.update({ revision: settings.revision, locale: "en" });
  await page.goto(url);
  await page.locator(".settings-link").click();
  await page
    .locator(".settings-tabs")
    .getByRole("button", { name: "Bot templates", exact: true })
    .click();
  await page
    .locator(".template-card")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByRole("radio")).toHaveCount(botAvatars.length);
  await expect(
    page.getByRole("button", { name: "Draw once · 30 points", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".collection-wallet-heading")).toContainText(
    `Collected 7 / ${botAvatars.length}`,
  );
  await expect(
    page.getByRole("button", { name: "All", exact: true }),
  ).toBeVisible();
  await page
    .locator(".collection-picker")
    .screenshot({ path: join(output, "collection-template-english.png") });
  const seriesFilter = page.getByRole("combobox", {
    name: "Avatar series",
    exact: true,
  });
  await seriesFilter.selectOption("sanrio");
  await expect(page.getByRole("radio", { name: /Avatar 44/ })).toHaveCount(1);
  await seriesFilter.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(seriesFilter).toHaveValue("all");
  const selectedRadio = page.locator(".collection-grid input:checked");
  await selectedRadio.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".collection-grid input:checked")).toBeEnabled();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".collection-picker")).toHaveCount(0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          `${botAvatars.length} SVG avatars`,
          "all series filters, empty owned state, mobile Sanrio and keyboard series selection",
          "locked previews and filters",
          "task points",
          "SSE across tabs",
          "lost response and refresh retry",
          "single debit",
          "equip and save",
          "template",
          "English template picker and keyboard selection",
          "light/dark/mobile",
          "reduced motion",
        ],
        drawnAvatar: avatar,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `Avatar collection browser verification passed. Screenshots: ${output}`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
