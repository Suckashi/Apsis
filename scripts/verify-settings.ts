import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import type { Bot, BotTemplate, Connector } from "../shared/product.ts";
import type { RunOptions } from "../server/runtime.ts";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

// Run after npm run build. Real app/storage/UI; no credentials or external model calls.
const output = resolve("artifacts/settings-verification");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-settings-browser-"));
const calls: RunOptions[] = [];
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    calls.push(options);
    return { text: "Settings fixture completed." };
  },
});
const connection = await app.connections.save({
  name: "Settings fixture",
  provider: "ollama",
  model: "fixture-model",
  modelSettings: { "fixture-model": { contextWindowTokens: 128000 } },
  url: "http://127.0.0.1:1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
// Existing installations can still carry a readable Codex connection record.
app.connections.rows.push({
  id: "legacy-codex-fixture",
  name: "ChatGPT Codex",
  provider: "codex",
  model: "legacy-model",
  models: ["legacy-model"],
});
await app.store.mutate((state) => {
  state.skills.push(
    { id: "skill-a", name: "Settings Skill A", content: "Fixture A" },
    { id: "skill-b", name: "Settings Skill B", content: "Fixture B" },
  );
});
for (const suffix of ["A", "B"])
  app.product.db.put<Connector>("connector", {
    id: `connector-${suffix}`,
    name: `Settings MCP ${suffix}`,
    url: "http://127.0.0.1:1/mcp",
    enabled: true,
  });
const bot = await app.product.create("Settings fixture Bot", {
  skillIds: ["skill-a", "skill-b"],
  connectorIds: ["connector-A", "connector-B"],
});
await new Promise<void>((resolve) =>
  app.server.listen(0, "127.0.0.1", resolve),
);
const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
const externalRequests: string[] = [];
let blockedLocalInjections = 0;
const results: { name: string; passed: boolean; error?: string }[] = [];
let expectedConflict = false;
let expectedSaveFailure = false;
async function protect(page: Page) {
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !(expectedConflict && /409/.test(message.text())) &&
      !(expectedSaveFailure && /503/.test(message.text()))
    )
      errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (target.origin === url) await route.continue();
    else if (target.hostname === "local.adguard.org") {
      // OS-level AdGuard injects these on this host. Supply an empty local response;
      // never contact it or execute its scripts, and report the intercepted count.
      blockedLocalInjections++;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "",
      });
    } else {
      externalRequests.push(route.request().url());
      await route.abort();
    }
  });
}
const page = await context.newPage();
await protect(page);
const dialog = (p: Page) =>
  p.getByRole("dialog", { name: /設定與工具|Settings & tools/ });
async function openSettings(
  p: Page,
  tab: RegExp = /執行與語言|Execution & language/,
) {
  await p.goto(url);
  await p.locator(".settings-link").waitFor({ state: "attached" });
  if (!(await p.locator(".settings-link").isVisible()))
    await p
      .locator('button[aria-controls="bot-roster"]:visible')
      .first()
      .click();
  await p.locator(".settings-link").click();
  await dialog(p)
    .locator(".settings-tabs")
    .getByRole("button", { name: tab })
    .click();
}
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    results.push({ name, passed: false, error: message });
    await page
      .screenshot({
        path: join(output, `failure-${results.length}.png`),
        fullPage: true,
      })
      .catch(() => {});
    console.error(`FAIL ${name}: ${message}`);
  }
}
async function savedSettings(p: Page) {
  await p
    .locator(".execution-settings")
    .getByRole("button", { name: /儲存變更|Save changes/ })
    .click();
  await expect(
    p
      .locator(".execution-settings")
      .getByText(/已儲存變更|Changes saved/, { exact: true }),
  ).toBeVisible();
}

async function discardSettingsDraft(
  action: () => Promise<unknown>,
  accept: boolean,
) {
  const prompted = page.waitForEvent("dialog");
  const acting = action();
  const confirmation = await prompted;
  assert.equal(confirmation.type(), "confirm");
  assert.match(confirmation.message(), /Discard unsaved settings changes/);
  if (accept) await confirmation.accept();
  else await confirmation.dismiss();
  await acting;
}

