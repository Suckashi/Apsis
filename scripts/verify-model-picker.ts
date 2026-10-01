import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import {
  verificationLaunch,
  verificationDirectory,
} from "./verification-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const root = await mkdtemp(join(tmpdir(), "apsis-model-picker-"));
const output = resolve(
  verificationDirectory("artifacts/model-picker"),
  "desktop",
);
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(root, "data"),
  workspaceDir: join(root, "work"),
});
const models = Array.from(
  { length: 20 },
  (_, i) => `vendor/fixture-${String(i).padStart(2, "0")}`,
);
const selected = models[14],
  alias = "閱讀與整理";
const connection = await app.connections.save({
  name: "Fixture provider",
  provider: "openai-compatible",
  model: selected,
  models,
  url: "http://127.0.0.1:1/v1",
  modelSettings: { [selected]: { displayName: alias } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: selected,
});
const bot = await app.product.bots.create("模型選單驗證");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await verificationLaunch();
const reports: object[] = [];
try {
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const width of [1440, 1024])
      for (const theme of ["light", "dark"] as const) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [],
            patches: object[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("request", (r) => {
            if (r.method() === "PATCH" && r.url().endsWith(`/bots/${bot.id}`))
              patches.push(r.postDataJSON());
          });
          await page.goto(base);
          await page.locator(`.bot-row[title="${bot.name}"]`).click();
          const picker = page.locator(".composer-card .model-picker");
          const trigger = picker.locator(":scope > summary");
          await expect(trigger).toContainText(alias);
          await expect(trigger).toHaveAttribute(
            "title",
            `Fixture provider · ${alias} · ${selected}`,
          );
          await trigger.press("Enter");
          const search = picker.getByRole("combobox", {
            name: locale === "en" ? "Search models" : "搜尋模型",
            exact: true,
          });
          await expect(search).toBeFocused();
          const current = picker.locator(
            '[role="option"][aria-selected="true"]',
          );
          await expect(current).toHaveAttribute("data-active", "true");
          await expect(search).toHaveAttribute(
            "aria-activedescendant",
            (await current.getAttribute("id")) as string,
          );
          await expect(current).toBeInViewport();
          const panel = await picker
            .locator(".composer-popover-content")
            .boundingBox();
          assert.ok(
            panel && panel.x >= 8 && panel.x + panel.width <= width - 8,
            "model popup stays inside the desktop viewport",
          );
          assert.equal(
            await page
              .locator(".app")
              .evaluate((el) => el.getBoundingClientRect().left),
            0,
            "opening the selected option does not shift the app horizontally",
          );
          assert.ok(
            await picker
              .locator(".model-picker-options")
              .evaluate((el) => el.scrollTop > 0),
          );
          await expect(current.locator(".model-picker-id")).toHaveText(
            selected,
          );
          await search.press("ArrowDown");
          await expect(picker.locator('[data-active="true"]')).toHaveText(
            models[15],
          );
          await search.press("Escape");
          await expect(trigger).toBeFocused();
          assert.deepEqual(patches, []);
          await trigger.press("Enter");
          await expect(search).toBeFocused();
          await search.fill(selected);
          await expect(picker.getByRole("option")).toHaveCount(1);
          await expect(picker.getByRole("option")).toContainText(alias);
          await search.fill("no-matching-model");
          await expect(picker.getByRole("option")).toHaveCount(0);
          await search.press("Enter");
          assert.deepEqual(patches, []);
          await search.fill(selected);
          await search.press("Enter");
          await expect(trigger).toBeFocused();
          await expect.poll(() => patches.length).toBe(1);
          assert.deepEqual(patches[0], {
            connectionId: connection.id,
            model: selected,
          });
          assert.equal(app.product.db.all("job").length, 0);
          const draft = page.getByRole("textbox", {
            name: locale === "en" ? "Send message" : "傳送訊息",
            exact: true,
          });
          await draft.fill("保留模型選單測試草稿");
          await trigger.press("Enter");
          await expect(search).toBeFocused();
          await search.press("Tab");
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "Send" : "傳送",
              exact: true,
            }),
          ).toBeFocused();
          await expect(picker).not.toHaveAttribute("open", "");
          await expect(draft).toHaveValue("保留模型選單測試草稿");
          await trigger.press("Enter");
          await expect(search).toBeFocused();
          await search.fill(selected);
          const audit = await new AxeBuilder({ page })
            .include(".composer-card .model-picker .composer-popover-content")
            .analyze();
          const profile = `${locale}-${theme}-${width}`;
          await writeFile(
            join(output, `${profile}-open-audit.json`),
            JSON.stringify(audit, null, 2),
          );
          await page.screenshot({ path: join(output, `${profile}.png`) });
          assert.deepEqual(audit.violations, []);
          assert.deepEqual(audit.incomplete, []);
          if (locale === "en") {
            await fixtureStyle(page, {
              content: "html{font-size:200% !important}",
            });
            await expect(current.locator(".model-picker-id")).toBeVisible();
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
          }
          await search.press("Escape");
          const closedAudit = await new AxeBuilder({ page })
            .include(".composer-card")
            .analyze();
          await writeFile(
            join(output, `${profile}-closed-audit.json`),
            JSON.stringify(closedAudit, null, 2),
          );
          assert.deepEqual(closedAudit.violations, []);
          assert.deepEqual(closedAudit.incomplete, []);
          assert.deepEqual(errors, []);
          reports.push({
            profile,
            rawIdSearch: true,
            selectedKeyboardStart: true,
            selectedVisible: true,
            patches,
            errors,
            violations: audit.violations,
            incomplete: audit.incomplete,
            closedViolations: closedAudit.violations,
            closedIncomplete: closedAudit.incomplete,
          });
        } finally {
          await context.close();
        }
      }
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ fixtureOnly: true, reports }, null, 2),
  );
  console.log(
    JSON.stringify({ profiles: reports.length, passed: true, output }),
  );
} finally {
  await browser.close();
  await app.product.close();
  await app.close();
}
