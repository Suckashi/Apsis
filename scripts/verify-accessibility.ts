import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { reviewPreviewContrast } from "./preview-contrast.ts";

const baseline = process.env.APSIS_A11Y_BASELINE === "1";
const dir = await mkdtemp(join(tmpdir(), "apsis-a11y-"));
const output = resolve("artifacts/accessibility");
await mkdir(output, { recursive: true });
let release = () => {};
const gate = new Promise<void>((resolve) => {
  release = resolve;
});
let releaseWaiting = () => {};
let reportCommentary = () => {};
const waitingGate = new Promise<void>((resolve) => {
  releaseWaiting = resolve;
});
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    if (options.prompt === "檢查中斷") throw new Error("terminated");
    if (options.prompt === "檢查即時狀態") {
      await waitingGate;
      reportCommentary = () =>
        options.emit({
          type: "commentary",
          id: randomUUID(),
          text: "我正在核對文件內容。",
        });
      options.emit({ type: "progress", text: "正在檢查文件" });
      options.emit({ type: "delta", text: "文件檢查仍在進行。" });
      await gate;
      return { text: "即時狀態檢查完成。" };
    }
    if (options.prompt === "檢查核准") {
      await options.authorize?.(
        "shell",
        { command: "git push origin fixture" },
        options.signal,
      );
      return { text: "核准流程已結束，未執行命令。" };
    }
    const tools = createTools(options);
    const call = (name: string, args: unknown) =>
      tools
        .find((tool) => tool.name === name)!
        .execute(randomUUID(), args, options.signal);
    await call("write_file", {
      path: "report.md",
      content: "# 可閱讀的成果\n\n檔案內容已完成。",
    });
    await call("publish_file", { path: "report.md", name: "成果報告.md" });
    await call("write_file", {
      path: "preview.md",
      content: "# 預覽檢查\n\n使用鍵盤開啟的檔案。",
    });
    return {
      text: "報告已完成。\n\n" + "這份成果保留了實際檔案內容。".repeat(35),
    };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
});
app.product.settings.update(
  {
    permissionRules: [
      { id: "fixture-approval", scope: "global", tool: "shell", effect: "ask" },
    ],
  },
  app.product.settings.read().revision,
);
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.bots.create("閱讀助理");
await app.product.bots.create("另一位夥伴");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const reports: {
  name: string;
  violations: unknown[];
  incomplete: unknown[];
  iconContrast: { control: string; ratio: number }[];
  contrastReview?: Awaited<ReturnType<typeof reviewPreviewContrast>>;
}[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const audit = async (name: string) => {
    const iconContrast = await page
      .locator(
        ".approval-mode-control summary > svg:last-child, .composer-send-actions .send > svg, .file-actions button > svg",
      )
      .evaluateAll((icons) => {
        const parse = (color: string) => {
          const values = color.match(/[\d.]+/g)?.map(Number);
          if (!values || values.length < 3)
            throw new Error(`Unsupported color: ${color}`);
          return [values[0], values[1], values[2], values[3] ?? 1];
        };
        const blend = (front: number[], back: number[]) =>
          front
            .slice(0, 3)
            .map((v, i) => v * front[3] + back[i] * (1 - front[3]));
        const luminance = (rgb: number[]) =>
          rgb
            .map((v) => {
              const channel = v / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        return icons
          .filter(
            (icon) => icon.getClientRects().length && !icon.closest("[inert]"),
          )
          .map((icon) => {
            const ancestors: Element[] = [];
            for (let el: Element | null = icon; el; el = el.parentElement)
              ancestors.unshift(el);
            let background = [255, 255, 255];
            for (const el of ancestors) {
              const style = getComputedStyle(el);
              if (style.backgroundImage !== "none")
                throw new Error("Icon gradient needs manual contrast review");
              background = blend(parse(style.backgroundColor), background);
            }
            const foreground = blend(
              parse(getComputedStyle(icon).color),
              background,
            );
            const a = luminance(foreground),
              b = luminance(background);
            return {
              control:
                icon.parentElement?.getAttribute("aria-label") ||
                icon.parentElement?.textContent?.trim() ||
                "",
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            };
          });
      });
    for (const item of iconContrast)
      assert.ok(
        item.ratio >= 3,
        `${name}: ${item.control} icon contrast ${item.ratio}`,
      );
    const result = await new AxeBuilder({ page })
      .withTags([
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
        "best-practice",
      ])
      .analyze();
    await writeFile(
      join(output, `${name}-raw.json`),
      JSON.stringify(result, null, 2),
    );
    const summarize = (rows: typeof result.violations) =>
      rows.map((row) => ({
        id: row.id,
        impact: row.impact,
        help: row.help,
        helpUrl: row.helpUrl,
        nodes: row.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      }));
    reports.push({
      name,
      violations: summarize(result.violations),
      incomplete: summarize(result.incomplete),
      iconContrast,
      contrastReview:
        !baseline && name.endsWith("-preview")
          ? await reviewPreviewContrast(page, result, name)
          : undefined,
    });
    console.log(
      `${name}: ${result.violations.length} violations, ${result.incomplete.length} manual review items`,
    );
    if (baseline) console.log(JSON.stringify(summarize(result.violations)));
  };
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(
    page.getByRole("heading", { name: `你好，我是 ${bot.name}。` }),
  ).toBeVisible();
  const announcement = page.locator(".reply-announcement");
  await expect(announcement).toHaveText("");
  await expect(
    page.getByRole("heading", { name: `與 ${bot.name} 的對話`, exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(`.bot-row[title="${bot.name}"]`),
  ).toHaveAccessibleName(`${bot.name}，目前對話`);
  await audit("desktop-idle");
  if (!baseline) {
    await page.locator(".skip-link").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#conversation")).toBeFocused();
  }
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  const send = async (prompt: string) => {
    await input.fill(prompt);
    await page.getByRole("button", { name: "傳送", exact: true }).click();
  };
  await send("檢查即時狀態");
  await expect(page.locator(".message.live .execution-waiting")).toContainText(
    "等待模型回應",
  );
  await audit("desktop-waiting");
  await page.screenshot({ path: join(output, "desktop-waiting.png") });
  releaseWaiting();
  await expect(page.locator(".header-profile small")).toContainText(
    "正在產生回覆",
  );
  await expect(page.locator(".message.assistant.live")).toContainText(
    "文件檢查仍在進行。",
  );
  await expect(announcement).toHaveText("");
  await expect(page.locator(".message.live .execution-waiting")).toBeVisible();
  await expect(
    page.locator(".composer-status, .task-progress, .task-elapsed"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "停止回覆", exact: true }),
  ).toBeVisible();
  await audit("desktop-running");
  reportCommentary();
  await expect(page.locator(".message.live .execution-current")).toContainText(
    "我正在核對文件內容。",
  );
  await expect(page.locator(".execution-waiting")).toHaveCount(0);
  release();
  await expect(
    page
      .locator(".message-body")
      .getByText("即時狀態檢查完成。", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".execution-waiting")).toHaveCount(0);
  if (!baseline) {
    await expect(announcement).toContainText("已收到新的回覆");
    await expect(
      page.locator(".message.assistant").last(),
    ).toHaveAccessibleName(`${bot.name} 的回覆`);
    await expect(page.locator(".message.user").last()).toHaveAccessibleName(
      "你的訊息",
    );
  }
  await send("檢查核准");
  const approval = page.getByRole("region", {
    name: "需要你的核准",
    exact: true,
  });
  await expect(approval).toBeVisible();
  await audit("desktop-approval");
  await approval.getByRole("button", { name: "拒絕", exact: true }).click();
  await expect(page.locator(".task-progress")).toHaveCount(0);
  await send("製作報告");
  const delivery = page
    .locator(".message.assistant")
    .filter({ hasText: "報告已完成。" });
  await expect(delivery.locator(".artifact-card")).toBeVisible();
  const botAccessibleName = await page
    .locator(`.bot-row[title="${bot.name}"]`)
    .getAttribute("aria-label");
  if (!baseline) {
    assert.ok(botAccessibleName!.length < 80);
    assert.ok(!botAccessibleName!.includes("這份成果"));
    await expect(announcement).toContainText("已收到新的回覆");
  }
  await audit("desktop-delivery");
  await delivery.locator(".run-files > summary").click();
  await audit("desktop-file-evidence-expanded");
  const preview = delivery.getByRole("button", {
    name: "預覽檔案 preview.md",
    exact: true,
  });
  await preview.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "預覽檢查", exact: true }),
  ).toBeVisible();
  await audit("desktop-preview");
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await send("檢查中斷");
  await expect(
    page
      .locator(".message.failed")
      .last()
      .getByText("模型回應中斷", { exact: true }),
  ).toBeVisible();
  if (!baseline) await expect(announcement).toContainText("這次執行未完成");
  await audit("desktop-interrupted");
  await page.getByRole("button", { name: "設定與工具", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "設定與工具", exact: true }),
  ).toBeVisible();
  await audit("desktop-settings");
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "設定與工具", exact: true }),
  ).toBeFocused();
  if (!baseline) {
    await page.reload();
    await expect(page.locator(".message.failed")).toHaveCount(2);
    await expect(
      page.locator(
        '.message-error[role="status"], .run-outcome [role="status"]',
      ),
    ).toHaveCount(0);
    await expect(page.locator(".reply-announcement")).toHaveText("");
    await page.locator('.bot-row[title="另一位夥伴"]').click();
    await expect(
      page.getByRole("heading", { name: "你好，我是 另一位夥伴。" }),
    ).toBeVisible();
    await expect(page.locator(".reply-announcement")).toHaveText("");
    await page.locator(`.bot-row[title="${bot.name}"]`).click();
    await expect(page.locator(".message.failed")).toHaveCount(2);
    await expect(page.locator(".reply-announcement")).toHaveText("");
  }
  for (const theme of process.argv.includes("--desktop")
    ? []
    : ["dark", "light"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page
      .getByRole("button", { name: "開啟 Bot 名單", exact: true })
      .click();
    await audit(`phone-${theme}-roster`);
    if (!baseline) await expect(page.locator(".skip-link")).toHaveCount(0);
    await page
      .getByRole("button", {
        name: theme === "dark" ? "切換為深色模式" : "切換為淺色模式",
        exact: true,
      })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "開啟 Bot 名單", exact: true }),
    ).toBeFocused();
    if (!baseline) {
      await expect(page.locator(".skip-link")).toHaveCount(1);
      await page.locator(".skip-link").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#conversation")).toBeFocused();
      await expect(page.locator("#conversation")).not.toHaveAttribute(
        "inert",
        "",
      );
    }
    await preview.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "工作內容", exact: true }),
    ).toBeVisible();
    await audit(`phone-${theme}-preview`);
    if (!baseline) await expect(page.locator(".skip-link")).toHaveCount(0);
    await page.screenshot({
      path: join(output, `${baseline ? "before" : "after"}-${theme}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await audit(`phone-${theme}-conversation`);
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(
      output,
      process.argv.includes("--desktop")
        ? "desktop.json"
        : baseline
          ? "before.json"
          : "after.json",
    ),
    JSON.stringify({ reports, errors }, null, 2),
  );
  if (!baseline)
    assert.ok(
      reports.every((report) => report.violations.length === 0),
      JSON.stringify(reports.filter((report) => report.violations.length)),
    );
} finally {
  releaseWaiting();
  release();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