try {
  await check(
    "conversation approval switch persists, syncs and rejects stale edits",
    async () => {
      await page.goto(url);
      await page.evaluate(
        (id) => localStorage.setItem("apsis.bot", id),
        bot.id,
      );
      await page.reload();
      await page
        .locator(".approval-mode-control > .composer-popover > summary")
        .click();
      const trigger = page.locator(
        ".approval-mode-control > .composer-popover > summary",
      );
      const mode = page.getByRole("radiogroup", {
        name: /對話核准模式|Conversation approval mode/,
      });
      await expect(mode.locator('[data-mode="yolo"]')).toBeChecked();
      const before = app.product.settings.read();
      const second = await context.newPage();
      await protect(second);
      try {
        await second.goto(url);
        await second
          .locator(".approval-mode-control > .composer-popover > summary")
          .click();
        const other = second.getByRole("radiogroup", {
          name: /對話核准模式|Conversation approval mode/,
        });
        await expect(other.locator('[data-mode="yolo"]')).toBeChecked();
        for (const value of ["manual", "auto", "yolo"] as const) {
          if (!(await mode.isVisible())) await trigger.click();
          await mode.locator(`[data-mode="${value}"]`).click();
          await expect(mode).toBeHidden();
          await expect(trigger).toBeFocused();
          await expect(page.locator(".approval-mode-control")).toHaveAttribute(
            "data-mode",
            value,
          );
          await expect(other.locator(`[data-mode="${value}"]`)).toBeChecked();
          assert.equal(app.product.settings.read().approvalMode, value);
        }
        assert.equal(
          app.product.settings.read().dangerousCommandGuard,
          before.dangerousCommandGuard,
        );
        assert.equal(
          calls.length,
          0,
          "switching modes must not invoke the model",
        );
        await page.reload();
        await page
          .locator(".approval-mode-control > .composer-popover > summary")
          .click();
        await expect(mode.locator('[data-mode="yolo"]')).toBeChecked();
        await trigger.press("Tab");
        await expect(mode.locator('[data-mode="yolo"]')).toBeFocused();
        await page.keyboard.press("ArrowUp");
        await expect(mode.locator('[data-mode="manual"]')).toBeFocused();
        assert.equal(
          app.product.settings.read().approvalMode,
          "yolo",
          "arrow keys only move focus until confirmed",
        );
        await page.keyboard.press("Escape");
        await expect(mode).toBeHidden();
        await expect(trigger).toBeFocused();
        await trigger.press("Enter");
        expectedConflict = true;
        await page.route("**/api/v2/settings", async (route) => {
          if (route.request().method() === "PATCH") {
            const current = app.product.settings.read();
            app.product.settings.update({
              revision: current.revision,
              approvalMode: "manual",
            });
          }
          await route.continue();
        });
        await mode.locator('[data-mode="auto"]').click();
        await expect(
          page.locator(".approval-mode-control [role=alert]"),
        ).toContainText(/設定已變更|Settings changed/);
        await expect(mode.locator('[data-mode="manual"]')).toBeChecked();
        assert.equal(app.product.settings.read().approvalMode, "manual");
        await page.unroute("**/api/v2/settings");
        expectedConflict = false;
        await mode.locator('[data-mode="manual"]').press("ArrowDown");
        await page.keyboard.press("Space");
        await expect(mode).toBeHidden();
        await expect(page.locator(".approval-mode-control")).toHaveAttribute(
          "data-mode",
          "yolo",
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await trigger.click();
        await expect(mode).toBeVisible();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: join(output, "conversation-approval-mobile.png"),
          fullPage: true,
        });
      } finally {
        await page.unroute("**/api/v2/settings");
        expectedConflict = false;
        await second.close();
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
    },
  );
  await check(
    "pending mode save disables choices and failed save retains the effective mode",
    async () => {
      await page.reload();
      const trigger = page.locator(
        ".approval-mode-control > .composer-popover > summary",
      );
      await trigger.click();
      const picker = page.getByRole("radiogroup", {
        name: /對話核准模式|Conversation approval mode/,
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requests = 0;
      expectedSaveFailure = true;
      await page.route("**/api/v2/settings", async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        requests++;
        await held;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Mode save unavailable" }),
        });
      });
      try {
        await picker.locator('[data-mode="manual"]').click();
        for (const radio of await picker.getByRole("radio").all())
          await expect(radio).toBeDisabled();
        assert.equal(requests, 1);
        release();
        await expect(
          page.locator('.approval-mode-control [role="alert"]'),
        ).toContainText("Mode save unavailable");
        await expect(picker.locator('[data-mode="yolo"]')).toBeChecked();
        await expect(picker.locator('[data-mode="manual"]')).toBeEnabled();
        assert.equal(app.product.settings.read().approvalMode, "yolo");
      } finally {
        release();
        await page.unroute("**/api/v2/settings");
        expectedSaveFailure = false;
      }
    },
  );
  await check(
    "approval modes, guard and shell glob save and reload",
    async () => {
      await openSettings(page);
      const mode = page.getByRole("radiogroup", {
        name: /工具核准模式|Tool approval mode/,
      });
      await expect(mode.locator('[data-mode="yolo"]')).toBeChecked();
      await mode.locator('[data-mode="auto"]').click();
      assert.equal(
        app.product.settings.read().approvalMode,
        "yolo",
        "settings mode stays a draft until saved",
      );
      await page
        .locator(".execution-settings .settings-advanced > summary")
        .click();
      const guard = page.getByLabel(/危險命令確認|Dangerous-command guard/);
      await expect(guard).toBeDisabled();
      await mode.locator('[data-mode="manual"]').click();
      await expect(guard).toBeEnabled();
      await guard.uncheck();
      await page.getByRole("button", { name: /新增規則|Add rule/ }).click();
      const rule = page.locator(".execution-settings .permission-rule").last();
      await rule.getByLabel(/工具|Tool/, { exact: true }).fill("shell");
      await rule
        .getByLabel(/完整命令 glob|Whole-command glob/)
        .fill("npm run *");
      await savedSettings(page);
      assert.equal(app.product.settings.read().approvalMode, "manual");
      assert.equal(app.product.settings.read().dangerousCommandGuard, false);
      assert.equal(
        app.product.settings.read().permissionRules[0].commandPattern,
        "npm run *",
      );
      await openSettings(page);
      await expect(
        page
          .getByRole("radiogroup", { name: /工具核准模式|Tool approval mode/ })
          .locator('[data-mode="manual"]'),
      ).toBeChecked();
      await page.screenshot({
        path: join(output, "approval-mode.png"),
        fullPage: true,
      });
      app.product.settings.update({
        revision: app.product.settings.read().revision,
        approvalMode: "yolo",
        dangerousCommandGuard: true,
        permissionRules: [],
      });
    },
  );
  await check("execution settings save and reload", async () => {
    await openSettings(page);
    await page
      .getByLabel(/每次任務的回合上限|Maximum turns per task/)
      .fill("23");
    await page
      .getByLabel(/任務逾時（秒）|Task timeout \(seconds\)/)
      .fill("1200");
    await savedSettings(page);
    assert.equal(app.product.settings.read().maxTurns, 23);
    assert.equal(app.product.settings.read().taskTimeoutMs, 1200000);
    await openSettings(page);
    await expect(
      page.getByLabel(/每次任務的回合上限|Maximum turns per task/),
    ).toHaveValue("23");
    await expect(
      page.getByLabel(/任務逾時（秒）|Task timeout \(seconds\)/),
    ).toHaveValue("1200");
  });
  await check(
    "stale revision preserves edits, disables save, and reloads current settings",
    async () => {
      await openSettings(page);
      const turns = page.getByLabel(
        /每次任務的回合上限|Maximum turns per task/,
      );
      await turns.fill("24");
      app.product.settings.update({
        revision: app.product.settings.read().revision,
        maxTurns: 25,
      });
      expectedConflict = true;
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v2/settings") &&
          r.request().method() === "PATCH",
      );
      await page
        .locator(".execution-settings")
        .getByRole("button", { name: /儲存變更|Save changes/ })
        .click();
      assert.equal((await response).status(), 409);
      await expect(page.getByRole("alert")).toContainText(
        /其他視窗|another window/,
      );
      await expect(turns).toHaveValue("24");
      await expect(
        page
          .locator(".execution-settings")
          .getByRole("button", { name: /儲存變更|Save changes/ }),
      ).toBeDisabled();
      await page.screenshot({
        path: join(output, "revision-conflict.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: /重新載入|Reload/, exact: true })
        .click();
      await expect(turns).toHaveValue("25");
      expectedConflict = false;
    },
  );
  await check(
    "English locale persists and renders settings plus navigation in English",
    async () => {
      await openSettings(page);
      await page.getByLabel(/介面語言|Interface language/).selectOption("en");
      await savedSettings(page);
      await openSettings(page);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        dialog(page).getByRole("heading", {
          name: "Settings & tools",
          exact: true,
        }),
      ).toBeVisible();
      for (const name of [
        "Execution & language",
        "Model connections",
        "Connectors",
        "Skills",
        "Bot templates",
        "Auto approvals",
      ])
        await expect(
          dialog(page)
            .locator(".settings-tabs")
            .getByRole("button", { name, exact: true }),
        ).toBeVisible();
      await expect(page.locator(".settings-link")).toHaveText(
        "Settings & tools",
      );
      await expect(page.getByLabel("Maximum turns per task")).toHaveValue("25");
    },
  );
  await check(
    "cancel discards edits; reset previews defaults without persisting",
    async () => {
      await openSettings(page);
      const before = app.product.settings.read();
      const execution = page.locator(".execution-settings");
      const turns = execution.getByLabel("Maximum turns per task");
      await turns.fill("31");
      await expect(
        execution.getByText("Unsaved changes", { exact: true }),
      ).toBeVisible();
      await execution
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(turns).toHaveValue(String(before.maxTurns));
      await expect(
        execution.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      assert.deepEqual(app.product.settings.read(), before);
      await execution
        .getByRole("button", { name: "Reset to defaults", exact: true })
        .click();
      await expect(turns).toHaveValue(String(DEFAULT_SETTINGS.maxTurns));
      await expect(execution.getByLabel("Task timeout (seconds)")).toHaveValue(
        String(DEFAULT_SETTINGS.taskTimeoutMs / 1000),
      );
      await expect(execution.getByLabel("Interface language")).toHaveValue(
        DEFAULT_SETTINGS.locale,
      );
      assert.deepEqual(
        app.product.settings.read(),
        before,
        "Reset is a draft until saved",
      );
      await execution
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(turns).toHaveValue(String(before.maxTurns));
      await expect(execution.getByLabel("Interface language")).toHaveValue(
        "en",
      );
      await openSettings(page);
      await expect(page.getByLabel("Task timeout (seconds)")).toHaveValue(
        "1200",
      );
      assert.deepEqual(app.product.settings.read(), before);
    },
  );
  await check(
    "dirty tab navigation and Escape require an explicit discard decision",
    async () => {
      await openSettings(page);
      const before = app.product.settings.read();
      const turns = page.getByLabel("Maximum turns per task");
      const models = dialog(page)
        .locator(".settings-tabs")
        .getByRole("button", { name: "Model connections", exact: true });
      async function confirmDiscard(
        action: () => Promise<unknown>,
        accept: boolean,
      ) {
        const prompted = page.waitForEvent("dialog");
        const acting = action();
        const confirmation = await prompted;
        assert.equal(confirmation.type(), "confirm");
        assert.match(
          confirmation.message(),
          /Discard unsaved settings changes/,
        );
        if (accept) await confirmation.accept();
        else await confirmation.dismiss();
        await acting;
      }
      await turns.fill("32");
      await expect(
        page.getByText("Unsaved changes", { exact: true }),
      ).toBeVisible();
      await confirmDiscard(() => models.click(), false);
      await expect(turns).toHaveValue("32");
      await confirmDiscard(() => models.click(), true);
      await expect(page.locator(".provider-settings")).toBeVisible();
      await dialog(page)
        .locator(".settings-tabs")
        .getByRole("button", { name: "Execution & language", exact: true })
        .click();
      await expect(turns).toHaveValue(String(before.maxTurns));
      await turns.fill("33");
      await expect(
        page.getByText("Unsaved changes", { exact: true }),
      ).toBeVisible();
      await confirmDiscard(() => page.keyboard.press("Escape"), false);
      await expect(turns).toHaveValue("33");
      await confirmDiscard(() => page.keyboard.press("Escape"), true);
      await expect(dialog(page)).toHaveCount(0);
      assert.deepEqual(app.product.settings.read(), before);
    },
  );
  await check(
    "provider catalog has no Codex and saves new model metadata",
    async () => {
      await openSettings(page, /模型連線|Model connections/);
      const providers = page.locator(".provider-settings");
      await expect(providers.locator(".provider-list")).not.toContainText(
        "ChatGPT Codex",
      );
      await providers
        .getByRole("button", { name: /新增供應商|Add provider/, exact: true })
        .click();
      await expect(providers.locator(".provider-catalog")).not.toContainText(
        /Codex|ChatGPT/,
      );
      await providers.getByRole("button", { name: /Ollama/ }).click();
      await providers
        .getByLabel(/名稱|Name/, { exact: true })
        .fill("Metadata fixture");
      await providers.getByLabel(/API 網址|API URL/).fill("http://127.0.0.1:1");
      await providers
        .getByLabel(/手動加入模型 ID|Add model ID manually/)
        .fill("metadata-model");
      await providers.getByRole("button", { name: /^(加入|Add)$/ }).click();
      await providers.locator(".provider-model-advanced summary").click();
      await providers
        .getByLabel(/顯示名稱|Display name/, { exact: true })
        .fill("Friendly fixture");
      await providers
        .getByLabel(/輸出 token 上限|Output token limit|Maximum output tokens/)
        .fill("2048");
      await providers
        .getByRole("button", { name: /儲存供應商|Save provider/, exact: true })
        .click();
      await expect(
        providers.getByText("Metadata fixture", { exact: true }),
      ).toBeVisible();
      const row = app.connections
        .view()
        .find((c) => c.name === "Metadata fixture")!;
      assert.deepEqual(row.modelSettings?.["metadata-model"], {
        displayName: "Friendly fixture",
        maxOutputTokens: 2048,
      });
      await openSettings(page, /模型連線|Model connections/);
      await providers
        .locator(".provider-card")
        .filter({ hasText: "Metadata fixture" })
        .getByRole("button", { name: /編輯|Edit/ })
        .click();
      await providers.locator(".provider-model-advanced summary").click();
      await expect(
        providers.getByLabel(/顯示名稱|Display name/, { exact: true }),
      ).toHaveValue("Friendly fixture");
    },
  );
  await check(
    "per-Bot skill/MCP choices, read-only rules, and template save/create",
    async () => {
      await page.goto(url);
      await page.getByTitle(bot.name, { exact: true }).click();
      await page.locator(".header-profile").click();
      const profile = page.locator(".profile-form");
      await profile.getByLabel("Settings Skill B", { exact: true }).uncheck();
      await profile.getByLabel("Settings MCP B", { exact: true }).uncheck();
      await profile
        .getByLabel(/工作區權限|Workspace access/)
        .selectOption("readonly");
      await profile.getByRole("button", { name: /新增規則|Add rule/ }).click();
      const toolName = profile.getByLabel(/^(工具|Tool)$/);
      for (const value of ["shell", "save_skill", "read_file", "*"]) {
        await toolName.fill(value);
        assert.ok(
          await toolName.evaluate(
            (input) => (input as HTMLInputElement).validity.valid,
          ),
          `Tool pattern must accept ${JSON.stringify(value)}`,
        );
      }
      for (const value of ["", "shell command", "shell*", "shell?"]) {
        await toolName.fill(value);
        assert.equal(
          await toolName.evaluate(
            (input) => (input as HTMLInputElement).validity.valid,
          ),
          false,
          `Tool pattern must reject ${JSON.stringify(value)}`,
        );
      }
      await profile.getByLabel(/^(工具|Tool)$/).fill("shell");
      assert.ok(
        await profile
          .getByLabel(/^(工具|Tool)$/)
          .evaluate((input) => (input as HTMLInputElement).validity.valid),
        "Permission tool input must accept the valid tool name 'shell'",
      );
      await profile.getByLabel(/處理方式|Decision/).selectOption("deny");
      await profile
        .getByRole("button", { name: /儲存變更|Save changes/, exact: true })
        .click();
      await expect(
        profile.getByText(/已儲存變更|Changes saved/, { exact: true }),
      ).toBeVisible();
      const saved = app.product.bot(bot.id);
      assert.deepEqual(saved.skillIds, ["skill-a"]);
      assert.deepEqual(saved.connectorIds, ["connector-A"]);
      assert.equal(saved.permissionMode, "readonly");
      assert.equal(saved.permissionRules?.[0].effect, "deny");
      await page.reload();
      if (!(await profile.isVisible()))
        await page.locator(".header-profile").click();
      await expect(
        profile.getByLabel("Settings Skill B", { exact: true }),
      ).not.toBeChecked();
      await expect(
        profile.getByLabel("Settings MCP B", { exact: true }),
      ).not.toBeChecked();
      await expect(
        profile.getByLabel(/工作區權限|Workspace access/),
      ).toHaveValue("readonly");
      await profile
        .getByRole("button", { name: /儲存為範本|Save as template/ })
        .click();
      await expect(
        profile.getByText(/範本已儲存|Template saved/, { exact: true }),
      ).toBeVisible();
      const template = app.product.db.all<BotTemplate>("template")[0];
      assert.ok(template);
      assert.ok(!("apiKey" in template) && !("token" in template));
      await openSettings(page, /Bot 範本|Bot templates/);
      await page
        .locator(".template-card")
        .getByRole("button", { name: /建立 Bot|Create Bot/, exact: true })
        .click();
      await expect(
        page.getByText(/已從範本建立 Bot|Bot created from template/, {
          exact: true,
        }),
      ).toBeVisible();
      const copy = app.product.db.all<Bot>("bot").find((b) => b.id !== bot.id)!;
      assert.deepEqual(copy.skillIds, saved.skillIds);
      assert.deepEqual(copy.connectorIds, saved.connectorIds);
      assert.equal(copy.permissionMode, "readonly");
      assert.equal(copy.permissionRules?.[0].effect, "deny");
      await app.product.submit(copy.id, {
        requestId: "settings-browser-run",
        prompt: "fixture",
      });
      await expect.poll(() => calls.length).toBe(1);
      assert.deepEqual(calls[0].agent?.skillIds, ["skill-a"]);
      assert.equal(
        calls[0].runtimeSettings?.maxTurns,
        app.product.settings.read().maxTurns,
      );
      await assert.rejects(
        app.product.authorize(copy.id, "fixture", "write_file", {
          path: "blocked.txt",
        }),
        { status: 403 },
      );
    },
  );
  await check(
    "provider unsaved edits guard tab changes, Back, and Escape without persisting",
    async () => {
      const before = structuredClone(
        app.connections.view().find((c) => c.id === connection.id)!,
      );
      await openSettings(page, /模型連線|Model connections/);
      const providers = page.locator(".provider-settings");
      const edit = () =>
        providers
          .locator(".provider-card")
          .filter({ hasText: before.name })
          .getByRole("button", { name: /編輯|Edit/, exact: true })
          .click();
      await edit();
      const name = providers.getByLabel(/名稱|Name/, { exact: true });
      await name.fill("Unsaved provider draft");
      await discardSettingsDraft(
        () =>
          dialog(page)
            .locator(".settings-tabs")
            .getByRole("button", { name: "Bot templates", exact: true })
            .click(),
        false,
      );
      await expect(name).toHaveValue("Unsaved provider draft");
      await discardSettingsDraft(
        () => providers.locator(".provider-back").click(),
        false,
      );
      await expect(name).toHaveValue("Unsaved provider draft");
      await discardSettingsDraft(
        () => providers.locator(".provider-back").click(),
        true,
      );
      await edit();
      await expect(name).toHaveValue(before.name);
      await name.fill("Another unsaved provider draft");
      await discardSettingsDraft(() => page.keyboard.press("Escape"), false);
      await expect(name).toHaveValue("Another unsaved provider draft");
      await discardSettingsDraft(() => page.keyboard.press("Escape"), true);
      await expect(dialog(page)).toHaveCount(0);
      assert.deepEqual(
        app.connections.view().find((c) => c.id === connection.id),
        before,
      );
      await openSettings(page, /模型連線|Model connections/);
      await edit();
      await expect(name).toHaveValue(before.name);
    },
  );
  await check(
    "template unsaved edits guard navigation and Escape without changing saved preferences",
    async () => {
      // Independent fixture: a profile-save regression must not hide guard coverage.
      const before = app.product.template({
        name: "Dirty guard template",
        permissionMode: "readonly",
        skillIds: ["skill-a"],
        connectorIds: ["connector-A"],
      });
      await openSettings(page, /Bot 範本|Bot templates/);
      const templates = page.locator(".template-settings");
      const edit = () =>
        templates
          .locator(".template-card")
          .filter({
            has: page.getByRole("heading", { name: before.name, exact: true }),
          })
          .getByRole("button", { name: "Edit", exact: true })
          .click();
      await edit();
      const name = templates.getByLabel("Name", { exact: true });
      await name.fill("Unsaved template draft");
      const models = dialog(page)
        .locator(".settings-tabs")
        .getByRole("button", { name: "Model connections", exact: true });
      await discardSettingsDraft(() => models.click(), false);
      await expect(name).toHaveValue("Unsaved template draft");
      await discardSettingsDraft(() => models.click(), true);
      await expect(page.locator(".provider-settings")).toBeVisible();
      await dialog(page)
        .locator(".settings-tabs")
        .getByRole("button", { name: "Bot templates", exact: true })
        .click();
      await edit();
      await expect(name).toHaveValue(before.name);
      const access = templates.getByLabel("Workspace access");
      await access.selectOption(
        before.permissionMode === "readonly" ? "workspace" : "readonly",
      );
      // Leave the native select before testing the dialog's Escape handler.
      await name.focus();
      await discardSettingsDraft(() => page.keyboard.press("Escape"), false);
      await expect(access).toHaveValue(
        before.permissionMode === "readonly" ? "workspace" : "readonly",
      );
      await discardSettingsDraft(() => page.keyboard.press("Escape"), true);
      await expect(dialog(page)).toHaveCount(0);
      assert.deepEqual(
        app.product.db.get<BotTemplate>("template", before.id),
        before,
      );
      await openSettings(page, /Bot 範本|Bot templates/);
      await edit();
      await expect(name).toHaveValue(before.name);
      await expect(access).toHaveValue(before.permissionMode);
    },
  );
  await check(
    "keyboard focus remains in settings and Escape restores focus",
    async () => {
      await openSettings(page);
      const modal = dialog(page);
      for (let i = 0; i < 35; i++) {
        await page.keyboard.press(i < 25 ? "Tab" : "Shift+Tab");
        assert.ok(
          await modal.evaluate((node) => node.contains(document.activeElement)),
          "Focus escaped settings dialog",
        );
      }
      await page.screenshot({
        path: join(output, "desktop-keyboard.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(page.locator(".settings-link")).toBeFocused();
    },
  );
  for (const width of [1440, 1024, 768, 375])
    for (const theme of ["light", "dark"] as const) {
      await check(
        `${width}px ${theme} reduced-motion layout, screenshot${width === 375 ? " and touch" : ""}`,
        async () => {
          const visual = await browser.newContext({
            viewport: { width, height: width === 375 ? 812 : 1000 },
            hasTouch: width === 375,
            isMobile: width === 375,
            colorScheme: theme,
            reducedMotion: "reduce",
          });
          const p = await visual.newPage();
          await protect(p);
          try {
            await p.addInitScript(
              (value) => localStorage.setItem("apsis.theme", value),
              theme,
            );
            await p.addInitScript(
              (id) => localStorage.setItem("apsis.bot", id),
              bot.id,
            );
            await openSettings(p);
            await expect(p.locator("html")).toHaveAttribute(
              "data-theme",
              theme,
            );
            await expect(
              p.locator(".execution-settings input[type=number]").first(),
            ).toBeVisible();
            assert.ok(
              await p.evaluate(
                () => matchMedia("(prefers-reduced-motion: reduce)").matches,
              ),
            );
            assert.ok(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              "Horizontal document overflow",
            );
            assert.ok(
              await p
                .locator(".settings-modal")
                .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
              "Settings modal overflows horizontally",
            );
            if (width === 375) {
              const tab = dialog(p)
                .locator(".settings-tabs")
                .getByRole("button", { name: /模型連線|Model connections/ });
              await tab.scrollIntoViewIfNeeded();
              const box = await tab.boundingBox();
              assert.ok(
                box && box.height >= 44 && box.width >= 44,
                "Settings tabs need 44px touch targets",
              );
              await tab.tap();
              await expect(p.locator(".provider-settings")).toBeVisible();
              await dialog(p)
                .locator(".settings-tabs")
                .getByRole("button", {
                  name: /執行與語言|Execution & language/,
                })
                .tap();
            }
            await expect(p.getByLabel("Maximum turns per task")).toHaveValue(
              "25",
            );
            await p.getByLabel("Interface language").scrollIntoViewIfNeeded();
            await p.screenshot({
              path: join(
                output,
                `settings-${width}-${theme}-reduced-motion.png`,
              ),
              fullPage: true,
            });
            const modes = p.getByRole("radiogroup", {
              name: "Tool approval mode",
            });
            await modes.scrollIntoViewIfNeeded();
            for (const radio of await modes.getByRole("radio").all()) {
              const box = await radio.boundingBox();
              assert.ok(
                box && box.height >= 44 && box.width >= 44,
                "Mode choices need 44px targets",
              );
            }
            if (width === 375) {
              const large = await p.addStyleTag({
                content: "html { font-size: 200% }",
              });
              await modes.scrollIntoViewIfNeeded();
              assert.ok(
                await p
                  .locator(".settings-content")
                  .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
                "Enlarged settings text overflows",
              );
              await p.screenshot({
                path: join(output, `settings-modes-${theme}-200pct.png`),
                fullPage: true,
              });
              await large.evaluate((node) => node.parentNode?.removeChild(node));
            }
            if (width === 375) {
              await p
                .locator(".execution-settings .settings-advanced > summary")
                .click();
              await p
                .locator(".execution-settings")
                .getByRole("button", { name: "Add rule" })
                .scrollIntoViewIfNeeded();
              await p.screenshot({
                path: join(
                  output,
                  `settings-${width}-${theme}-permissions.png`,
                ),
                fullPage: true,
              });
            }
            await p.keyboard.press("Escape");
            const trigger = p.locator(
              ".approval-mode-control > .composer-popover > summary",
            );
            await trigger.click();
            const menu = p.locator(
              ".approval-mode-control .composer-popover-content",
            );
            await expect(
              p.getByRole("radiogroup", { name: "Conversation approval mode" }),
            ).toBeVisible();
            await p.screenshot({
              path: join(output, `mode-menu-${width}-${theme}.png`),
              fullPage: true,
            });
            if (width === 375) {
              await p.addStyleTag({ content: "html { font-size: 200% }" });
              const bounds = await menu.boundingBox();
              assert.ok(
                bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
                "Enlarged mode menu leaves viewport",
              );
              assert.ok(
                await menu.evaluate(
                  (node) => node.scrollWidth <= node.clientWidth + 1,
                ),
                "Enlarged mode menu overflows",
              );
              await p.screenshot({
                path: join(output, `mode-menu-${theme}-200pct.png`),
                fullPage: true,
              });
            }
          } finally {
            await visual.close();
          }
        },
      );
    }
  await check("no unexpected browser errors or external requests", async () => {
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(errors, []);
  });
} finally {
  const report = {
    passed: results.every((r) => r.passed),
    results,
    errors,
    externalRequests,
    blockedLocalInjections,
    artifacts: output,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
  if (!report.passed) process.exitCode = 1;
}
