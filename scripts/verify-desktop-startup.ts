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

const directory = await mkdtemp(join(tmpdir(), "apsis-desktop-startup-"));
const output = resolve("artifacts/desktop-startup");
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => ({ text: "Unused fixture" }),
});
const bot = await app.product.bots.create("Startup fixture");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
try {
  for (const locale of ["zh-Hant", "en"])
    for (const theme of ["light", "dark"])
      for (const mode of [
        "missing-bot",
        "missing-files",
        "missing-providers",
        "empty-files",
      ]) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ locale, theme, id }) => {
            localStorage.setItem("apsis.locale", locale);
            localStorage.setItem("apsis.theme", theme);
            localStorage.setItem("apsis.bot", id);
          },
          { locale, theme, id: bot.id },
        );
        const page = await context.newPage();
        const errors: string[] = [];
        let stateReads = 0;
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/v2/state") stateReads++;
        });
        const file =
          mode === "missing-bot"
            ? "bot.css"
            : mode === "missing-providers"
              ? "providers.css"
              : "files.css";
        await page.route(`**/${file}`, (route) =>
          mode === "empty-files"
            ? route.fulfill({ status: 200, contentType: "text/css", body: "" })
            : route.abort("failed"),
        );
        await page.goto(base);
        const message =
          locale === "en"
            ? "The interface did not load completely"
            : "畫面載入不完整";
        await expect(page.getByRole("status")).toHaveText(message, {
          useInnerText: true,
        });
        await expect(page.locator(".app")).toHaveCount(0);
        assert.equal(
          stateReads,
          0,
          "Do not mount the conversation before required styles are available",
        );
        const reload = page.getByRole("link", {
          name: locale === "en" ? "Reload" : "重新載入",
          exact: true,
        });
        await expect(reload).toBeVisible();
        await reload.focus();
        await expect(reload).toBeFocused();
        assert.equal(
          await reload.evaluate(
            (el) => el.getBoundingClientRect().height >= 44,
          ),
          true,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        const audit = await new AxeBuilder({ page }).analyze();
        await writeFile(
          join(output, `${locale}-${theme}-${mode}-axe.json`),
          JSON.stringify(audit, null, 2),
        );
        assert.deepEqual(audit.violations, []);
        assert.deepEqual(audit.incomplete, []);
        await page.screenshot({
          path: join(output, `${locale}-${theme}-${mode}.png`),
        });
        await page.unroute(`**/${file}`);
        await reload.press("Enter");
        await expect(page.locator(".app")).toBeVisible();
        await expect(page.locator("#apsis-boot")).toHaveCount(0);
        await expect(
          page.getByRole("textbox", { name: /^(傳送訊息|Send message)$/ }),
        ).toBeVisible();
        assert.equal(
          app.product.queries.detail(bot.id).session.messages.length,
          0,
        );
        assert.deepEqual(errors, []);
        reports.push({
          locale,
          theme,
          mode,
          audit,
          recovered: true,
          noModelRequests: true,
          errors,
        });
        await context.close();
      }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/files.css", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(base, { waitUntil: "commit" });
  await expect(page.locator("#apsis-boot")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("正在準備你的對話", {
    useInnerText: true,
  });
  release();
  await expect(page.locator(".app")).toBeVisible();
  await expect(page.locator("#apsis-boot")).toHaveCount(0);
  await context.close();
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        fixtureOnly: true,
        profiles: reports,
        delayedStylesRecoverWithoutFalseFailure: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${reports.length} desktop missing/empty stylesheet profiles, keyboard reload recovery, raw axe, no pre-recovery application requests, plus delayed stylesheet loading.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
