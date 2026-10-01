import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";
import type { Memory } from "../shared/types.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-folder-reading-"));
const output = resolve("artifacts/folder-reading/desktop");
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => ({
    text: `Folder fixture complete: ${options.prompt}`,
  }),
});
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
const bot = await app.product.bots.create("Folder fixture");
const projects = [];
for (const name of ["a", "b"]) {
  const path = join(
    directory,
    name,
    "Long source folder ".repeat(5),
    "Project",
  );
  await mkdir(path, { recursive: true });
  projects.push(
    await app.tasks.projects.add({ name: "Same project name", path }),
  );
}
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: object[] = [];
async function reviewClippedFields(
  page: import("playwright").Page,
  audit: Awaited<ReturnType<AxeBuilder["analyze"]>>,
  name: string,
  settings = false,
) {
  // Keep the initial result before scrolling; a clipped scan is not a pass.
  await writeFile(
    join(output, `${name}-axe.json`),
    JSON.stringify(audit, null, 2),
  );
  const root = settings ? ".project-settings-body" : ".folder-dialog";
  const scroll = await page.locator(root).evaluate((el) => el.scrollTop);
  const reviews: object[] = [];
  const overlapReasons = new Set(["bgOverlap", "elmPartiallyObscuring"]);
  const allowed = new Set(
    settings
      ? [
          ".project-settings-location > p",
          ".project-memory-footer > small",
          ".cw-muted",
        ]
      : [
          ".folder-advanced > summary",
          ".folder-current > p",
          ".folder-dialog > p",
          'input[value="fixture-branch"]',
          "label:nth-child(4)",
          "select",
        ],
  );
  const unexpected = audit.incomplete.some(
    (item) =>
      item.id !== "color-contrast" ||
      item.nodes.some(
        (node) =>
          node.target.length !== 1 ||
          !allowed.has(node.target[0] as string) ||
          !node.any.some((check) => overlapReasons.has(check.data?.messageKey)),
      ),
  );
  if (unexpected) {
    await page.screenshot({ path: join(output, `${name}-unexpected.png`) });
    const state = await page.evaluate(() => ({
      stylesheets: Array.from(document.styleSheets, (sheet) => ({
        href: sheet.href,
        disabled: sheet.disabled,
        rules: sheet.cssRules.length,
      })),
      dialog: Array.from(document.querySelectorAll("dialog"), (el) => ({
        open: el.open,
        modal: el.matches(":modal"),
      })),
      fields: Array.from(
        document.querySelectorAll(
          ".folder-dialog, .folder-current, .folder-current p",
        ),
        (el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            className: el.className,
            fontSize: style.fontSize,
            background: style.backgroundColor,
            color: style.color,
            rect: rect.toJSON(),
          };
        },
      ),
    }));
    await writeFile(
      join(output, `${name}-unexpected-state.json`),
      JSON.stringify(state, null, 2),
    );
  }
  for (const item of audit.incomplete) {
    assert.equal(item.id, "color-contrast");
    for (const node of item.nodes) {
      assert.equal(node.target.length, 1);
      const target = node.target[0];
      assert.equal(typeof target, "string");
      assert.ok(
        allowed.has(target as string),
        `Unexpected clipped field: ${target}`,
      );
      assert.ok(
        node.any.some((check) => overlapReasons.has(check.data?.messageKey)),
      );
      const field = page.locator(target as string);
      assert.equal(
        await field.evaluate((el, selector) => !!el.closest(selector), root),
        true,
      );
      await field.scrollIntoViewIfNeeded();
      const visible = await new AxeBuilder({ page })
        .include(target as string)
        .analyze();
      const painted = await field.evaluate((el) => {
        const control =
          el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
        let textElement = el;
        let rect: DOMRect;
        if (control) rect = el.getBoundingClientRect();
        else {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let text = walker.nextNode();
          while (text && !text.textContent?.trim()) text = walker.nextNode();
          if (!text) throw new Error("No text to review");
          textElement = text.parentElement!;
          const range = document.createRange();
          range.selectNodeContents(text);
          rect = Array.from(range.getClientRects()).find(
            (r) => r.width > 2 && r.height > 2,
          )!;
        }
        const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const foreground = getComputedStyle(textElement).color;
        let backgroundElement: Element | null = textElement;
        while (
          backgroundElement &&
          (parse(getComputedStyle(backgroundElement).backgroundColor)[3] ??
            1) === 0
        )
          backgroundElement = backgroundElement.parentElement;
        if (!backgroundElement) throw new Error("No opaque background");
        const background = getComputedStyle(backgroundElement).backgroundColor;
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const hits = [0.25, 0.5, 0.75].map((x) => {
          const px = rect.left + rect.width * x,
            py = rect.top + rect.height / 2;
          return (
            px >= 0 &&
            px < innerWidth &&
            py >= 0 &&
            py < innerHeight &&
            el.contains(document.elementFromPoint(px, py))
          );
        });
        return {
          foreground,
          background,
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          hits,
        };
      });
      reviews.push({
        target,
        violations: visible.violations,
        incomplete: visible.incomplete,
        painted,
      });
      await writeFile(
        join(output, `${name}-scroll-review.json`),
        JSON.stringify(reviews, null, 2),
      );
      assert.deepEqual(visible.violations, []);
      assert.ok(
        visible.incomplete.every(
          (item) =>
            item.id === "color-contrast" &&
            item.nodes.every((node) =>
              node.any.some((check) =>
                overlapReasons.has(check.data?.messageKey),
              ),
            ),
        ),
      );
      assert.equal(painted.opaque, true);
      assert.ok(
        painted.contrast >= 4.5,
        `${name}: ${target} contrast ${painted.contrast}`,
      );
      assert.deepEqual(painted.hits, [true, true, true]);
    }
  }
  await page.locator(root).evaluate((el, previous) => {
    el.scrollTop = previous;
  }, scroll);
  return reviews;
}
try {
  for (const width of [1440, 1024])
    for (const locale of ["zh-Hant", "en"] as const)
      for (const theme of ["light", "dark"]) {
        app.product.messages.newContext(bot.id);
        app.product.settings.update(
          { locale },
          app.product.settings.read().revision,
        );
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          ({ locale, theme }) => {
            localStorage.setItem("apsis.locale", locale);
            localStorage.setItem("apsis.theme", theme);
          },
          { locale, theme },
        );
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const filesResponse = page.waitForResponse((response) =>
          response.url().endsWith("/files.css"),
        );
        await page.goto(url);
        const cssResponse = await filesResponse;
        const cssText = await cssResponse.text();
        assert.equal(cssResponse.status(), 200);
        assert.ok(
          cssText === (await readFile(resolve("public/files.css"), "utf8")),
          "Files stylesheet response differs from source",
        );
        await page.locator(`button.bot-row[title="${bot.name}"]`).click();
        const draft = page.getByRole("textbox", {
          name: /傳送訊息|Send message/,
        });
        await draft.fill("Keep this draft.");
        const trigger = page.getByRole("button", {
          name: /^(工作資料夾|Working folder)$/,
        });
        await trigger.click();
        const dialog = page.getByRole("dialog", {
          name: /^(工作資料夾|Working folder)$/,
        });
        const advanced = dialog.locator(".folder-advanced");
        await expect(advanced).not.toHaveAttribute("open", "");
        await expect(dialog.getByRole("checkbox")).not.toBeVisible();
        for (const project of projects)
          await expect(
            dialog
              .locator(".folder-choice-copy small")
              .getByText(project.path, { exact: true }),
          ).toBeVisible();
        await expect(
          dialog
            .locator(".folder-choice-copy strong")
            .getByText("Same project name", { exact: true }),
        ).toHaveCount(2);
        await expect(dialog.locator(".folder-choice-copy small")).toHaveCount(
          3,
        );
        const stylesheetState = await page.evaluate(() => ({
          sheets: Array.from(document.styleSheets, (sheet) => ({
            href: sheet.href,
            disabled: sheet.disabled,
            rules: sheet.cssRules.length,
          })),
          folderDisplay: getComputedStyle(
            document.querySelector(".folder-dialog")!,
          ).display,
          folderBackground: getComputedStyle(
            document.querySelector(".folder-dialog")!,
          ).backgroundColor,
        }));
        await writeFile(
          join(output, `${width}-${locale}-${theme}-before-axe-styles.json`),
          JSON.stringify(stylesheetState, null, 2),
        );
        assert.equal(stylesheetState.folderDisplay, "flex");
        assert.notEqual(stylesheetState.folderBackground, "rgba(0, 0, 0, 0)");
        const audit = await new AxeBuilder({ page })
          .include(".folder-dialog")
          .analyze();
        assert.deepEqual(audit.violations, []);
        const auditReview = await reviewClippedFields(
          page,
          audit,
          `${width}-${locale}-${theme}-choices`,
        );
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}.png`),
        });
        await advanced.locator("summary").press("Enter");
        await dialog.getByRole("checkbox").check();
        const branch = dialog.getByLabel(/起始分支|Starting branch/);
        await branch.fill("fixture-branch");
        const advancedAudit = await new AxeBuilder({ page })
          .include(".folder-dialog")
          .analyze();
        assert.deepEqual(advancedAudit.violations, []);
        const advancedReview = await reviewClippedFields(
          page,
          advancedAudit,
          `${width}-${locale}-${theme}-advanced`,
        );
        await advanced.locator("summary").press("Enter");
        await advanced.locator("summary").press("Enter");
        await expect(branch).toHaveValue("fixture-branch");
        await dialog.getByRole("checkbox").uncheck();
        await advanced.locator("summary").press("Enter");
        await dialog
          .getByRole("button", { name: /^(關閉|Close)$/ })
          .press("Escape");
        await expect(dialog).not.toBeVisible();
        await expect(trigger).toBeFocused();
        await expect(draft).toHaveValue("Keep this draft.");
        await trigger.click();
        const path = dialog.getByLabel(
          /主機資料夾完整路徑|Absolute folder path on the host/,
        );
        await path.fill(join(directory, "missing-folder"));
        await dialog
          .getByRole("button", { name: /使用此資料夾|Use this folder/ })
          .click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await expect(path).toHaveValue(join(directory, "missing-folder"));
        await path.fill(projects[0].path);
        await dialog
          .getByRole("button", { name: /使用此資料夾|Use this folder/ })
          .click();
        await expect(dialog).not.toBeVisible();
        await expect(draft).toHaveValue("Keep this draft.");
        assert.equal(
          app.product.queries.detail(bot.id).session.context?.location?.path,
          projects[0].path,
        );
        await trigger.click();
        await expect(dialog.locator(".folder-current p")).toHaveText(
          projects[0].path,
        );
        const manualLocation = app.product.queries.detail(bot.id).session
          .context!;
        assert.equal(manualLocation.location?.kind, "folder");
        assert.equal(
          manualLocation.location?.memoryKey,
          `task:${manualLocation.id}`,
        );
        assert.equal(
          app.tasks.projects.get(projects[0].id).name,
          "Same project name",
        );
        const registeredChoice = dialog
          .locator(".folder-choices button")
          .filter({ hasText: projects[0].path });
        await expect(registeredChoice).toHaveCount(1, { timeout: 1500 });
        await expect(registeredChoice.locator("strong")).toHaveText(
          "Same project name",
        );
        await page.screenshot({
          path: join(
            output,
            `${width}-${locale}-${theme}-registered-choice.png`,
          ),
        });
        await registeredChoice.click();
        await expect(dialog).not.toBeVisible();
        const explicitLocation = app.product.queries.detail(bot.id).session
          .context!.location!;
        assert.equal(explicitLocation.kind, "project");
        assert.equal(explicitLocation.memoryKey, `project:${projects[0].id}`);
        await expect(draft).toHaveValue("Keep this draft.");
        await trigger.click();
        if (locale === "en")
          await fixtureStyle(page, {
            content: "html { font-size:200% !important; }",
          });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-selected.png`),
        });
        await dialog.getByRole("button", { name: /^(關閉|Close)$/ }).click();
        const submission = `Check selected folder ${width}-${locale}-${theme}.`;
        await draft.fill(submission);
        await page.getByRole("button", { name: /^(傳送|Send)$/ }).click();
        await page
          .locator(".message.assistant")
          .getByText(`Folder fixture complete: ${submission}`, { exact: true })
          .waitFor();
        await trigger.click();
        await expect(dialog.locator(".folder-current p")).toHaveText(
          projects[0].path,
        );
        await expect(dialog.locator("form")).toHaveCount(0);
        await expect(dialog.locator(".folder-advanced")).toHaveCount(0);
        const lockedAudit = await new AxeBuilder({ page })
          .include(".folder-dialog")
          .analyze();
        assert.deepEqual(lockedAudit.violations, []);
        const lockedReview = await reviewClippedFields(
          page,
          lockedAudit,
          `${width}-${locale}-${theme}-locked`,
        );
        await dialog.getByRole("button", { name: /^(關閉|Close)$/ }).click();
        const botMenu = page.locator(".bot-actions-menu > summary");
        await botMenu.press("Enter");
        await expect(
          page.getByRole("button", { name: /^(聊天選項|Chat options)$/ }),
        ).toHaveCount(0);
        const projectSettings = page.getByRole("button", {
          name: /^(專案設定|Project settings)$/,
        });
        await expect(projectSettings).toBeVisible();
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-project-menu.png`),
        });
        await projectSettings.click();
        const settingsDialog = page.getByRole("dialog", {
          name: /^(專案設定|Project settings)$/,
        });
        if (locale === "en")
          await fixtureStyle(page, {
            content: "html { font-size:100% !important; }",
          });
        await expect(
          settingsDialog.locator(".project-settings-name"),
        ).toContainText("Same project name");
        await expect(
          settingsDialog.locator(".project-settings-location p"),
        ).toHaveText(projects[0].path);
        const addMemory = settingsDialog.getByRole("button", {
          name: /^(新增專案記憶|Add project memory)$/,
        });
        await expect(addMemory).toBeEnabled();
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-settings.png`),
        });
        const settingsAudit = await new AxeBuilder({ page })
          .include(".project-settings-modal")
          .analyze();
        await writeFile(
          join(output, `${width}-${locale}-${theme}-settings-axe.json`),
          JSON.stringify(settingsAudit, null, 2),
        );
        assert.deepEqual(settingsAudit.violations, []);
        const settingsReview = await reviewClippedFields(
          page,
          settingsAudit,
          `${width}-${locale}-${theme}-settings`,
          true,
        );
        await page.screenshot({
          path: join(output, `${width}-${locale}-${theme}-settings.png`),
        });
        const background = settingsDialog.getByRole("textbox", {
          name: /^(專案說明|Project background)$/,
        });
        const description = `Project background ${width}-${locale}-${theme}.`;
        await background.fill(description);
        await settingsDialog
          .getByRole("button", { name: /^(儲存說明|Save background)$/ })
          .click();
        await expect(settingsDialog.getByRole("status")).toHaveText(
          /專案說明已儲存。|Project background saved\./,
        );
        assert.equal(
          app.tasks.projects.get(projects[0].id).description,
          description,
        );
        const existingMemory = settingsDialog.locator(".memory");
        const editingExisting = (await existingMemory.count()) > 0;
        if (await existingMemory.count())
          await existingMemory
            .getByRole("button", { name: /^(編輯|Edit)$/ })
            .press("Enter");
        else await addMemory.press("Enter");
        const memoryInput = settingsDialog.getByRole("textbox", {
          name: /^(記憶內容|Memory content)$/,
        });
        await expect(memoryInput).toBeFocused();
        await memoryInput.fill("Unsaved memory draft.");
        await settingsDialog
          .getByRole("button", { name: /^(取消|Cancel)$/ })
          .click();
        if (await existingMemory.count()) {
          await expect(
            existingMemory.getByRole("button", { name: /^(編輯|Edit)$/ }),
          ).toBeFocused();
          await existingMemory
            .getByRole("button", { name: /^(編輯|Edit)$/ })
            .press("Enter");
        } else {
          await expect(addMemory).toBeFocused();
          await addMemory.press("Enter");
        }
        const content = `Explicit project knowledge ${width}-${locale}-${theme}.`;
        await memoryInput.fill(content);
        await settingsDialog
          .getByRole("button", { name: /^(儲存記憶|Save memory)$/ })
          .click();
        await expect(settingsDialog.getByRole("status")).toHaveText(
          /專案記憶已儲存。|Project memory saved\./,
        );
        await expect(existingMemory).toHaveCount(1);
        await expect(existingMemory.locator("p")).toHaveText(content);
        await expect(
          editingExisting
            ? existingMemory.getByRole("button", { name: /^(編輯|Edit)$/ })
            : addMemory,
        ).toBeFocused();
        const persisted: Memory[] = await fetch(
          `${url}/api/v2/projects/${projects[0].id}/memories`,
        ).then((response) => response.json());
        assert.equal(persisted[0].scopeKey, `project:${projects[0].id}`);
        assert.equal(persisted[0].content, content);
        assert.deepEqual(
          await fetch(`${url}/api/v2/projects/${projects[1].id}/memories`).then(
            (response) => response.json(),
          ),
          [],
        );
        if (width === 1440 && locale === "zh-Hant" && theme === "light") {
          await settingsDialog
            .getByRole("button", { name: "關閉專案設定", exact: true })
            .click();
          let attempts = 0;
          let releaseLoad!: () => void;
          const gate = new Promise<void>((resolve) => {
            releaseLoad = resolve;
          });
          const endpoint = `**/api/v2/projects/${projects[0].id}/memories`;
          await page.route(endpoint, async (route) => {
            if (route.request().method() !== "GET") return route.continue();
            attempts += 1;
            if (attempts === 1)
              return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "Fixture memory load failed." }),
              });
            if (attempts === 2) await gate;
            await route.continue();
          });
          await botMenu.press("Enter");
          await projectSettings.click();
          await expect(settingsDialog.getByRole("alert")).toContainText(
            "Fixture memory load failed.",
          );
          await expect(
            settingsDialog.locator(".project-memory-empty"),
          ).toHaveCount(0);
          await expect(addMemory).toBeDisabled();
          await page.screenshot({
            path: join(output, "settings-load-failure.png"),
          });
          await settingsDialog
            .getByRole("button", { name: "重新載入記憶", exact: true })
            .click();
          await expect(settingsDialog.getByRole("status")).toHaveText(
            "載入中…",
          );
          await expect(
            settingsDialog.locator(".project-memory-empty"),
          ).toHaveCount(0);
          releaseLoad();
          await expect(addMemory).toBeEnabled();
          await expect(existingMemory.locator("p")).toHaveText(content);
          await page.unroute(endpoint);
        }
        if (locale === "en") {
          await fixtureStyle(page, {
            content: "html { font-size:200% !important; }",
          });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
          await page.screenshot({
            path: join(output, `${width}-${locale}-${theme}-settings-200.png`),
          });
          const edit = existingMemory.getByRole("button", {
            name: "Edit",
            exact: true,
          });
          await edit.scrollIntoViewIfNeeded();
          await expect(
            settingsDialog.getByRole("heading", {
              name: "Project settings",
              exact: true,
            }),
          ).toBeVisible();
          const hit = await edit.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return (
              rect.height >= 44 &&
              rect.top >= 0 &&
              rect.bottom <= innerHeight &&
              el.contains(
                document.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                ),
              )
            );
          });
          assert.equal(hit, true);
          await edit.press("Enter");
          await expect(memoryInput).toBeFocused();
          await settingsDialog
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await expect(edit).toBeFocused();
          await page.screenshot({
            path: join(
              output,
              `${width}-${locale}-${theme}-settings-200-knowledge.png`,
            ),
          });
        }
        await settingsDialog
          .getByRole("button", {
            name: /^(關閉專案設定|Close project settings)$/,
          })
          .press("Escape");
        await expect(settingsDialog).not.toBeVisible();
        await expect(botMenu).toBeFocused();
        assert.deepEqual(errors, []);
        reports.push({
          width,
          locale,
          theme,
          audit,
          advancedAudit,
          lockedAudit,
          auditReview,
          advancedReview,
          lockedReview,
          registeredProjectIdentityPreserved: true,
          manualFolderRetainsTaskMemory: true,
          explicitProjectSelectionChangesMemoryScope: true,
          desktopProjectSettingsAccessible: true,
          settingsAudit,
          settingsReview,
          projectSettingsSaveAndMemoryScope: true,
          errors,
        });
        await context.close();
      }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ passed: true, fixtureOnly: true, reports }, null, 2),
  );
  console.log(
    `PASS: ${reports.length} desktop folder profiles, registered project identity and explicit memory scope, same-name paths, collapsed Git options, keyboard/Escape, draft and option preservation, real invalid path and retry, selection and locked folder, English 200% text, raw axe plus visible field reviews, and no page errors.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
