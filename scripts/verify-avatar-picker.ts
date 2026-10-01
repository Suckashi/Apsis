// Isolated product/UI verification. No real provider key or user Bot is used.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { botAvatars, botAvatarSeries } from "../shared/bot-avatars.ts";
import { fixtureStyle } from "./browser-style.ts";

const output = resolve("artifacts/avatar-picker");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-avatar-picker-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => ({ text: "工作已完成。" }),
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  models: ["fixture", "fixture-alt"],
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
app.product.db.put("bootstrap", { id: "default-bot" });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({ executablePath: browserExecutable() });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const watch = (sample: import("playwright").Page) => {
    sample.on("pageerror", (error) => errors.push(error.message));
    sample.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  };
  watch(page);
  await page.goto(base);
  await page
    .getByRole("button", { name: "建立第一個 Bot", exact: true })
    .click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  const picker = page.locator(".avatar-picker");
  await expect(picker.getByRole("radio")).toHaveCount(48);
  assert.equal(await picker.locator("input:disabled").count(), 0);
  assert.equal(await picker.getByRole("progressbar").count(), 0);
  assert.doesNotMatch(
    await picker.innerText(),
    /點數|抽取|抽一次|已擁有|收藏頭像/,
  );
  for (const series of botAvatarSeries) {
    await picker
      .getByLabel("頭像系列", { exact: true })
      .selectOption(series.id);
    await expect(picker.getByRole("radio")).toHaveCount(
      botAvatars.filter((a) => a.series === series.id).length,
    );
    assert.equal(await picker.locator("input:disabled").count(), 0);
  }
  await picker.getByLabel("頭像系列", { exact: true }).selectOption("all");
  const artwork = await picker
    .locator(".avatar-grid [data-avatar]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.getAttribute("data-avatar")!,
          node.outerHTML,
        ]),
      ),
    );
  assert.deepEqual(
    Object.keys(artwork).sort(),
    botAvatars.map((a) => a.id).sort(),
  );
  assert.equal(
    new Set(
      Object.values(artwork).map((svg) =>
        svg.replace(/data-avatar="[^"]+"/g, ""),
      ),
    ).size,
    48,
  );
  await writeFile(
    join(output, "rendered-catalog.json"),
    JSON.stringify(artwork, null, 2),
  );
  const captain = picker.locator('input[value="captain"]');
  await captain.focus();
  await page.keyboard.press("Space");
  await expect(captain).toBeChecked();
  await expect(
    picker.locator('.avatar-preview [data-avatar="captain"]'),
  ).toBeVisible();
  await picker.getByLabel("頭像系列", { exact: true }).selectOption("basic");
  await expect(
    picker.locator('.avatar-preview [data-avatar="captain"]'),
  ).toBeVisible();
  await page.getByLabel("名稱", { exact: true }).fill("我的夥伴");
  await page.getByRole("button", { name: "建立 Bot", exact: true }).click();
  await expect(
    page.locator('.header-profile [data-avatar="captain"]'),
  ).toBeVisible();
  const bot = app.product.queries.snapshot().bots[0];
  assert.equal(bot.avatar, "captain");
  await page.reload();
  await expect(
    page.locator('.header-profile [data-avatar="captain"]'),
  ).toBeVisible();
  await page.locator(".header-profile").click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await page
    .locator(".avatar-picker label")
    .filter({ has: page.locator('input[value="cinnamoroll"]') })
    .click();
  await expect(
    page.locator('.avatar-preview [data-avatar="cinnamoroll"]'),
  ).toBeVisible();
  // A selection is only a form draft until Save; closing does not change identity.
  assert.equal(app.product.bots.bot(bot.id).avatar, "captain");
  await page
    .locator(".profile-footer")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".header-profile")).toBeFocused();
  await expect(
    page.locator('.header-profile [data-avatar="captain"]'),
  ).toBeVisible();
  await page.locator(".header-profile").click();
  await page.locator(".profile-avatar-disclosure > summary").click();
  await page
    .locator(".avatar-picker label")
    .filter({ has: page.locator('input[value="cinnamoroll"]') })
    .click();
  await page.getByRole("button", { name: "儲存變更", exact: true }).click();
  await expect
    .poll(() => app.product.bots.bot(bot.id).avatar)
    .toBe("cinnamoroll");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.locator('.header-profile [data-avatar="cinnamoroll"]'),
  ).toBeVisible();
  for (const prompt of ["第一次工作", "第二次工作"]) {
    await page
      .getByRole("textbox", { name: "傳送訊息", exact: true })
      .fill(prompt);
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    await expect.poll(() => app.product.execution.active.size).toBe(0);
    await expect
      .poll(
        () =>
          app.product.db.jobs.list().filter((j) => j.status === "completed")
            .length,
      )
      .toBe(prompt === "第一次工作" ? 1 : 2);
  }
  for (const kind of ["avatar-collection", "avatar-reward", "avatar-draw"])
    assert.equal(app.product.db.all(kind).length, 0);
  assert.equal(
    "avatarCollection" in
      (await (await page.request.get(`${base}/api/v2/state`)).json()),
    false,
  );
  assert.equal(
    (
      await page.request.post(`${base}/api/v2/avatar-collection/draw`, {
        data: { requestId: "removed-endpoint-test" },
        headers: { "X-Apsis-Client": "1" },
      })
    ).status(),
    404,
  );
  const failurePage = await browser.newPage({
    viewport: { width: 375, height: 812 },
  });
  const failureConsole: string[] = [],
    failureErrors: string[] = [];
  failurePage.on("console", (message) => {
    if (message.type() === "error") failureConsole.push(message.text());
  });
  failurePage.on("pageerror", (error) => failureErrors.push(error.message));
  await failurePage.goto(base);
  await failurePage.locator(".header-profile").click();
  await failurePage
    .getByLabel("名稱", { exact: true })
    .fill("保留未儲存的名稱");
  const conflict = "設定已變更，請重新讀取後再儲存。";
  let releaseConflict = () => {};
  const conflictGate = new Promise<void>((resolve) => {
    releaseConflict = resolve;
  });
  let saveRequests = 0;
  await failurePage.route(`**/api/v2/bots/${bot.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    saveRequests++;
    await conflictGate;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: conflict }),
    });
  });
  const failureFooter = failurePage.locator(".profile-footer");
  await failureFooter
    .getByRole("button", { name: "儲存變更", exact: true })
    .click();
  await expect(
    failureFooter.getByRole("button", { name: "儲存中…", exact: true }),
  ).toBeDisabled();
  await expect(
    failureFooter.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await expect(failurePage.getByLabel("名稱", { exact: true })).toBeDisabled();
  releaseConflict();
  await expect(failureFooter.getByRole("alert")).toHaveText(conflict);
  await expect(failureFooter.getByRole("alert")).toBeInViewport();
  await expect(failurePage.getByLabel("名稱", { exact: true })).toHaveValue(
    "保留未儲存的名稱",
  );
  assert.equal(app.product.bots.bot(bot.id).name, "我的夥伴");
  assert.equal(saveRequests, 1);
  await failurePage.screenshot({ path: join(output, "save-conflict-375.png") });
  await failureFooter
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.deepEqual(failureErrors, []);
  assert.ok(
    failureConsole.every((message) => /409/.test(message)),
    "only the deliberately injected HTTP conflict may log a console error",
  );
  await failurePage.close();
  const profiles = [];
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const width of [1440, 375, 812])
      for (const theme of ["light", "dark"] as const) {
        const height = width === 812 ? 375 : 900;
        const context = await browser.newContext({
          viewport: { width, height },
          colorScheme: theme,
        });
        const sample = await context.newPage();
        watch(sample);
        await sample.goto(base);
        await sample.locator(".header-profile").click();
        await sample.screenshot({
          path: join(output, `profile-${width}-${locale}-${theme}.png`),
        });
        await sample.locator(".profile-avatar-disclosure > summary").click();
        const options = sample.locator(".avatar-picker");
        await expect(options.getByRole("radio")).toHaveCount(48);
        assert.equal(await options.locator("input:disabled").count(), 0);
        const footer = sample.locator(".profile-footer");
        const body = sample.locator(".profile-body");
        const footerUsable = async () => {
          const rect = (await footer.boundingBox())!;
          assert.ok(
            rect.y >= 0 && rect.y + rect.height <= height,
            "Save and Cancel stay in the visible dialog",
          );
          for (const button of await footer.getByRole("button").all()) {
            const box = (await button.boundingBox())!;
            assert.ok(box.width >= 44 && box.height >= 44);
            assert.ok(
              await button.evaluate((node) => {
                const box = node.getBoundingClientRect();
                return node.contains(
                  document.elementFromPoint(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  ),
                );
              }),
              "footer actions are not obscured",
            );
          }
          assert.ok(
            await body.evaluate(
              (node) => node.scrollWidth <= node.clientWidth + 1,
            ),
            "form body has no clipped horizontal content",
          );
        };
        await footerUsable();
        const modelPicker = sample.locator(".profile-body .model-picker");
        await modelPicker.locator("summary").click();
        const modelSearch = modelPicker.getByRole("combobox");
        await expect(modelSearch).toBeFocused();
        await modelSearch.fill("fixture-alt");
        // Keyboard navigation brings the active option into view even when a
        // short landscape viewport cannot display search and the full list.
        await modelSearch.press("Home");
        const modelOption = modelPicker.getByRole("option", {
          name: "fixture-alt",
          exact: true,
        });
        await expect(modelOption).toBeInViewport();
        await sample.screenshot({
          path: join(output, `model-${width}-${locale}-${theme}.png`),
        });
        await modelOption.click();
        await expect(modelPicker.locator("summary")).toContainText(
          "fixture-alt",
        );
        assert.equal(
          app.product.bots.bot(bot.id).connectionId,
          undefined,
          "model choice remains a form draft",
        );
        await modelPicker.locator("summary").click();
        await modelSearch.press("Escape");
        await expect(modelPicker.locator("summary")).toBeFocused();
        await expect(sample.locator(".bot-profile-modal")).toBeVisible();
        await footerUsable();
        const initialFooter = await footer.boundingBox();
        await options
          .locator(".avatar-grid label")
          .last()
          .scrollIntoViewIfNeeded();
        await footerUsable();
        assert.equal(
          (await footer.boundingBox())!.y,
          initialFooter!.y,
          "reading all avatars does not move Save",
        );
        // Show the actual picker, not just the fields above a clipped gallery.
        await options
          .getByLabel(locale === "en" ? "Avatar series" : "頭像系列", {
            exact: true,
          })
          .selectOption("sanrio");
        await options.scrollIntoViewIfNeeded();
        await expect(
          options.locator('input[value="cinnamoroll"]'),
        ).toBeChecked();
        assert.equal(
          await options
            .locator("input")
            .first()
            .evaluate((node) => getComputedStyle(node).opacity),
          "0",
          "native radio remains keyboard accessible without a second visible circle",
        );
        const audit = await new AxeBuilder({ page: sample }).analyze();
        assert.deepEqual(audit.violations, []);
        // Retain incomplete findings. A clipped, scrolled textarea can share a
        // geometric rectangle with the fixed title without painting over it.
        // Check the actual title paint/hit order and opaque contrast separately;
        // any other incomplete finding still fails and requires investigation.
        const titleReview = await sample
          .locator(".bot-profile-modal > header h2")
          .evaluate((node) => {
            const header = node.parentElement!;
            const style = getComputedStyle(node);
            const background = getComputedStyle(header);
            const parse = (value: string) =>
              value.match(/[\d.]+/g)!.map(Number);
            const luminance = (value: number[]) =>
              value
                .slice(0, 3)
                .map((v) => v / 255)
                .map((v) =>
                  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
                )
                .reduce(
                  (sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i],
                  0,
                );
            const foreground = parse(style.color),
              backdrop = parse(background.backgroundColor);
            const a = luminance(foreground),
              b = luminance(backdrop);
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            const box = node.getBoundingClientRect();
            const hits = [];
            for (const x of [0.05, 0.25, 0.5, 0.75, 0.95])
              for (const y of [0.1, 0.5, 0.9])
                hits.push(
                  node.contains(
                    document.elementFromPoint(
                      box.left + box.width * x,
                      box.top + box.height * y,
                    ),
                  ),
                );
            return {
              foreground: style.color,
              background: background.backgroundColor,
              contrastRatio: ratio,
              opaque:
                (foreground[3] ?? 1) === 1 &&
                (backdrop[3] ?? 1) === 1 &&
                background.opacity === "1",
              allTitlePointsOnTop: hits.every(Boolean),
              pointsChecked: hits.length,
            };
          });
        assert.ok(
          titleReview.opaque &&
            titleReview.contrastRatio >= 4.5 &&
            titleReview.allTitlePointsOnTop,
        );
        for (const finding of audit.incomplete) {
          assert.equal(finding.id, "color-contrast");
          for (const node of finding.nodes)
            assert.deepEqual(node.target, ["header > h2"]);
        }
        await sample.screenshot({
          path: join(output, `picker-${width}-${locale}-${theme}.png`),
        });
        if (locale === "en") {
          await fixtureStyle(sample, {
            content: "html{font-size:200% !important}",
          });
          await options
            .locator(".avatar-grid label")
            .first()
            .scrollIntoViewIfNeeded();
          await footerUsable();
          await sample.screenshot({
            path: join(output, `picker-${width}-${locale}-${theme}-200pct.png`),
          });
        }
        assert.ok(
          await sample.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.ok(
          await options.locator(".avatar-grid label").evaluateAll((nodes) =>
            nodes.every((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width >= 44 && rect.height >= 44;
            }),
          ),
        );
        profiles.push({
          locale,
          width,
          height,
          theme,
          violations: audit.violations,
          incomplete: audit.incomplete,
          titleReview,
        });
        await context.close();
      }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        fixtureOnly: true,
        avatars: 48,
        distinctRenderedArt: 48,
        everySeriesSelectable: true,
        keyboardSelection: true,
        filterPreservesDraft: true,
        cancelPreservesIdentity: true,
        createSaveReload: true,
        completedJobsProduceNoRewards: true,
        removedDrawEndpoint: true,
        fixedProfileFooter: true,
        profileModelMenuVisibleAndDraftOnly: true,
        allAvatarsReachableWithoutMovingSave: true,
        failedSaveRetainsDraftAndVisibleExplanation: true,
        failedSaveRequestCount: saveRequests,
        expectedConflictConsole: failureConsole,
        profiles,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: 48 selectable avatars, keyboard/filter/draft/save/reload, fixed footer and visible save conflict, 12 profile audits including landscape with retained title contrast reviews, no unexpected browser errors",
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
