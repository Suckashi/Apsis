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

const output = resolve(verificationDirectory("artifacts/provider-reading"));
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-provider-reading-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
});
const ids = Array.from(
  { length: 12 },
  (_, i) => `fixture-${String(i).padStart(2, "0")}`,
);
const connection = await app.connections.save({
  name: "Reading models",
  provider: "openai-compatible",
  model: ids[0],
  models: ids,
  url: "http://127.0.0.1:1/v1",
  apiKey: "fixture-original-key",
  modelSettings: {
    [ids[0]]: {
      displayName: "Reading model",
      contextWindowTokens: 128000,
      maxOutputTokens: 8192,
    },
  },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: ids[0],
});
await app.product.bootstrap();
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
let browser: Browser | undefined;
const profiles: object[] = [];
let auditNumber = 0;
async function hit(page: Page, target: Locator) {
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
    .include(".provider-settings")
    .analyze();
  await writeFile(
    join(output, `audit-${++auditNumber}.json`),
    JSON.stringify(raw, null, 2),
  );
  assert.deepEqual(raw.violations, []);
  const paintedReview = [];
  for (const finding of raw.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const uncertain of finding.nodes) {
      assert.equal(uncertain.target.length, 1);
      assert.equal(typeof uncertain.target[0], "string");
      const target = page.locator(uncertain.target[0] as string);
      // A tall label includes its helper and input; center-scrolling can hide its name.
      await target.evaluate((node) =>
        node.scrollIntoView({ block: "start", inline: "nearest" }),
      );
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
            .closest(".provider-settings-body,.provider-editor-footer")!
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
        JSON.stringify({ target: uncertain.target, review }),
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
    const page: Page = await context.newPage();
    const errors: string[] = [],
      expectedErrors: { text: string; url: string }[] = [],
      externalRequests: string[] = [];
    let injectedPath = "";
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      if (
        injectedPath &&
        m.location().url === base + injectedPath &&
        m.text() ===
          "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      )
        expectedErrors.push({ text: m.text(), url: m.location().url });
      else errors.push(m.text());
    });
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin === base) await route.continue();
      else if (u.hostname === "local.adguard.org")
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "",
        });
      else {
        externalRequests.push(u.href);
        await route.abort();
      }
    });
    await page.goto(base);
    const composer = page.getByRole("textbox", {
      name: /^(傳送訊息|Send message)$/,
    });
    await expect(composer).toBeVisible();
    await composer.fill("保留模型設定對話草稿");
    if (config.width < 640)
      await page
        .getByRole("button", { name: /開啟 Bot 名單|Open Bot list/ })
        .click();
    await page
      .getByRole("button", { name: /^(設定與工具|Settings & tools)$/ })
      .click();
    if (config.scale === 2)
      await fixtureStyle(page, {
        content: "html {font-size:200% !important;}",
      });
    const providers = page.locator(".provider-settings");
    await expect(providers.locator(".provider-card")).toHaveCount(1);
    const listAudit = await audit(page);
    await providers.getByRole("button", { name: /^(編輯|Edit)$/ }).click();
    const name = providers.getByLabel(/^(名稱|Name)$/),
      key = providers.getByLabel(/^API key/),
      save = providers.getByRole("button", {
        name: /^(儲存供應商|Save provider)$/,
      }),
      cancel = providers.getByRole("button", { name: /^(取消|Cancel)$/ });
    await expect(name).toHaveValue(connection.name);
    await expect(key).toHaveValue("");
    await expect(
      providers.locator(".provider-model-advanced"),
    ).not.toHaveAttribute("open");
    const saveBox = await hit(page, save),
      cancelBox = await hit(page, cancel);
    const compactAudit = await audit(page),
      profile = `${config.width}-${config.height}-${config.locale}-${config.theme}-${config.scale}x`;
    await page.screenshot({ path: join(output, `editor-${profile}.png`) });
    const modelList = providers.getByRole("group", {
      name: /^(可用模型|Available models)$/,
    });
    await modelList.focus();
    await modelList.press("End");
    await expect
      .poll(() => modelList.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(
      modelList.getByText(ids.at(-1)!, { exact: true }),
    ).toBeInViewport();
    await modelList.press("Home");
    await expect
      .poll(() => modelList.evaluate((node) => node.scrollTop))
      .toBe(0);
    await hit(page, save);
    await hit(page, cancel);
    const recommended = providers.locator(".provider-form select");
    await recommended.selectOption(ids[1]);
    await name.fill("Unsaved model draft");
    await key.fill("fixture-draft-key");
    let savedTestModel = "";
    await page.route(
      `**/api/connections/${connection.id}/test`,
      async (route) => {
        savedTestModel = route.request().postDataJSON().model;
        await route.fulfill({
          status: 200,
          json: { message: "fixture saved settings checked" },
        });
      },
    );
    await providers
      .getByRole("button", { name: /^(測試已儲存連線|Test saved connection)$/ })
      .click();
    await expect(
      providers.locator(".provider-editor-footer .notice"),
    ).toContainText("fixture saved settings checked");
    assert.equal(savedTestModel, ids[0]);
    await expect(name).toHaveValue("Unsaved model draft");
    await expect(key).toHaveValue("fixture-draft-key");
    await expect(
      modelList.getByRole("checkbox", { name: new RegExp(`^${ids[0]}`) }),
    ).toBeDisabled();
    let discoveryKey = "";
    await page.route("**/api/compatible/models", async (route) => {
      discoveryKey = route.request().postDataJSON().apiKey;
      await route.fulfill({
        status: 200,
        json: [{ id: "fixture-discovered", name: "Discovered reading model" }],
      });
    });
    await providers
      .getByRole("button", { name: /^(取得可用模型|Fetch available models)$/ })
      .click();
    await expect(
      providers.locator(".provider-editor-footer .notice"),
    ).toContainText(/找到 1 個模型|Found 1 model/);
    assert.equal(discoveryKey, "fixture-draft-key");
    await providers
      .getByRole("searchbox", { name: /^(搜尋模型|Search models)$/ })
      .fill("fixture-discovered");
    await modelList
      .getByRole("checkbox", { name: /Discovered reading model/ })
      .check();
    await providers
      .getByLabel(/手動加入模型 ID|Add model ID manually/)
      .fill("fixture-manual");
    await providers.getByRole("button", { name: /^(加入|Add)$/ }).click();
    await expect(
      modelList.getByRole("checkbox", { name: "fixture-manual", exact: true }),
    ).toBeChecked();
    await providers.locator(".provider-model-advanced > summary").click();
    const contextInput = providers
      .getByLabel(/Context token 上限|Context token limit/)
      .first();
    await contextInput.fill("1000");
    await providers.locator(".provider-model-advanced > summary").click();
    await save.click();
    await expect(contextInput).toBeFocused();
    await expect(providers.locator(".provider-model-advanced")).toHaveAttribute(
      "open",
      "",
    );
    await contextInput.fill("128000");
    const advancedAudit = await audit(page);
    injectedPath = `/api/connections/${connection.id}`;
    await page.route(`**${injectedPath}`, async (route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 503,
          json: { error: "fixture provider save unavailable. ".repeat(35) },
        });
      else await route.continue();
    });
    await save.click();
    const failure = providers.getByRole("alert", {
      name: /供應商操作結果|Provider operation result/,
    });
    await expect(failure).toContainText("fixture provider save unavailable");
    await expect.poll(() => expectedErrors.length).toBe(1);
    injectedPath = "";
    await failure.focus();
    await failure.press("End");
    await expect
      .poll(() => failure.evaluate((n) => n.scrollTop))
      .toBeGreaterThan(0);
    await failure.press("Home");
    await expect.poll(() => failure.evaluate((n) => n.scrollTop)).toBe(0);
    assert.equal(
      await failure.evaluate((node) => {
        const range = document.createRange();
        range.setStart(node.firstChild!, 0);
        range.setEnd(node.firstChild!, 10);
        const text = range.getBoundingClientRect(),
          box = node.getBoundingClientRect();
        return text.top >= box.top && text.bottom <= box.bottom;
      }),
      true,
    );
    await hit(page, save);
    await hit(page, cancel);
    await expect(name).toHaveValue("Unsaved model draft");
    await expect(key).toHaveValue("fixture-draft-key");
    await page.screenshot({ path: join(output, `failure-${profile}.png`) });
    await page.unroute(`**/api/connections/${connection.id}`);
    await cancel.click();
    assert.equal(app.connections.view()[0].name, connection.name);
    assert.equal(app.connections.view()[0].model, ids[0]);
    await providers.getByRole("button", { name: /^(編輯|Edit)$/ }).click();
    await expect(key).toHaveValue("");
    await name.fill("Discard confirmation draft");
    page.once("dialog", (d) => d.dismiss());
    await providers.locator(".provider-back").click();
    await expect(name).toHaveValue("Discard confirmation draft");
    page.once("dialog", (d) => d.accept());
    await providers.locator(".provider-back").click();
    await expect(providers.locator(".provider-card")).toHaveCount(1);
    {
      const picker = providers.locator(".model-picker");
      await picker.locator("summary").click();
      injectedPath = "/api/connections/default";
      await page.route("**/api/connections/default", (r) =>
        r.fulfill({
          status: 503,
          json: { error: "fixture default unavailable" },
        }),
      );
      await picker.getByRole("option", { name: ids[1], exact: true }).click();
      await expect(providers.getByRole("alert")).toContainText(
        "fixture default unavailable",
      );
      await expect(providers.getByRole("alert")).toBeInViewport();
      await expect.poll(() => expectedErrors.length).toBe(2);
      injectedPath = "";
      assert.deepEqual(app.connections.defaultSelection(), {
        connectionId: connection.id,
        model: ids[0],
      });
      await page.unroute("**/api/connections/default");
    }
    await page
      .getByRole("button", { name: /^(關閉設定|Close settings)$/ })
      .click();
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue("保留模型設定對話草稿");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    profiles.push({
      profile,
      saveBox,
      cancelBox,
      listAudit,
      compactAudit,
      advancedAudit,
      errors,
      expectedErrors,
      savedTestModel,
    });
    await context.close();
  }
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  await page.goto(base);
  await page
    .getByRole("button", { name: /^(設定與工具|Settings & tools)$/ })
    .click();
  const providers = page.locator(".provider-settings");
  await providers.getByRole("button", { name: /^(編輯|Edit)$/ }).click();
  await providers.getByLabel(/^(名稱|Name)$/).fill("Saved reading models");
  await providers
    .getByRole("button", { name: /^(儲存供應商|Save provider)$/ })
    .click();
  await expect(providers.locator(".provider-card")).toContainText(
    "Saved reading models",
  );
  const saved = app.connections.view()[0];
  assert.deepEqual(saved.models, ids);
  assert.deepEqual(saved.modelSettings, connection.modelSettings);
  assert.equal(saved.credentialConfigured, true);
  assert.equal(app.connections.rows[0].apiKey, "fixture-original-key");
  assert.deepEqual(app.connections.defaultSelection(), {
    connectionId: connection.id,
    model: ids[0],
  });
  await context.close();
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        browser: verificationBrowser,
        version: browser.version(),
        profiles,
        savePreservesCatalog: true,
        savePreservesDefault: true,
        blankKeyPreserved: true,
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
} catch (error) {
  console.error(error);
  const page = browser?.contexts().at(-1)?.pages().at(-1);
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.product.close();
  await app.close();
}
