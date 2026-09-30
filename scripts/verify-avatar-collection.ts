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
import { fixtureStyle } from "./browser-style.ts";

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
// Exercise onboarding after all Bots are removed; fresh installs use default bootstrap.
app.product!.db.put("bootstrap", { id: "default-bot" });
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
  // Use the real rendered SVGs for a reviewable contact sheet, not a second art implementation.
  const art = await page
    .locator(".collection-grid [data-avatar]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.getAttribute("data-avatar")!,
          node.outerHTML,
        ]),
      ),
    );
  const escapeHtml = (value: string) =>
    value.replace(
      /[&<>\"]/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
    );
  const galleryHtml = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>Bot avatars</title>
    <style>
      *{box-sizing:border-box}body{margin:0;padding:40px;background:#f7f6f2;color:#292934;font-family:system-ui,"Microsoft JhengHei",sans-serif}
      header{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}h1{font-size:34px;margin:0 0 6px;letter-spacing:-1px}
      header p{margin:0;font-size:14px;color:#65656f}.count{font-size:13px;color:#65656f}
      main{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:12px}
      article{display:flex;flex-direction:column;align-items:center;padding:14px 8px 12px;border:1px solid #e4e1db;border-radius:18px;background:#fff}
      .art{width:96px;height:96px;display:grid;place-items:center;border-radius:50%;background:color-mix(in srgb,var(--color) 14%,#fff)}
      .art svg{width:88px;height:88px}strong{font-size:14px;margin-top:8px}.english{font-size:11px;color:#65656f;margin-top:2px}
      .free{border-color:#c8bddb;background:#fcfaff}body[data-theme=dark]{background:#141419;color:#fafafa}
      body[data-theme=dark] article{background:#202027;border-color:#383840}body[data-theme=dark] .art{background:color-mix(in srgb,var(--color) 15%,#202027)}
      body[data-theme=dark] .free{border-color:#79689b}body[data-theme=dark] p,body[data-theme=dark] .english,body[data-theme=dark] .count{color:#b1b1ba}
    </style><header><div><h1>Bot 大頭貼</h1><p>熟悉的夥伴，更簡單的收藏。</p></div><span class="count">48 款頭像 · 前 6 款免費選用</span></header><main>
    ${botAvatars.map((a) => `<article class="${a.series === "basic" ? "free" : ""}"><div class="art" style="--color:${a.color}">${art[a.id]}</div><strong>${escapeHtml(a.label)}</strong><span class="english">${escapeHtml(a.series === "basic" ? "Free" : "Collectible")}</span></article>`).join("")}
    </main></html>`;
  assert.equal(
    new Set(
      Object.values(art).map((svg) => svg.replace(/data-avatar="[^"]+"/g, "")),
    ).size,
    botAvatars.length,
    "every collected companion has a distinct rendered appearance",
  );
  await writeFile(join(output, "avatar-gallery.html"), galleryHtml);
  const gallery = await context.newPage();
  await gallery.setViewportSize({ width: 1200, height: 1120 });
  await gallery.setContent(galleryHtml);
  await gallery.screenshot({
    path: join(output, "avatar-gallery-light.png"),
    fullPage: true,
  });
  await gallery.evaluate(() =>
    document.body.setAttribute("data-theme", "dark"),
  );
  await gallery.screenshot({
    path: join(output, "avatar-gallery-dark.png"),
    fullPage: true,
  });
  await gallery.close();
  await expect(
    page.getByRole("radio", {
      name: botAvatars.find((a) => a.id === "captain")!.label,
      exact: false,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "抽一次 · 30 點" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "已擁有", exact: true }).click();
  await expect(page.getByRole("radio")).toHaveCount(6);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByLabel("名稱", { exact: true }).fill("收藏夥伴");
  await page
    .getByRole("radio", {
      name: botAvatars.find((a) => a.id === "cloud")!.label,
      exact: true,
    })
    .check();
  await expect(
    page.locator('.avatar-preview [data-avatar="cloud"]'),
  ).toBeVisible();
  await expect(page.locator(".avatar-preview-copy strong")).toHaveText(
    "藍色雲朵",
  );
  await expect(page.locator(".collection-grid svg[data-avatar]")).toHaveCount(
    botAvatars.length,
  );
  await page.getByRole("button", { name: "建立 Bot", exact: true }).click();
  await expect(page.locator(".header-profile")).toBeVisible();
  const bot = app.product.queries.snapshot().bots[0];
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
    await expect.poll(() => app.product.execution.active.size).toBe(0);
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
    app.product.bots.bot(bot.id).avatar,
    "cloud",
    "drawing does not equip automatically",
  );
  await page.getByRole("button", { name: "選用此頭像" }).click();
  await expect(
    page.locator(`.avatar-preview [data-avatar="${avatar}"]`),
  ).toBeVisible();
  await page.getByRole("button", { name: "儲存變更", exact: true }).click();
  await expect.poll(() => app.product.bots.bot(bot.id).avatar).toBe(avatar);
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
    .locator(
      `.collection-series[aria-label="${botAvatarSeries.find((s) => s.id === "voyage")!.label}"]`,
    )
    .screenshot({ path: join(output, "voyage-avatars.png") });
  await page
    .locator(
      `.collection-series[aria-label="${botAvatarSeries.find((s) => s.id === "magic")!.label}"]`,
    )
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
    .locator(
      `.collection-series[aria-label="${botAvatarSeries.find((s) => s.id === "sanrio")!.label}"]`,
    )
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
  await expect(
    page.getByRole("radio", {
      name: new RegExp("Avatar 44"),
    }),
  ).toHaveCount(1);
  await expect(page.locator(".avatar-preview-copy strong")).toHaveText(
    avatar === "cloud"
      ? "Blue cloud"
      : avatar === "orbit"
        ? "Purple orbit"
        : `Avatar ${String(botAvatars.findIndex((a) => a.id === avatar) + 1).padStart(2, "0")}`,
  );
  await expect(page.locator(".collection-invitation")).toContainText(
    "+10 points",
  );
  await seriesFilter.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(seriesFilter).toHaveValue("all");
  const selectedRadio = page.locator(".collection-grid input:checked");
  await selectedRadio.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".collection-grid input:checked")).toBeEnabled();
  const responsiveChecks: string[] = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => document.documentElement.setAttribute("data-theme", theme),
      theme,
    );
    for (const width of [1440, 1280, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: 1080 });
      await expect(page.locator(".avatar-preview")).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${theme} at ${width}px has no page overflow`,
      );
      await page.locator(".avatar-preview").screenshot({
        path: join(output, `avatar-preview-${theme}-${width}.png`),
      });
      responsiveChecks.push(`${theme}: ${width}px, English template picker`);
    }
  }
  await page.setViewportSize({ width: 740, height: 375 });
  await expect(page.locator(".avatar-preview")).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "narrow landscape has no page overflow",
  );
  await page.setViewportSize({ width: 1280, height: 1080 });
  const zoomStyle = await fixtureStyle(page, {
    content: "html { font-size: 200% !important; }",
  });
  await expect(page.locator(".avatar-preview")).toBeVisible();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "200% text zoom has no page overflow",
  );
  await page
    .locator(".avatar-preview")
    .screenshot({ path: join(output, "avatar-preview-text-zoom.png") });
  await zoomStyle.evaluate((style) => style.remove());
  await zoomStyle.dispose();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".collection-picker")).toHaveCount(0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          `${botAvatars.length} original SVG avatars and selected companion preview`,
          "all series filters, empty owned state, mobile collection and keyboard series selection",
          "locked previews and filters",
          "flat +10 task points, 30-point draw and preserved IDs",
          "SSE across tabs",
          "lost response and refresh retry",
          "single debit",
          "equip and save",
          "template",
          "English template picker and keyboard selection",
          "light/dark/mobile",
          "reduced motion",
          "narrow landscape and 200% text zoom",
        ],
        responsiveChecks,
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
