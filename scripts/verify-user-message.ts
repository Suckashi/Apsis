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
import {
  verificationBrowser,
  verificationLaunch,
  verificationDirectory,
} from "./verification-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const output = resolve(verificationDirectory("artifacts/user-message-reading"));
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "apsis-user-message-"));
const prefix = "請整理這份共用讀書清單提案，保留原文與需求。"
  .repeat(10)
  .slice(0, 159);
const source =
  prefix +
  "👨‍👩‍👧‍👦" +
  "e\u0301\n\n" +
  "## 使用流程\n\n" +
  Array.from(
    { length: 12 },
    (_, i) =>
      `第${i + 1}項：` +
      "記錄書名、作者、閱讀狀態與心得，支援編輯與篩選。".repeat(4),
  ).join("\n\n") +
  '\n\n```js\n  const title = "閱讀 <book> & friends";\n  const cafe = "é";\n```\n\n' +
  "## 驗收\n\n最後條件：重新整理保留資料，手機可讀，不加入登入、同步、付費或分享。";
const activeSource = "正在執行的完整需求：\n\n" + source;
const received: { prompt: string; context: string }[] = [];
let finish = () => {},
  emitProgress = (_text: string) => {},
  started = false;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    received.push({
      prompt: options.prompt,
      context: options.executionContext || "",
    });
    if (options.prompt === activeSource) {
      started = true;
      emitProgress = (text) =>
        options.emit({ type: "commentary", id: "live-reading", text });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return { text: "已收到完整需求。最後條件保留，這是隔離測試回覆。" };
  },
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
const bot = await app.product.bots.create("文件夥伴", { avatar: "bean" });
const other = await app.product.bots.create("研究幫手", { avatar: "cloud" });
const multilineSource = Array.from(
  { length: 9 },
  (_, i) => `第${i + 1}行`,
).join("\n");
app.store.conversations.append(other.sessionId, {
  id: "multiline-request",
  role: "user",
  content: multilineSource,
  status: "complete",
  createdAt: new Date().toISOString(),
});
const messageId = "long-request";
for (const [id, role, content] of [
  [messageId, "user", source],
  [
    "reply",
    "assistant",
    "已整理提案。\n\n請先查看成果，再依需要檢視需求與紀錄。",
  ],
  ["short-request", "user", "請保留原文。"],
] as const)
  app.store.conversations.append(bot.sessionId, {
    id,
    role,
    content,
    status: "complete",
    createdAt: new Date().toISOString(),
  });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
