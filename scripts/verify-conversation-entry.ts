import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const baseline = process.argv.includes("--baseline");
const serve = process.argv.includes("--serve");
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  desktopOnly
    ? "artifacts/conversation-entry/desktop"
    : "artifacts/conversation-entry",
);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-entry-"));
const received: string[] = [];
async function fixture(name: string, ready: boolean) {
  const app = await createApp({
    dataDir: join(directory, name, "data"),
    workspaceDir: join(directory, name, "work"),
    runner: async (options) => {
      received.push(options.prompt);
      return { text: "已收到完整需求，這是隔離測試回覆。" };
    },
  });
  if (ready) {
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
    await app.product.bots.create("研究夥伴", { avatar: "cloud" });
    await app.product.bots.create("文件幫手", { avatar: "bean" });
  }
  await app.product.bootstrap();
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return {
    app,
    bot: app.product.db.bots.list()[0],
    base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
  };
}
const missing = await fixture("missing", false);
const ready = await fixture("ready", true);
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
try {
  for (const width of desktopOnly ? [1440, 1024] : [1440, 375])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        for (const mode of ["missing", "ready"] as const) {
          const item = mode === "missing" ? missing : ready;
          item.app.product.settings.update(
            { locale },
            item.app.product.settings.read().revision,
          );
          const context = await browser.newContext({
            viewport: { width, height: 900 },
            reducedMotion: "reduce",
          });
          await context.addInitScript(
            ({ theme, locale, botId }) => {
              localStorage.setItem("apsis.theme", theme);
              localStorage.setItem("apsis.locale", locale);
              localStorage.setItem("apsis.bot", botId);
            },
            { theme, locale, botId: item.bot.id },
          );
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(item.base);
          await expect(page.locator(".bot-intro h2")).toBeVisible();
          const input = page.getByRole("textbox", {
            name: /^(傳送訊息|Send message)$/,
          });
          const starters = page.locator(".starter-prompts button");
          const name = `${width}-${locale}-${theme}-${mode}`;
          await page.screenshot({
            path: join(output, `${baseline ? "before" : "after"}-${name}.png`),
          });
          if (mode === "missing") {
            const setupCount = await page
              .locator(".model-setup-notice button, .setup-hint")
              .count();
            const report = {
              name,
              setupCount,
              starterCount: await starters.count(),
              errors,
            };
            if (!baseline) {
              assert.equal(setupCount, 1);
              await expect(starters).toHaveCount(0);
              await input.fill("未設定模型時先寫下的需求");
              await expect(
                page.getByRole("button", { name: /^(傳送|Send)$/ }),
              ).toBeDisabled();
              await page.locator(".model-setup-notice button").click();
              await expect(page.locator(".provider-settings")).toBeVisible();
              await page.keyboard.press("Escape");
              await expect(
                page.locator(".model-setup-notice button"),
              ).toBeFocused();
              await expect(input).toHaveValue("未設定模型時先寫下的需求");
              await expect(
                page.locator(".model-setup-notice button"),
              ).toBeInViewport();
              const audit = await new AxeBuilder({ page }).analyze();
              assert.deepEqual(audit.violations, []);
              Object.assign(report, {
                violations: audit.violations,
                incomplete: audit.incomplete,
              });
              if (locale === "en") {
                await fixtureStyle(page, {
                  content: "html {font-size:200% !important;}",
                });
                await expect(
                  page.locator(".model-setup-notice button"),
                ).toBeInViewport();
                assert.ok(
                  await page.evaluate(
                    () =>
                      document.documentElement.scrollWidth <= innerWidth + 1,
                  ),
                );
                await page.screenshot({
                  path: join(output, `after-${name}-200pct.png`),
                });
              }
            }
            reports.push(report);
          } else {
            await expect(starters).toHaveCount(3);
            const beforeMessages = received.length;
            const oldDraft = "這是我正在寫、不能被範例替換的需求。";
            await input.fill(oldDraft);
            if (baseline) {
              await starters.first().click();
              const preservedAfterExample =
                (await input.inputValue()) === oldDraft;
              await input.fill(oldDraft);
              await page.reload();
              await expect(page.locator(".bot-intro")).toBeVisible();
              reports.push({
                name,
                preservedAfterExample,
                preservedAfterReload: (await input.inputValue()) === oldDraft,
                errors,
              });
            } else {
              await expect(starters).toHaveCount(0);
              await page.reload();
              await expect(input).toHaveValue(oldDraft);
              await expect(starters).toHaveCount(0);
              await input.fill("");
              await expect(starters).toHaveCount(3);
              for (let index = 0; index < 3; index++) {
                await starters.nth(index).focus();
                await page.keyboard.press("Enter");
                await expect(input).toBeFocused();
                assert.ok(
                  (await input.inputValue()).endsWith(": ") ||
                    (await input.inputValue()).endsWith("： "),
                );
                const position = await input.evaluate((element) => {
                  const el = element as HTMLTextAreaElement;
                  return {
                    start: el.selectionStart,
                    end: el.selectionEnd,
                    length: el.value.length,
                  };
                });
                assert.equal(position.start, position.length);
                assert.equal(position.end, position.length);
                assert.equal(
                  received.length,
                  beforeMessages,
                  "Choosing an example must not send a message",
                );
                await input.pressSequentially("我想補上的內容");
                await expect(input).toHaveValue(/我想補上的內容$/);
                await input.fill("");
              }
              await starters.first().click();
              const exampleDraft = await input.inputValue();
              await page.reload();
              await expect(input).toHaveValue(exampleDraft);
              assert.equal(received.length, beforeMessages);
              await input.fill("");
              const audit = await new AxeBuilder({ page }).analyze();
              assert.deepEqual(audit.violations, []);
              const dimensions = await page.evaluate(() => ({
                width: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
              }));
              assert.ok(dimensions.documentWidth <= dimensions.width + 1);
              reports.push({
                name,
                preservedAfterReload: true,
                examplesFocusAtEnd: true,
                noAutomaticSend: true,
                violations: audit.violations,
                incomplete: audit.incomplete,
                errors,
              });
              if (locale === "en") {
                await fixtureStyle(page, {
                  content: "html {font-size:200% !important;}",
                });
                await page.screenshot({
                  path: join(output, `after-${name}-200pct.png`),
                });
                assert.ok(
                  await page.evaluate(
                    () =>
                      document.documentElement.scrollWidth <= innerWidth + 1,
                  ),
                );
              }
            }
          }
          assert.deepEqual(errors, []);
          await context.close();
        }
      }
  if (!baseline) {
    missing.app.product.settings.update(
      { locale: "zh-Hant" },
      missing.app.product.settings.read().revision,
    );
    const context = await browser.newContext({
      viewport: desktopOnly
        ? { width: 1440, height: 900 }
        : { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto(missing.base);
    const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
    const draft = "請幫我檢查這段需求是否清楚。";
    await expect(page.locator(".model-setup-notice button")).toBeVisible();
    await input.fill(draft);
    await page.locator(".model-setup-notice button").click();
    const providers = page.locator(".provider-settings");
    await providers
      .getByRole("button", { name: "新增供應商", exact: true })
      .click();
    await providers.getByRole("button", { name: /Ollama/ }).click();
    await providers.getByLabel("名稱", { exact: true }).fill("Entry fixture");
    await providers.getByLabel("API 網址").fill("http://127.0.0.1:1");
    await providers.getByLabel("手動加入模型 ID").fill("fixture");
    await providers.getByRole("button", { name: "加入", exact: true }).click();
    await providers
      .getByRole("button", { name: "儲存供應商", exact: true })
      .click();
    await expect(
      providers.getByText("Entry fixture", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "關閉設定", exact: true }).click();
    await expect(page.locator(".model-setup-notice")).toHaveCount(0);
    await expect(input).toHaveValue(draft);
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("button", { name: "傳送", exact: true }),
    ).toBeEnabled();
    assert.equal(received.length, 0);
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    await expect(page.locator(".message.assistant")).toContainText(
      "這是隔離測試回覆",
    );
    assert.deepEqual(received, [draft]);
    await expect(input).toHaveValue("");
    await page.reload();
    await expect(page.locator(".message.assistant")).toContainText(
      "這是隔離測試回覆",
    );
    await expect(input).toHaveValue("");
    reports.push({
      name: "first-use-connect-and-send",
      preservedDraftThroughSetup: true,
      explicitSendOnly: true,
      storedReplyAfterReload: true,
      runner: "isolated fixture",
    });
    await context.close();
  }
  await writeFile(
    join(output, baseline ? "before.json" : "after.json"),
    JSON.stringify(
      { baseline, reports, runnerCalls: received, fixtureOnly: true },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      baseline,
      reports: reports.length,
      runnerCalls: received.length,
      fixtureOnly: true,
    }),
  );
  if (serve) {
    ready.app.product.settings.update(
      { locale: "zh-Hant" },
      ready.app.product.settings.read().revision,
    );
    console.log(JSON.stringify({ preview: ready.base, fixtureOnly: true }));
    await once(process, "SIGINT");
  }
} finally {
  await browser.close();
  await missing.app.close();
  await ready.app.close();
}
