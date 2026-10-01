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

const directory = await mkdtemp(join(tmpdir(), "apsis-profile-feedback-"));
const output = resolve("artifacts/profile-feedback/desktop");
await mkdir(output, { recursive: true });
let runnerCalls = 0;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => {
    runnerCalls++;
    return { text: "Unused fixture" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture-default",
  models: ["fixture-default", "fixture-alt"],
  url: "http://127.0.0.1:1/v1",
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
try {
  for (const width of [1440, 1024])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        app.product.settings.update(
          { locale },
          app.product.settings.read().revision,
        );
        const bot = await app.product.bots.create(
          `Profile fixture ${width}-${locale}-${theme}`,
        );
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ theme, id }) => {
            localStorage.setItem("apsis.theme", theme);
            localStorage.setItem("apsis.bot", id);
          },
          { theme, id: bot.id },
        );
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base);
        await page.locator(".header-profile").click();
        const dialog = page.locator(".bot-profile-modal");
        const footer = dialog.locator(".profile-footer");
        const save = footer.getByRole("button", {
          name: /^(儲存變更|Save changes)$/,
        });
        const name = dialog.getByRole("textbox", { name: /^(名稱|Name)$/ });
        const role = dialog.getByRole("textbox", {
          name: /^(角色與工作方式|Role & instructions)$/,
        });
        await expect(save).toBeDisabled();
        await expect(dialog.locator(".profile-default-model")).toContainText(
          "fixture-default",
        );
        const changedName = `${bot.name} updated`;
        await name.fill(changedName);
        await expect(save).toBeEnabled();
        await expect(footer.locator(".profile-unsaved")).toHaveText(
          /尚未儲存|Unsaved changes/,
        );
        await name.fill(bot.name);
        await expect(save).toBeDisabled();
        await expect(footer.locator(".profile-unsaved")).toHaveCount(0);
        await role.fill("Unsaved instructions.");
        await dialog.locator(".profile-management > summary").press("Enter");
        await dialog
          .getByRole("button", { name: /^(釘選 Bot|Pin Bot)$/ })
          .click();
        await expect(footer.getByRole("status")).toContainText(
          /Bot 已釘選。|Bot pinned\./,
        );
        await expect(footer.getByRole("status")).toContainText(
          /尚未儲存|Unsaved changes/,
        );
        assert.equal(app.product.bots.bot(bot.id).pinned, true);
        assert.notEqual(
          app.product.bots.bot(bot.id).description,
          "Unsaved instructions.",
        );
        await expect(save).toBeEnabled();
        await dialog
          .getByRole("button", { name: /^(取消釘選|Unpin)$/ })
          .click();
        await expect(footer.getByRole("status")).toContainText(
          /Bot 已取消釘選。|Bot unpinned\./,
        );
        await dialog.locator(".profile-management > summary").press("Enter");
        await save.click();
        await expect(footer.getByRole("status")).toHaveText(
          /^(已儲存變更|Changes saved)$/,
        );
        await expect(save).toBeDisabled();
        assert.equal(
          app.product.bots.bot(bot.id).description,
          "Unsaved instructions.",
        );
        await role.fill("Second draft.");
        await expect(footer.getByRole("status")).toHaveCount(0);
        await expect(footer.locator(".profile-unsaved")).toBeVisible();
        await role.fill("Unsaved instructions.");
        await expect(save).toBeDisabled();
        await dialog
          .locator(".profile-avatar-disclosure > summary")
          .press("Enter");
        await dialog.locator('.avatar-picker input[value="captain"]').check();
        await expect(save).toBeEnabled();
        assert.notEqual(app.product.bots.bot(bot.id).avatar, "captain");
        await dialog
          .locator(`.avatar-picker input[value="${bot.avatar || "orbit"}"]`)
          .check();
        await expect(save).toBeDisabled();
        await dialog
          .locator(".profile-avatar-disclosure > summary")
          .press("Enter");
        await dialog.locator(".profile-advanced > summary").press("Enter");
        const access = dialog.locator(".bot-access-fields select");
        await access.selectOption("readonly");
        await expect(save).toBeEnabled();
        assert.notEqual(
          app.product.bots.bot(bot.id).permissionMode,
          "readonly",
        );
        await access.selectOption("workspace");
        await expect(save).toBeDisabled();
        await dialog.locator(".profile-advanced > summary").press("Enter");
        await dialog.locator(".model-picker > summary").press("Enter");
        await dialog
          .getByRole("option", { name: "fixture-alt", exact: true })
          .click();
        await expect(dialog.locator(".profile-default-model")).toHaveCount(0);
        await expect(save).toBeEnabled();
        await dialog.locator(".model-picker > summary").press("Enter");
        await dialog
          .getByRole("option", { name: /^(跟隨預設模型|Use default model)$/ })
          .click();
        await expect(save).toBeDisabled();
        await role.fill("Retry draft.");
        const endpoint = `**/api/v2/bots/${bot.id}`;
        await page.route(endpoint, (route) =>
          route.request().method() === "PATCH"
            ? route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({ error: "Fixture save conflict." }),
              })
            : route.continue(),
        );
        await save.click();
        await expect(footer.getByRole("alert")).toHaveText(
          "Fixture save conflict.",
        );
        await expect(role).toHaveValue("Retry draft.");
        await expect(save).toBeEnabled();
        assert.equal(
          app.product.bots.bot(bot.id).description,
          "Unsaved instructions.",
        );
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-failure.png`),
        });
        const failureAudit = await new AxeBuilder({ page })
          .include(".profile-footer")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-failure-axe.json`),
          JSON.stringify(failureAudit, null, 2),
        );
        assert.deepEqual(failureAudit.violations, []);
        assert.deepEqual(failureAudit.incomplete, []);
        await page.unroute(endpoint);
        await role.fill("Recovered instructions.");
        await expect(footer.getByRole("alert")).toHaveCount(0);
        await save.click();
        await expect(save).toBeDisabled();
        await expect(footer.getByRole("status")).toHaveText(
          /^(已儲存變更|Changes saved)$/,
        );
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}.png`),
        });
        const audit = await new AxeBuilder({ page })
          .include(".profile-footer")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-axe.json`),
          JSON.stringify(audit, null, 2),
        );
        assert.deepEqual(audit.violations, []);
        assert.deepEqual(audit.incomplete, []);
        if (locale === "en") {
          await fixtureStyle(page, {
            content: "html { font-size:200% !important; }",
          });
          assert.equal(
            await dialog
              .locator(".model-picker > summary, .profile-disclosure > summary")
              .evaluateAll((nodes) =>
                nodes.every(
                  (node) => parseFloat(getComputedStyle(node).fontSize) >= 28,
                ),
              ),
            true,
            "Desktop model and disclosure text must scale with the root font size",
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await expect(footer.getByRole("status")).toBeInViewport();
          for (const button of await footer.getByRole("button").all()) {
            const hit = await button.evaluate((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.height >= 44 &&
                box.bottom <= innerHeight &&
                el.contains(
                  document.elementFromPoint(
                    box.x + box.width / 2,
                    box.y + box.height / 2,
                  ),
                )
              );
            });
            assert.equal(hit, true);
          }
          await page.screenshot({
            path: join(output, `${width}-${locale}-${theme}-200.png`),
          });
        }
        await footer
          .getByRole("button", { name: /^(取消|Cancel)$/ })
          .press("Escape");
        await expect(page.locator(".header-profile")).toBeFocused();
        await expect(
          page.getByRole("textbox", { name: /^(傳送訊息|Send message)$/ }),
        ).toHaveValue("");
        assert.deepEqual(errors, []);
        reports.push({
          width,
          locale,
          theme,
          audit,
          failureAudit,
          saveAndRevert: true,
          partialManagementPreservesDraft: true,
          errorRecovery: true,
          errors,
        });
        await context.close();
      }
  assert.equal(runnerCalls, 0);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      { passed: true, fixtureOnly: true, reports, runnerCalls },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${reports.length} desktop profiles, clean/dirty/reverted state, management preserves unsaved drafts, default model, failure and retry, footer axe and 200% text, no model calls.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