let browser: Browser | undefined;
const profiles: object[] = [];
async function hit(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const r = (await control.boundingBox())!,
    port = page.viewportSize()!;
  assert.ok(r.width >= 44 && r.height >= 44, "44px control");
  assert.ok(
    r.x >= -1 &&
      r.y >= -1 &&
      r.x + r.width <= port.width + 1 &&
      r.y + r.height <= port.height + 1,
    "visible control",
  );
  assert.equal(
    await control.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    true,
  );
  return r;
}
async function audit(page: Page, request: Locator) {
  const raw = await new AxeBuilder({ page })
    .include("#message-long-request")
    .analyze();
  assert.deepEqual(raw.violations, []);
  for (const finding of raw.incomplete)
    assert.equal(finding.id, "color-contrast");
  const review = [];
  if (raw.incomplete.length)
    for (const text of await request
      .locator(".markdown p,.markdown h2")
      .all()) {
      await text.scrollIntoViewIfNeeded();
      const check = await text.evaluate((node) => {
        const parse = (color: string) => color.match(/[\d.]+/g)!.map(Number);
        const lum = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = getComputedStyle(node).color;
        let parent: Element | null = node;
        while (
          parent &&
          parse(getComputedStyle(parent).backgroundColor)[3] === 0
        )
          parent = parent.parentElement;
        const background = getComputedStyle(parent!).backgroundColor,
          a = lum(parse(foreground)),
          b = lum(parse(background));
        const r = node.getBoundingClientRect(),
          port = node.closest(".messages")!.getBoundingClientRect();
        const top = Math.max(r.top, port.top),
          bottom = Math.min(r.bottom, port.bottom);
        const points =
          bottom > top + 2
            ? [0.25, 0.5, 0.75].map((y) =>
                node.contains(
                  document.elementFromPoint(
                    r.x + r.width / 2,
                    top + (bottom - top) * y,
                  ),
                ),
              )
            : [];
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
        check.opaque &&
          check.contrast >= 4.5 &&
          check.points > 0 &&
          check.onTop,
      );
      review.push(check);
    }
  return { violations: raw.violations, incomplete: raw.incomplete, review };
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
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.addInitScript(
      ({ id, theme, locale }) => {
        localStorage.setItem("apsis.bot", id);
        localStorage.setItem("apsis.theme", theme);
        localStorage.setItem("apsis.locale", locale);
      },
      { id: bot.id, theme: config.theme, locale: config.locale },
    );
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(base);
    const composer = page.getByRole("textbox", {
      name: /^(傳送訊息|Send message)$/,
    });
    await expect(composer).toBeVisible();
    await composer.fill("保留我的草稿");
    if (config.scale === 2)
      await fixtureStyle(page, {
        content: "html { font-size:200% !important; }",
      });
    const article = page.locator("#message-long-request"),
      request = article.locator(".request-disclosure"),
      summary = request.locator(":scope > summary");
    await expect(request).not.toHaveAttribute("open");
    await expect(article.locator(".request-excerpt")).toHaveText(
      prefix + "👨‍👩‍👧‍👦…",
    );
    await expect(request.locator(".markdown")).toBeHidden();
    await expect(
      page.locator("#message-short-request .request-disclosure"),
    ).toHaveCount(0);
    const collapsedHeight = (await article
      .locator(".message-body")
      .boundingBox())!.height;
    const summaryBox = await hit(page, summary);
    await expect(summary).toHaveAccessibleName(
      config.locale === "en" ? "Read full message" : "展開完整訊息",
    );
    const compactAudit = await audit(page, request);
    const name = `${config.width}-${config.height}-${config.locale}-${config.theme}-${config.scale}x`;
    await page.screenshot({ path: join(output, `compact-${name}.png`) });
    await summary.press("Enter");
    await expect(request).toHaveAttribute("open", "");
    await expect(summary).toBeFocused();
    await expect(request.locator(".markdown")).toContainText(
      "最後條件：重新整理保留資料",
    );
    await expect(request.locator(".markdown h2")).toHaveCount(2);
    await expect(request.locator(".markdown code")).toContainText(
      'const title = "閱讀 <book> & friends";',
    );
    const fullHeight = (await article.locator(".message-body").boundingBox())!
      .height;
    assert.ok(
      fullHeight > collapsedHeight * 2,
      "collapsed request reduces visual height",
    );
    const fullAudit = await audit(page, request);
    const close = request.locator(":scope > .request-collapse");
    const closeBox = await hit(page, close);
    await page.screenshot({ path: join(output, `full-tail-${name}.png`) });
    await close.press("Enter");
    await expect(request).not.toHaveAttribute("open");
    await expect(summary).toBeFocused();
    await hit(page, summary);
    await expect(composer).toHaveValue("保留我的草稿");
    // The main Copy operation always uses the exact original, including collapsed text.
    await page.evaluate(() => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      (window as unknown as { requestCopy: string[] }).requestCopy = [];
      navigator.clipboard.writeText = async (value) => {
        (window as unknown as { requestCopy: string[] }).requestCopy.push(
          value,
        );
        await original(value);
      };
    });
    await article
      .locator(".message-actions")
      .getByRole("button", { name: /^(複製|Copy)$/, exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { requestCopy: string[] }).requestCopy.at(-1),
        ),
      )
      .toBe(source);
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"),
        ),
      )
      .toBe(source.replace(/\r\n/g, "\n"));
    await summary.press("Enter");
    await expect(request).toHaveAttribute("open", "");
    await page.reload();
    await expect(request).toHaveAttribute("open", "");
    await expect(composer).toHaveValue("保留我的草稿");
    await hit(page, close);
    await close.click();
    await expect(request).not.toHaveAttribute("open");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    profiles.push({
      name,
      collapsedHeight,
      fullHeight,
      summaryBox,
      closeBox,
      compactAudit,
      fullAudit,
      errors,
    });
    await context.close();
  }
  app.product.settings.update(
    { locale: "zh-Hant" },
    app.product.settings.read().revision,
  );
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    (id) => localStorage.setItem("apsis.bot", id),
    bot.id,
  );
  const page = await context.newPage();
  const interactionErrors: string[] = [];
  page.on("pageerror", (error) => interactionErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") interactionErrors.push(message.text());
  });
  await page.goto(base);
  const article = page.locator("#message-long-request"),
    request = article.locator(".request-disclosure"),
    summary = request.locator(":scope > summary"),
    composer = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await expect(composer).toBeVisible();
  await composer.fill("引用時保留這份草稿");
  await summary.press("Enter");
  await expect(request).toHaveAttribute("open", "");
  await page.locator(".bot-row").filter({ hasText: other.name }).click();
  await expect(page.locator(".bot-row[aria-current=page]")).toHaveAttribute(
    "title",
    other.name,
  );
  const multiline = page.locator(
    "#message-multiline-request .request-disclosure",
  );
  await expect(multiline).not.toHaveAttribute("open");
  await expect(multiline.locator(".request-excerpt")).toHaveText(
    multilineSource.replace(/\s+/g, " "),
  );
  await multiline.locator(":scope > summary").press("Enter");
  await expect(multiline.locator(".markdown")).toHaveText(multilineSource);
  await page.locator(".bot-row").filter({ hasText: bot.name }).click();
  await expect(
    page.locator(".message.assistant .request-disclosure"),
  ).toHaveCount(0);
  await expect(request).toHaveAttribute("open", "");
  await expect(composer).toHaveValue("引用時保留這份草稿");
  await request.locator(".request-collapse").click();
  await expect(request).not.toHaveAttribute("open");
  await article.getByRole("button", { name: "回覆", exact: true }).click();
  await composer.fill("請引用完整需求，補上日期。");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await expect(page.locator(".quoted-message")).toHaveCount(1);
  await expect.poll(() => received.length).toBe(1);
  assert.ok(
    received[0].context.includes("最後條件：重新整理保留資料"),
    "reply context contains the full collapsed source",
  );
  await page.locator(".quoted-message").press("Enter");
  await expect(request).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  // Actual queued-to-running transition, completion and streaming while reading.
  await composer.fill(activeSource);
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  const active = page
    .locator(".message.user")
    .last()
    .locator(".request-disclosure");
  await expect(active).toHaveAttribute("open", "");
  await summary.scrollIntoViewIfNeeded();
  await summary.focus();
  const readingTop = await page
    .locator(".messages")
    .evaluate((node) => node.scrollTop);
  emitProgress("新增真實公開進度，保留正在閱讀的需求。");
  await expect(page.locator(".message.assistant.live")).toContainText(
    "新增真實公開進度",
  );
  await expect
    .poll(() => page.locator(".messages").evaluate((node) => node.scrollTop))
    .toBe(readingTop);
  finish();
  await expect(page.locator(".message.assistant.live")).toHaveCount(0);
  await expect(active).toHaveAttribute("open", "");
  assert.equal(received[1].prompt, activeSource);
  assert.deepEqual(interactionErrors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        browser: verificationBrowser,
        version: browser.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        profiles,
        quoteFullSource: true,
        quoteExpandsAndFocuses: true,
        botSwitch: true,
        multilineWithoutFalseEllipsis: true,
        activeStartsOpen: true,
        completionKeepsOpen: true,
        streamPreservesReading: true,
        interactionErrors,
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
  const page = browser
    ?.contexts()
    .flatMap((c) => c.pages())
    .at(-1);
  if (page)
    await page
      .screenshot({ path: join(output, "verification-failed.png") })
      .catch(() => {});
  throw error;
} finally {
  finish();
  await browser?.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
