import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import {
  verificationBrowser,
  verificationLaunch,
  verificationDirectory,
} from "./verification-browser.ts";

const dir = await mkdtemp(join(tmpdir(), "apsis-chat-ui-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  verificationDirectory("artifacts/chat-verification"),
  desktopOnly ? "desktop" : ".",
);
await mkdir(output, { recursive: true });
let finish: (() => void) | undefined;
let adopt: (() => Promise<void>) | undefined;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    options.emit({
      type: "commentary",
      id: crypto.randomUUID(),
      text: "我正在整理內容。",
    });
    if (options.prompt.includes("hold")) {
      options.registerSteer?.(async (_text, callback) => {
        adopt = callback;
      });
      await new Promise<void>((r) => {
        finish = r;
        options.signal.addEventListener("abort", () => r(), { once: true });
      });
    }
    return {
      text:
        "已完成，結果在這裡。" +
        (options.prompt.includes("hold 請幫我整理")
          ? "\n\n" +
            Array.from(
              { length: 30 },
              (_, index) =>
                `較早的閱讀段落 ${index + 1}，保留閱讀位置以檢查新回覆到達。`,
            ).join("\n\n")
          : ""),
    };
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
const bot = await app.product.bots.create("聊天幫手");
const other = await app.product.bots.create("另一位幫手");
for (const [id, name, enabled] of [
  ["available", "可用連接器", true],
  ["available-two", "第二個可用連接器", true],
  ["disabled", "停用連接器", false],
  ["unassigned", "未分配連接器", true],
] as const)
  app.product.connectors.put({
    id,
    name,
    enabled,
    url: "http://127.0.0.1:1/mcp",
  });
const location = app.product.workLocation(bot);
await mkdir(location.path, { recursive: true });
await writeFile(
  join(location.path, "note.md"),
  "# 聊天中的檔案\n\n仍然可以預覽。",
);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
let browser: Browser | undefined;
let failedPage: Page | undefined;
const errors: string[] = [];
try {
  browser = await verificationLaunch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await page.addInitScript(() => {
    const state = {
      fail: false,
      hold: false,
      writes: [] as string[],
      release: () => {},
    };
    Object.assign(window, { messageCopyFixture: state });
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (value) => {
      state.writes.push(value);
      if (state.fail)
        throw new DOMException("Fixture clipboard denied", "NotAllowedError");
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      await write(value);
    };
  });
  failedPage = page;
  page.on("pageerror", (error) => errors.push(error.message));
  const menu = () => page.locator(".bot-actions-menu > summary");
  const input = () =>
    page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(page.locator(".details")).toHaveCount(0);
  await expect(
    page.locator(".cw-tabs, .cw-project-nav, .bot-task-list"),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "傳送方式" })).toHaveCount(0);
  const emptyDraftHeight = (await input().boundingBox())!.height;
  assert.ok(emptyDraftHeight >= 44 && emptyDraftHeight <= 45);
  const longDraft = Array.from(
    { length: 12 },
    (_, index) => `第 ${index + 1} 行桌面草稿，保留完整內容。`,
  ).join("\n");
  await input().fill(longDraft);
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBe(180);
  await input().press("Control+End");
  assert.ok(
    await input().evaluate(
      (element: HTMLTextAreaElement) =>
        element.scrollHeight > element.clientHeight && element.scrollTop > 0,
    ),
  );
  await expect(input()).toHaveValue(longDraft);
  await page.setViewportSize({ width: 1440, height: 540 });
  await expect.poll(async () => (await input().boundingBox())!.height).toBe(80);
  await expect(input()).toHaveValue(longDraft);
  await input().fill("短桌面第一行\n短桌面第二行\n短桌面第三行\n短桌面第四行");
  await expect(input()).toHaveCSS("overflow-y", "auto");
  await input().press("Control+End");
  assert.ok(
    await input().evaluate(
      (element: HTMLTextAreaElement) => element.scrollTop > 0,
    ),
  );
  await input().fill(longDraft);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBe(180);
  const wrappingDraft = "桌面輸入框依實際可用寬度重新換行。".repeat(11);
  await input().fill(wrappingDraft);
  const wideDraftHeight = (await input().boundingBox())!.height;
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBeGreaterThan(wideDraftHeight);
  await expect(input()).toHaveValue(wrappingDraft);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBe(wideDraftHeight);
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBeGreaterThan(wideDraftHeight);
  await expect(input()).toHaveValue(wrappingDraft);
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBe(wideDraftHeight);
  await input().fill("");
  await expect
    .poll(async () => (await input().boundingBox())!.height)
    .toBe(emptyDraftHeight);
  assert.equal(app.product.db.all("job").length, 0);
  await input().fill("保留草稿");
  const attach = page.getByRole("button", { name: "新增附件", exact: true });
  await expect(attach).toBeVisible();
  const attachBox = (await attach.boundingBox())!;
  assert.ok(attachBox.width >= 44 && attachBox.height >= 44);
  const chooser = page.waitForEvent("filechooser");
  await attach.press("Enter");
  await (await chooser).setFiles(join(location.path, "note.md"));
  await expect(page.locator(".attachment-chips")).toContainText("note.md");
  await expect(input()).toHaveValue("保留草稿");
  assert.equal(app.product.db.all("job").length, 0);
  await page.getByRole("button", { name: "移除 note.md", exact: true }).click();
  await expect(page.locator(".attachment-chips")).toHaveCount(0);
  await page.locator(`.bot-row[title="${other.name}"]`).click();
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(input()).toHaveValue("保留草稿");
  await menu().click();
  const options = page.getByRole("dialog", { name: "聊天選項", exact: true });
  await expect(
    page.getByRole("button", { name: "聊天選項", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".composer-card .model-picker")).toBeVisible();
  await expect(
    page
      .locator(".chat-header")
      .getByRole("button", { name: "工作資料夾", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".composer-card .task-progress, .composer-status"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看過程", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(input()).toHaveValue("保留草稿");
  await input().fill("hold 請幫我整理");
  await input().press("Enter");
  await expect(
    page.getByRole("button", { name: "停止回覆", exact: true }),
  ).toBeVisible();
  await input().fill("加上摘要");
  await input().press("Enter");
  await expect(page.locator(".message-delivery")).toHaveText("已收到");
  await expect.poll(() => !!adopt).toBe(true);
  await adopt!();
  await expect(page.locator(".message-delivery")).toHaveText("已採用");
  assert.equal(app.product.db.all("job").length, 1);
  await page.screenshot({ path: join(output, "desktop-working.png") });
  await page.locator(`.bot-row[title="${other.name}"]`).click();
  finish!();
  await expect
    .poll(
      () =>
        app.product.queries.snapshot().bots.find((item) => item.id === bot.id)!
          .unread,
    )
    .toBe(true);
  await expect(page.locator(`.bot-row[title="${bot.name}"]`)).toHaveClass(
    /has-unread/,
  );
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(
    page.locator(".message.assistant > .message-body > .markdown").last(),
  ).toContainText("已完成");
  await expect
    .poll(
      () =>
        app.product.queries.snapshot().bots.find((item) => item.id === bot.id)!
          .unread,
    )
    .toBe(false);
  const quietRecordReads: string[] = [];
  page.on("request", (request) => {
    if (/\/runs\/[^/?]+$/.test(request.url()))
      quietRecordReads.push(request.url());
  });
  await page.reload();
  await expect(page.locator(".message-delivery")).toHaveText("已採用");
  // A plain reply keeps its audit available on demand without a permanent row.
  const plainReply = page.locator(".message.assistant").last();
  const replyRecord = plainReply.getByRole("button", {
    name: "回覆紀錄",
    exact: true,
  });
  await expect(
    plainReply.locator(".execution-evidence.compact-reply"),
  ).toBeHidden();
  assert.deepEqual(
    quietRecordReads,
    [],
    "Plain reply records stay unloaded until requested",
  );
  await page.mouse.move(0, 0);
  const latestActions = plainReply.locator(".message-actions");
  const notificationStaysWithActions = async () => {
    assert.ok(
      await latestActions.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const notice = element
          .querySelector("[role=status]")!
          .getBoundingClientRect();
        return notice.top >= row.top - 2 && notice.bottom <= row.bottom + 2;
      }),
      "The hidden copy notification stays within its reading row, not at an unscrolled document position",
    );
  };
  await notificationStaysWithActions();
  await expect(latestActions).toHaveCSS("opacity", "1");
  await expect(
    plainReply.getByRole("button", { name: "複製", exact: true }),
  ).toBeVisible();
  const previousActions = page.locator(".message.user .message-actions").last();
  await expect(previousActions).toHaveCSS("opacity", "0");
  const previousCopy = previousActions.getByRole("button", {
    name: "複製",
    exact: true,
  });
  await previousCopy.focus();
  await expect(previousActions).toHaveCSS("opacity", "1");
  await page.getByRole("textbox", { name: "傳送訊息", exact: true }).focus();
  await expect(previousActions).toHaveCSS("opacity", "0");
  const copyButton = latestActions.getByRole("button", { name: /複製/ });
  await copyButton.focus();
  const copyReadingPosition = await page
    .locator(".messages")
    .evaluate((element) => element.scrollTop);
  await page.evaluate(() => {
    Reflect.get(window, "messageCopyFixture").fail = true;
  });
  await copyButton.press("Enter");
  await expect(copyButton).toHaveText("複製失敗");
  await notificationStaysWithActions();
  assert.equal(
    await page.locator(".messages").evaluate((element) => element.scrollTop),
    copyReadingPosition,
    "Copy denial does not change the current reading position",
  );
  await expect(plainReply.locator(".message-actions [role=status]")).toHaveText(
    "無法複製，請重試或選取訊息後手動複製。",
  );
  await page.screenshot({ path: join(output, "message-copy-denied.png") });
  await page.waitForTimeout(2200);
  await expect(copyButton).toHaveText("複製失敗");
  await page.evaluate(() => {
    Object.assign(Reflect.get(window, "messageCopyFixture"), {
      fail: false,
      hold: true,
    });
  });
  await copyButton.press("Enter");
  await expect(copyButton).toHaveText("複製中…");
  await expect(copyButton).toHaveAttribute("aria-busy", "true");
  await notificationStaysWithActions();
  await copyButton.press("Enter");
  assert.equal(
    await page.evaluate(
      () => Reflect.get(window, "messageCopyFixture").writes.length,
    ),
    2,
    "A pending clipboard write is not submitted twice",
  );
  await page.evaluate(() =>
    Reflect.get(window, "messageCopyFixture").release(),
  );
  await expect(copyButton).toHaveText("已複製");
  await expect(copyButton).toHaveAttribute("aria-busy", "false");
  await notificationStaysWithActions();
  assert.equal(
    await page.locator(".messages").evaluate((element) => element.scrollTop),
    copyReadingPosition,
    "Retry completion does not change the current reading position",
  );
  await expect(plainReply.locator(".message-actions [role=status]")).toHaveText(
    "訊息已複製",
  );
  const sourceMessage = app.tasks.store.conversations
    .cachedSessions()
    .find((session) => session.id === bot.sessionId)!
    .messages.at(-1)!;
  assert.equal(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(
      /\r\n/g,
      "\n",
    ),
    sourceMessage.content,
  );
  await expect(copyButton).toHaveText("複製", { timeout: 4000 });
  await replyRecord.focus();
  await replyRecord.press("Enter");
  await expect(replyRecord).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => quietRecordReads.length).toBe(1);
  const replyDisclosure = plainReply.locator(".execution-tools > summary");
  await expect(replyDisclosure).toBeVisible();
  await expect(plainReply.locator(".execution-tools")).toHaveAttribute(
    "open",
    "",
  );
  await replyDisclosure.press("Enter");
  await expect(replyRecord).toHaveAttribute("aria-expanded", "false");
  await expect(replyRecord).toBeFocused();
  await expect(plainReply.locator(".execution-evidence")).toBeHidden();
  const readingArea = page.locator(".messages");
  const preservedDraft = await input().inputValue();
  await page
    .getByRole("button", { name: "切換工作內容", exact: true })
    .press("Tab");
  await expect(readingArea).toBeFocused();
  assert.ok(
    await readingArea.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        parseFloat(style.outlineWidth) >= 2 && style.outlineStyle === "solid"
      );
    }),
    "The desktop reading area has visible keyboard focus",
  );
  await readingArea.press("Control+Home");
  await expect
    .poll(() => readingArea.evaluate((element) => element.scrollTop))
    .toBeLessThan(2);
  await readingArea.press("Control+End");
  await expect
    .poll(() =>
      readingArea.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await expect(readingArea).toBeFocused();
  await expect(input()).toHaveValue(preservedDraft);
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  await page.getByRole("button", { name: "note.md", exact: true }).click();
  await expect(page.locator(".details")).toContainText("聊天中的檔案");
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await menu().click();
  await page.getByRole("button", { name: "開啟新話題", exact: true }).click();
  await expect(page.locator(".topic-divider").last()).toHaveText("新話題");
  await expect(page.locator(".message.user").first()).toContainText("hold");
  await input().fill("新的話題");
  await input().press("Enter");
  await expect(
    page.locator(".message.assistant > .message-body > .markdown"),
  ).toHaveCount(2);
  await page.mouse.move(0, 0);
  await expect(
    page.locator(".message.assistant .message-actions").last(),
  ).toHaveCSS("opacity", "1");
  await expect(
    page.locator(".message.assistant .message-actions").first(),
  ).toHaveCSS("opacity", "0");
  // Earlier topics are a dedicated browsing surface, separate from Bot memory.
  await menu().click();
  await page.getByRole("button", { name: "瀏覽先前話題", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "瀏覽先前話題",
    exact: true,
  });
  await expect(history.locator(".history-browser h3")).toBeVisible();
  await expect(history.locator(".history-browser h3")).toContainText(bot.name);
  await expect(
    history.getByRole("button", { name: "新增記憶", exact: true }),
  ).toHaveCount(0);
  const topics = history.locator(".history-topic-list button");
  await expect(topics).toHaveCount(2);
  await topics.last().press("Enter");
  await expect(history.locator(".history-message").first()).toContainText(
    "hold",
  );
  await page.screenshot({ path: join(output, "topic-history.png") });
  await page.keyboard.press("Escape");
  await menu().click();
  await page.getByRole("button", { name: "記憶與背景", exact: true }).click();
  const memory = page.getByRole("dialog", { name: "記憶與背景", exact: true });
  await expect(
    memory.getByRole("button", { name: "新增記憶", exact: true }),
  ).toBeVisible();
  await expect(memory.locator(".history-browser")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(output, "desktop-chat.png") });
  await page.locator(".messages").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "回到最新訊息", exact: true }),
  ).toBeVisible();
  const unreadReply = {
    id: crypto.randomUUID(),
    role: "assistant" as const,
    content: "A new reply while reading earlier messages.",
    status: "complete" as const,
    createdAt: new Date().toISOString(),
  };
  app.store.conversations.append(bot.sessionId, unreadReply);
  app.product.notify(bot.id);
  await expect(page.locator(`.bot-row[title="${bot.name}"]`)).toHaveClass(
    /has-unread/,
  );
  await expect
    .poll(() => app.product.bots.bot(bot.id).readAt < unreadReply.createdAt)
    .toBe(true);
  await page.screenshot({ path: join(output, "desktop-unread-older.png") });
  await page.locator(`.bot-row[title="${other.name}"]`).click();
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  await expect(
    page.getByRole("button", { name: "回到最新訊息", exact: true }),
  ).toBeVisible();
  await expect(page.locator(`.bot-row[title="${bot.name}"]`)).toHaveClass(
    /has-unread/,
  );
  await expect
    .poll(() => app.product.bots.bot(bot.id).readAt < unreadReply.createdAt)
    .toBe(true);
  await page.getByRole("button", { name: "回到最新訊息", exact: true }).click();
  await expect(page.locator(`.bot-row[title="${bot.name}"]`)).not.toHaveClass(
    /has-unread/,
  );
  await expect
    .poll(() => app.product.bots.bot(bot.id).readAt)
    .toBe(unreadReply.createdAt);
  await app.product.bots.update(bot.id, {
    connectorIds: ["available", "available-two", "disabled"],
  });
  await page
    .locator(".chat-header")
    .getByRole("button", { name: "工作資料夾", exact: true })
    .click();
  const folderDialog = page.getByRole("dialog", {
    name: "工作資料夾",
    exact: true,
  });
  await expect(folderDialog).toBeVisible();
  const coveredReply = {
    ...unreadReply,
    id: crypto.randomUUID(),
    content: "A new reply behind the work folder dialog.",
    createdAt: new Date().toISOString(),
  };
  app.store.conversations.append(bot.sessionId, coveredReply);
  app.product.notify(bot.id);
  await expect
    .poll(
      () =>
        app.product.queries.snapshot().bots.find((item) => item.id === bot.id)!
          .unread,
    )
    .toBe(true);
  await expect(page.locator(".messages .markdown").last()).toContainText(
    coveredReply.content,
  );
  assert.ok(app.product.bots.bot(bot.id).readAt < coveredReply.createdAt);
  await page.keyboard.press("Escape");
  await expect(folderDialog).not.toBeVisible();
  await expect
    .poll(() => app.product.bots.bot(bot.id).readAt)
    .toBe(coveredReply.createdAt);
  await page.reload();
  await input().fill("@");
  const suggestions = page.getByRole("group", {
    name: "輸入建議",
    exact: true,
  });
  const suggestionButtons = suggestions.getByRole("button");
  await expect(suggestionButtons).toHaveText([
    "可用連接器",
    "第二個可用連接器",
  ]);
  const beforeSuggestion = app.product.db.all("job").length;
  await input().press("ArrowDown");
  await expect(suggestionButtons.first()).toBeFocused();
  await suggestionButtons.first().press("ArrowDown");
  await expect(suggestionButtons.last()).toBeFocused();
  await suggestionButtons.last().press("ArrowUp");
  await expect(suggestionButtons.first()).toBeFocused();
  await suggestionButtons.first().press("ArrowUp");
  await expect(input()).toBeFocused();
  await input().press("ArrowDown");
  await suggestionButtons.first().press("End");
  await expect(suggestionButtons.last()).toBeFocused();
  await suggestionButtons.last().press("Home");
  await expect(suggestionButtons.first()).toBeFocused();
  await page.screenshot({ path: join(output, "desktop-suggestions.png") });
  await suggestionButtons.first().press("Enter");
  await expect(input()).toHaveValue(
    "請使用連接器「可用連接器」（ID：available）： ",
  );
  await expect(input()).toBeFocused();
  assert.equal(app.product.db.all("job").length, beforeSuggestion);
  await input().fill("@");
  await input().press("ArrowDown");
  await suggestionButtons.first().press("Escape");
  await expect(input()).toBeFocused();
  await expect(input()).toHaveValue("@");
  await expect(suggestions).toHaveCount(0);
  await input().fill("保留連接器草稿");
  await input().press("End");
  const tools = page.locator(".composer-tools > .composer-popover > summary");
  await tools.press("Enter");
  const toolsPanel = page.locator(
    ".composer-tools > .composer-popover .composer-popover-content",
  );
  await expect(toolsPanel.getByRole("button")).toHaveText([
    "新增附件",
    "可用連接器",
    "第二個可用連接器",
  ]);
  await page.screenshot({ path: join(output, "desktop-connectors-menu.png") });
  const emptyChooser = page.waitForEvent("filechooser");
  await toolsPanel
    .getByRole("button", { name: "新增附件", exact: true })
    .press("Enter");
  await (await emptyChooser).setFiles([]);
  await expect(tools).toBeFocused();
  await expect(input()).toHaveValue("保留連接器草稿");
  await tools.press("Enter");
  await toolsPanel
    .getByRole("button", { name: "可用連接器", exact: true })
    .press("Enter");
  await expect(input()).toBeFocused();
  await expect(input()).toHaveValue(
    "保留連接器草稿請使用連接器「可用連接器」（ID：available）： ",
  );
  await input().fill("");
  await page.screenshot({ path: join(output, "desktop-connectors.png") });
  if (!desktopOnly) {
    await page.setViewportSize({ width: 390, height: 844 });
    // setViewportSize does not wait for the media-query event and React commit.
    await expect(page.locator(".mobile-compose-options")).toBeVisible();
    await expect(input()).not.toHaveAttribute("title");
    await expect(input()).toBeVisible();
    const mobileReplies = page.locator(
      ".message.assistant > .message-body > .markdown",
    );
    const repliesBeforeMobileSend = await mobileReplies.count();
    await input().fill("手機換行");
    await input().press("Enter");
    await expect(input()).toHaveValue("手機換行\n");
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    await expect(mobileReplies).toHaveCount(repliesBeforeMobileSend + 1);
    await expect(mobileReplies.last()).toHaveText("已完成，結果在這裡。");
    await menu().click();
    await page.getByRole("button", { name: "聊天選項", exact: true }).click();
    await expect(options).toBeVisible();
    await page.keyboard.press("Escape");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    await page.screenshot({ path: join(output, "mobile-chat.png") });
    await input().fill("hold 驗證停止按鈕");
    await page.getByRole("button", { name: "傳送", exact: true }).click();
    const stop = page.getByRole("button", { name: "停止回覆", exact: true });
    await expect(stop).toBeVisible();
    await expect(
      page.locator(".composer-card .task-progress, .composer-status"),
    ).toHaveCount(0);
    await input().fill("尚未送出的補充");
    await expect(
      page.getByRole("button", { name: "補充指示", exact: true }),
    ).toBeVisible();
    await input().fill("");
    await expect(stop).toBeVisible();
    await page.screenshot({ path: join(output, "mobile-running-clean.png") });
    await stop.click();
    await expect(stop).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "傳送", exact: true }),
    ).toBeVisible();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        browser: verificationBrowser,
        version: browser.version(),
        userAgent: await page.evaluate(() => navigator.userAgent),
        checks: [
          "single conversation",
          "drafts",
          "message-scoped read receipts, background replies and older-reading restoration",
          "direct attachment chooser and draft preservation",
          "enabled assigned connector choices and suggestions",
          "attachment chooser return focus and connector insertion",
          "unique desktop model and folder controls",
          "steering receipt",
          "reload",
          "files",
          "new topic",
          "no composer progress row",
          "latest desktop reply actions visible without hover; older actions appear with keyboard focus",
          "message copy denial persists, retry announces success, pending writes deduplicate and native clipboard preserves source",
          "hidden copy notification remains in its reading row and copy results preserve scroll position",
          "send position switches between stop and steering",
          ...(!desktopOnly ? ["mobile", "stop cancels running work"] : []),
          "no page errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Chat browser verification passed.");
} catch (error) {
  await failedPage
    ?.screenshot({ path: join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  finish?.();
  await browser?.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
