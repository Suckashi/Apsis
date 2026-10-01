import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Browser, BrowserContext, Page, Locator } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { fixtureStyle } from "./browser-style.ts";
import {
  verificationBrowser,
  verificationLaunch,
  verificationDirectory,
} from "./verification-browser.ts";

const output = resolve(verificationDirectory("artifacts/template-reading"));
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-template-reading-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  models: ["fixture", "alternative"],
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
await app.product.bootstrap();
const description =
  "整理來源、撰寫簡報、確認內容。保留原文與引用，在交付前說明實際檢查。\n".repeat(
    35,
  );
const template = app.product.bots.template({
  name: "閱讀夥伴 Reading companion",
  description,
  avatar: "bean",
  connectionId: connection.id,
  model: "fixture",
  permissionMode: "readonly",
  permissionRules: [
    {
      id: "fixture-rule",
      scope: "global",
      tool: "write_file",
      effect: "deny",
      path: "reports",
    },
  ],
});
app.product.bots.template({ name: "另一份範本", avatar: "cloud" });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
let browser: Browser | undefined;
const profiles: object[] = [];
async function hit(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const rect = (await target.boundingBox())!;
  assert.ok(rect.width >= 44 && rect.height >= 44);
  const viewport = page.viewportSize()!;
  assert.ok(
    rect.x >= -1 &&
      rect.y >= -1 &&
      rect.x + rect.width <= viewport.width + 1 &&
      rect.y + rect.height <= viewport.height + 1,
  );
  assert.equal(
    await target.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    true,
  );
  return rect;
}
async function audit(page: Page) {
  const raw = await new AxeBuilder({ page })
    .include(".template-settings")
    .analyze();
  assert.deepEqual(raw.violations, []);
  const paintedReview = [];
  for (const finding of raw.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const uncertain of finding.nodes) {
      assert.equal(uncertain.target.length, 1);
      assert.equal(typeof uncertain.target[0], "string");
      const target = page.locator(uncertain.target[0] as string);
      await target.scrollIntoViewIfNeeded();
      const review = await target.evaluate((node) => {
        const parse = (color: string) => color.match(/[\d.]+/g)!.map(Number);
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = getComputedStyle(node).color;
        let ancestor: Element | null = node;
        while (
          ancestor &&
          parse(getComputedStyle(ancestor).backgroundColor)[3] === 0
        )
          ancestor = ancestor.parentElement;
        const background = getComputedStyle(ancestor!).backgroundColor;
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const text = Array.from(node.childNodes).find(
          (child) =>
            child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        );
        if (!text) throw new Error("No direct painted text to review");
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, Math.min(text.textContent!.length, 10));
        const box = node.getBoundingClientRect(),
          port = node
            .closest(".template-editor-body,.template-settings-body")!
            .getBoundingClientRect();
        const rect = Array.from(range.getClientRects()).find(
          (r) =>
            r.bottom > Math.max(port.top, box.top, 0) &&
            r.top < Math.min(port.bottom, box.bottom, innerHeight),
        );
        const points = [];
        if (rect) {
          const top = Math.max(rect.top, port.top, box.top, 0),
            bottom = Math.min(
              rect.bottom,
              port.bottom,
              box.bottom,
              innerHeight,
            ),
            left = Math.max(rect.left, port.left, box.left, 0),
            right = Math.min(rect.right, port.right, box.right, innerWidth);
          if (bottom > top + 2 && right > left + 2)
            for (const y of [0.25, 0.5, 0.75])
              points.push(
                node.contains(
                  document.elementFromPoint(
                    (left + right) / 2,
                    top + (bottom - top) * y,
                  ),
                ),
              );
        }
        return {
          foreground,
          background,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          points: points.length,
          onTop: points.every(Boolean),
        };
      });
      assert.ok(
        review.opaque &&
          review.contrast >= 4.5 &&
          review.points === 3 &&
          review.onTop,
      );
      paintedReview.push({ target: uncertain.target, ...review });
    }
  }
  return { ...raw, paintedReview };
}
try {
  browser = await verificationLaunch();
  const configs = [
    ...[1440, 375].flatMap((width) =>
      ["zh-Hant", "en"].flatMap((locale) =>
        ["light", "dark"].map((theme) => ({
          width,
          height: 900,
          locale,
          theme,
          scale: 1,
        })),
      ),
    ),
    { width: 375, height: 812, locale: "en", theme: "dark", scale: 2 },
    { width: 812, height: 375, locale: "en", theme: "dark", scale: 2 },
  ];
  for (const config of configs) {
    app.product.settings.update(
      { locale: config.locale as "zh-Hant" | "en" },
      app.product.settings.read().revision,
    );
    const context: BrowserContext = await browser.newContext({
      viewport: { width: config.width, height: config.height },
      reducedMotion: "reduce",
    });
    await context.addInitScript(({ theme, locale }) => {
      localStorage.setItem("apsis.theme", theme);
      localStorage.setItem("apsis.locale", locale);
    }, config);
    const page: Page = await context.newPage(),
      errors: string[] = [];
    let injectingFailure = false;
    const expectedErrors: { text: string; url: string }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (
        injectingFailure &&
        message.location().url === `${base}/api/v2/templates/${template.id}` &&
        message.text() ===
          "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      ) {
        expectedErrors.push({
          text: message.text(),
          url: message.location().url,
        });
      } else errors.push(message.text());
    });
    await page.goto(base);
    const composer = page.getByRole("textbox", {
      name: /^(傳送訊息|Send message)$/,
    });
    await expect(composer).toBeVisible();
    await composer.fill("保留對話草稿");
    if (config.width < 640)
      await page
        .getByRole("button", { name: /開啟 Bot 名單|Open Bot list/ })
        .click();
    await page
      .getByRole("button", { name: /^(設定與工具|Settings & tools)$/ })
      .click();
    await page
      .locator(".settings-tabs")
      .getByRole("button", { name: /^(Bot 範本|Bot templates)$/ })
      .click();
    if (config.scale === 2)
      await fixtureStyle(page, {
        content: "html { font-size:200% !important; }",
      });
    const card: () => Locator = () =>
      page.locator(".template-card").filter({
        has: page.getByRole("heading", { name: template.name, exact: true }),
      });
    await expect(page.locator(".template-card")).toHaveCount(2);
    await expect(card().locator("[data-avatar=bean]")).toHaveCount(1);
    assert.equal(
      await card().locator(".template-description").textContent(),
      description,
    );
    const listAudit = await audit(page);
    await card()
      .getByRole("button", { name: /^(編輯|Edit)$/ })
      .click();
    const editor = page.locator(".template-editor"),
      name = editor.getByLabel(/^(名稱|Name)$/),
      instructions = editor.getByLabel(/角色與工作方式|Role & instructions/);
    await expect(name).toBeFocused();
    await expect(instructions).toHaveValue(description);
    await expect(page.locator(".template-card")).toHaveCount(0);
    await expect(editor.locator(".avatar-picker")).toHaveCount(0);
    await expect(editor.locator(".template-advanced")).not.toHaveAttribute(
      "open",
    );
    const save = editor.getByRole("button", {
        name: /^(儲存變更|Save changes)$/,
      }),
      cancel = editor.getByRole("button", { name: /^(取消|Cancel)$/ });
    const saveBox = await hit(page, save),
      cancelBox = await hit(page, cancel);
    const compactAudit = await audit(page),
      profile = `${config.width}-${config.height}-${config.locale}-${config.theme}-${config.scale}x`;
    await page.screenshot({ path: join(output, `editor-${profile}.png`) });
    if (config.height <= 480) {
      const tabs = await page.locator(".settings-tabs button").all();
      assert.equal(tabs.length, 3);
      for (const tab of tabs) await hit(page, tab);
    }
    await editor.locator(".template-avatar-disclosure > summary").click();
    await expect(editor.getByRole("radio")).toHaveCount(48);
    await editor.locator("input[type=radio][value=cloud]").check();
    await editor.locator(".template-avatar-disclosure > summary").click();
    await expect(editor.getByRole("radio")).toHaveCount(0);
    await expect(
      editor.locator(".template-avatar-disclosure [data-avatar=cloud]"),
    ).toHaveCount(1);
    await editor.locator(".template-advanced > summary").click();
    await expect(editor.getByLabel(/工作區權限|Workspace access/)).toHaveValue(
      "readonly",
    );
    await expect(editor.getByLabel(/^(工具|Tool)$/)).toHaveValue("write_file");
    await hit(page, save);
    await hit(page, cancel);
    const advancedAudit = await audit(page);
    await page.route(`**/api/v2/templates/${template.id}`, async (route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 503,
          json: { error: "fixture save unavailable. ".repeat(25) },
        });
      else await route.continue();
    });
    injectingFailure = true;
    await save.click();
    await expect(editor.getByRole("alert")).toContainText(
      "fixture save unavailable",
    );
    await expect.poll(() => expectedErrors.length).toBe(1);
    injectingFailure = false;
    const failure = editor.getByRole("alert");
    await failure.focus();
    await failure.press("End");
    await expect
      .poll(() => failure.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await failure.press("Home");
    await expect.poll(() => failure.evaluate((node) => node.scrollTop)).toBe(0);
    const fullFirstLine = await failure.evaluate((node) => {
      const range = document.createRange();
      range.setStart(node.firstChild!, 0);
      range.setEnd(node.firstChild!, 10);
      const rect = range.getBoundingClientRect(),
        box = node.getBoundingClientRect();
      return rect.top >= box.top && rect.bottom <= box.bottom;
    });
    assert.equal(
      fullFirstLine,
      true,
      "error text has a complete readable line",
    );
    // Long failures scroll independently; neither primary action may be covered.
    for (const control of [save, cancel]) {
      const inside = await control.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          footer = node
            .closest(".template-editor-footer")!
            .getBoundingClientRect();
        return (
          r.top >= footer.top &&
          r.bottom <= footer.bottom &&
          node.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          )
        );
      });
      assert.equal(
        inside,
        true,
        "footer action stays visible after a long error",
      );
    }
    await page.unroute(`**/api/v2/templates/${template.id}`);
    await cancel.click();
    await expect(
      card().getByRole("button", { name: /^(編輯|Edit)$/ }),
    ).toBeFocused();
    assert.equal(
      app.product.db.get<typeof template>("template", template.id)!.avatar,
      "bean",
    );
    await card()
      .getByRole("button", { name: /^(編輯|Edit)$/ })
      .click();
    await expect(name).toBeFocused();
    await name.fill("未儲存範本");
    page.once("dialog", (dialog) => dialog.dismiss());
    await editor.locator(".template-back").click();
    await expect(name).toHaveValue("未儲存範本");
    page.once("dialog", (dialog) => dialog.accept());
    await editor.locator(".template-back").click();
    await expect(
      card().getByRole("button", { name: /^(編輯|Edit)$/ }),
    ).toBeFocused();
    assert.equal(
      app.product.db.get<typeof template>("template", template.id)!.name,
      template.name,
    );
    await page.getByRole("button", { name: /關閉設定|Close settings/ }).click();
    await expect(composer).toHaveValue("保留對話草稿");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    profiles.push({
      profile,
      saveBox,
      cancelBox,
      listAudit,
      compactAudit,
      advancedAudit,
      errors,
      expectedErrors,
    });
    await context.close();
  }
  // Real save, failed save, required collapsed-field validation, and derived Bot fidelity.
  app.product.settings.update(
    { locale: "en" },
    app.product.settings.read().revision,
  );
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  await page.goto(base);
  await page
    .getByRole("button", { name: "Settings & tools", exact: true })
    .click();
  await page
    .locator(".settings-tabs")
    .getByRole("button", { name: "Bot templates", exact: true })
    .click();
  const card = () =>
    page.locator(".template-card").filter({
      has: page.getByRole("heading", { name: template.name, exact: true }),
    });
  await card().getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".template-editor"),
    name = editor.getByLabel("Name", { exact: true }),
    save = editor.getByRole("button", { name: "Save changes", exact: true });
  await editor
    .getByLabel("Model", { exact: true })
    .selectOption(JSON.stringify([connection.id, "alternative"]));
  await editor.locator(".template-avatar-disclosure > summary").click();
  await editor.locator("input[type=radio][value=cloud]").check();
  await editor.locator(".template-avatar-disclosure > summary").click();
  await editor.locator(".template-advanced > summary").click();
  const tool = editor.getByLabel("Tool", { exact: true });
  await tool.fill("");
  await editor.locator(".template-advanced > summary").click();
  await save.click();
  await expect(editor.locator(".template-advanced")).toHaveAttribute(
    "open",
    "",
  );
  await expect(tool).toBeFocused();
  await tool.fill("write_file");
  await name.fill("儲存後範本");
  await page.route(`**/api/v2/templates/${template.id}`, async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 503,
        json: { error: "fixture save unavailable" },
      });
    else await route.continue();
  });
  await save.click();
  await expect(editor.getByRole("alert")).toContainText(
    "fixture save unavailable",
  );
  await expect(name).toHaveValue("儲存後範本");
  await hit(page, editor.getByRole("alert"));
  await page.unroute(`**/api/v2/templates/${template.id}`);
  await save.click();
  const savedCard = page.locator(".template-card").filter({
    has: page.getByRole("heading", { name: "儲存後範本", exact: true }),
  });
  await expect(
    savedCard.getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  const saved = app.product.db.get<typeof template>("template", template.id)!;
  assert.equal(saved.description, description);
  assert.deepEqual(saved.permissionRules, template.permissionRules);
  assert.equal(saved.permissionMode, "readonly");
  assert.equal(saved.model, "alternative");
  assert.equal(saved.connectionId, connection.id);
  assert.equal(saved.avatar, "cloud");
  await savedCard
    .getByRole("button", { name: "Create Bot", exact: true })
    .click();
  await expect(
    page.getByText("Bot created from template", { exact: true }),
  ).toBeVisible();
  const created = app.product.db
    .all<import("../shared/product.ts").Bot>("bot")
    .find((bot) => bot.name === saved.name)!;
  assert.equal(created.description, description);
  assert.deepEqual(
    created.permissionRules,
    saved.permissionRules.map((rule) => ({
      ...rule,
      scope: "bot",
      botId: created.id,
    })),
  );
  assert.equal(created.permissionMode, "readonly");
  assert.equal(created.model, saved.model);
  assert.equal(created.connectionId, saved.connectionId);
  assert.equal(created.avatar, saved.avatar);
  await savedCard.getByRole("button", { name: "Remove", exact: true }).click();
  await savedCard.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok(app.product.db.get("template", template.id));
  await expect(savedCard.locator("[data-remove-template]")).toBeFocused();
  await savedCard.locator("[data-remove-template]").click();
  await savedCard.locator(".danger-button").click();
  await expect(savedCard).toHaveCount(0);
  await expect(page.locator(".template-settings h3")).toBeFocused();
  assert.equal(app.product.db.get("template", template.id), undefined);
  assert.ok(app.product.db.get("bot", created.id));
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        browser: verificationBrowser,
        version: browser.version(),
        profiles,
        saveRetry: true,
        invalidDisclosureOpens: true,
        createdBotPreservesTemplate: true,
        deleteCancelled: true,
        deletePreservesExistingBot: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      browser: verificationBrowser,
      profiles: profiles.length,
      output,
    }),
  );
  await context.close();
} catch (error) {
  await browser
    ?.contexts()
    .flatMap((c) => c.pages())
    .at(-1)
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
