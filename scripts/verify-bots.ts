import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";

// Integration fixture: real UI, storage, tools, browser, approvals and files.
// The model response is deterministic; this does not certify an external LLM.
const output = resolve("artifacts/bot-verification");
await mkdir(output, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), "apsis-browser-"));
const website = createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: [{ id: "fixture-alpha" }, { id: "fixture-beta" }],
      }),
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<html><title>Research fixture</title><body><h1>研究資料</h1><p>Verified source: 42.</p><button id="action" onclick="this.textContent=\'Completed\'">Submit</button></body></html>',
  );
});
website.listen(0, "127.0.0.1");
await once(website, "listening");
const websiteUrl = `http://127.0.0.1:${(website.address() as AddressInfo).port}`;
let delegateWorkerId = "";
let finishProgress: (() => void) | undefined;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    const tools = createTools(options);
    const call = async (name: string, args: unknown) =>
      tools
        .find((t) => t.name === name)!
        .execute(randomUUID(), args, options.signal);
    if (options.prompt === "progress-worker") {
      await call("list_files", { path: "" });
      return { text: "協作完成" };
    }
    if (options.prompt === "feedback-hold") {
      await new Promise<void>((resolve) => {
        if (options.signal.aborted) resolve();
        else
          options.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      return { text: "已停止" };
    }
    if (options.prompt === "progress-many") {
      for (let i = 0; i < 12; i++) await call("list_files", { path: "" });
      for (let i = 0; i < 2; i++)
        await call("delegate_task", {
          botId: delegateWorkerId,
          prompt: "progress-worker",
        });
      options.emit({ type: "progress", text: "正在整理兩次協作的結果" });
      await new Promise<void>((resolve) => {
        finishProgress = resolve;
        options.signal.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      return { text: "多項操作與協作已完成。" };
    }
    if (options.prompt === "coordinate-browser") {
      const result = await call("delegate_task", {
        botId: delegateWorkerId,
        prompt: "delegated-browser",
      });
      assert.match(JSON.stringify(result), /協作結果：42/);
      return { text: "秘書彙整：協作結果：42" };
    }
    if (options.prompt === "delegated-browser") {
      await call("shell", {
        command: "printf delegation",
        timeout: 5,
      });
      return { text: "協作結果：42" };
    }
    options.registerSteer?.(async (text) => {
      assert.ok(text);
    });
    options.emit({ type: "delta", text: "我會先讀取資料，再建立報告。\n\n" });
    await call("browser", {
      action: "navigate",
      url: websiteUrl,
      selector: "",
      text: "",
    });
    await call("write_file", {
      path: "report.md",
      content: "# 研究報告\n\n經本機資料來源確認：42。",
    });
    await call("publish_file", { path: "report.md", name: "研究報告.md" });
    await call("shell", {
      command: "printf verified",
      timeout: 5,
    });
    options.emit({ type: "delta", text: "報告已完成，驗證命令成功。" });
    return {
      text: "報告已完成，驗證命令成功。\n\n來源：研究資料（本機測試資料）。",
    };
  },
});
app.product.settings.update(
  {
    permissionRules: [
      { id: "fixture-shell", scope: "global", tool: "shell", effect: "ask" },
    ],
  },
  0,
);
const model = await app.tasks.connections!.save({
  name: "測試模型",
  provider: "openai-compatible",
  model: "fixture-model",
  modelSettings: { "fixture-model": { contextWindowTokens: 128000 } },
  url: "http://127.0.0.1:1/v1",
});
await app.tasks.connections!.setDefault({
  connectionId: model.id,
  model: model.model,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
let simulatingOffline = false;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    !(
      simulatingOffline &&
      /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(m.text())
    )
  )
    errors.push(m.text());
});
page.on("response", (response) => {
  if (response.status() >= 400)
    console.error(`Browser HTTP ${response.status()}: ${response.url()}`);
});
try {
  await page.goto(url);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "建立第一個 Bot" }).click();
  await page.getByLabel("名稱", { exact: true }).fill("新 Bot");
  await page.getByRole("radio", { name: "藍色雲朵" }).check();
  await page.screenshot({
    path: join(output, "mobile-create-bot.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "建立 Bot", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("heading", { name: "你好，我是 新 Bot。" }).waitFor();
  // Layout preferences, focus restoration and narrow-screen drawer isolation.
  const details = page.locator("#bot-details");
  const roster = page.locator("#bot-roster");
  const composerInput = page.getByRole("textbox", { name: "傳送訊息" });
  assert.equal(await roster.isVisible(), true);
  assert.equal(await details.count(), 0, "details closed by default");
  assert.equal(
    await roster.getByRole("button", { name: "新增 Bot" }).evaluate((el) => {
      const { width, height } = el.getBoundingClientRect();
      return width >= 44 && height >= 44;
    }),
    true,
    "new Bot action must remain a touch-sized header control",
  );
  const rosterSearch = roster.getByRole("textbox", { name: "搜尋 Bot" });
  await rosterSearch.fill("不符合的對話");
  assert.equal(await roster.locator(".bot-row").count(), 0);
  await rosterSearch.fill("新 Bot");
  assert.equal(await roster.locator(".bot-row").count(), 1);
  await rosterSearch.fill("");
  await page.screenshot({
    path: join(output, "desktop-chat-roster.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  const artifactsToggle = details.getByRole("button", { name: /^檔案與成果/ });
  assert.equal(await artifactsToggle.getAttribute("aria-expanded"), "true");
  assert.equal(
    await details
      .getByRole("button", { name: /^電腦/ })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    await details
      .getByRole("button", { name: /^排程/ })
      .getAttribute("aria-expanded"),
    "false",
  );
  await artifactsToggle.click();
  assert.equal(
    await details.getByText("附件與成果會顯示在這裡。").isVisible(),
    false,
  );
  await artifactsToggle.press("Enter");
  assert.equal(
    await details.getByText("附件與成果會顯示在這裡。").isVisible(),
    true,
  );
  await page.getByRole("button", { name: "進入專注模式" }).click();
  assert.equal(await roster.isVisible(), false);
  assert.equal(await details.count(), 0);
  await page.getByRole("button", { name: "離開專注模式" }).click();
  assert.equal(await roster.isVisible(), true);
  await details.waitFor();
  await page
    .getByRole("button", { name: "收起 Bot 名單", exact: true })
    .click();
  await page.reload();
  await composerInput.waitFor();
  await details.waitFor();
  assert.equal(
    await roster.isVisible(),
    false,
    "desktop roster choice persists",
  );
  const desktopPreference = await page.evaluate(() =>
    localStorage.getItem("apsis.layout.v1"),
  );
  for (const width of [375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await details.waitFor({ state: "detached" });
    if (width === 375) {
      await page.getByRole("button", { name: "開啟 Bot 名單" }).click();
      await page.screenshot({
        path: join(output, "mobile-chat-roster.png"),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "切換詳情面板" }).click();
    await page.getByRole("dialog", { name: "Bot 詳情" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("apsis.layout.v1")),
      desktopPreference,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await details.waitFor();
  assert.equal(await roster.isVisible(), false);
  await page.getByRole("button", { name: "進入專注模式" }).click();
  await page.getByRole("button", { name: "離開專注模式" }).click();
  assert.equal(
    await roster.isVisible(),
    false,
    "focus restores collapsed roster too",
  );
  await details.waitFor();
  await page.getByRole("button", { name: "開啟 Bot 名單" }).click();
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  const shortHeight = (await composerInput.boundingBox())!.height;
  await composerInput.fill(
    Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行`).join("\n"),
  );
  const tallHeight = (await composerInput.boundingBox())!.height;
  assert.ok(
    tallHeight > shortHeight && tallHeight <= 180,
    "composer grows within its limit",
  );
  assert.equal(
    await composerInput.evaluate(
      (el: HTMLTextAreaElement) => el.scrollHeight > el.clientHeight,
    ),
    true,
  );
  // Composer tools preserve the draft and insert at the saved cursor.
  const toolsMenu = page.locator(".composer-tools > .composer-popover");
  await composerInput.fill("前文 後文");
  await composerInput.press("Home");
  await composerInput.press("ArrowRight");
  await composerInput.press("ArrowRight");
  await composerInput.press("ArrowRight");
  await toolsMenu.locator("summary").click();
  assert.equal(await composerInput.inputValue(), "前文 後文");
  const skillButton = toolsMenu
    .locator("section")
    .first()
    .getByRole("button")
    .first();
  const skillName = await skillButton.innerText();
  await skillButton.click();
  const insertedDraft = await composerInput.inputValue();
  assert.ok(insertedDraft.startsWith("前文 請依照技能「" + skillName));
  assert.ok(insertedDraft.endsWith(" 後文"));
  assert.equal(await toolsMenu.getAttribute("open"), null);
  await composerInput.fill("草稿：");
  await toolsMenu.locator("summary").click();
  await toolsMenu
    .locator("section")
    .first()
    .getByRole("button")
    .first()
    .click();
  assert.ok((await composerInput.inputValue()).startsWith("草稿：請依照技能"));
  await composerInput.fill("保留前文 /");
  await page.locator(".suggestions button").first().click();
  assert.ok(
    (await composerInput.inputValue()).startsWith("保留前文 請依照技能"),
  );
  await toolsMenu.locator("summary").click();
  await toolsMenu.locator("summary").press("Escape");
  assert.equal(await toolsMenu.getAttribute("open"), null);
  assert.equal(
    await toolsMenu
      .locator("summary")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page
    .locator(".approval-mode-control > .composer-popover > summary")
    .click();
  await page.getByText("所有 Bot · 下次操作生效", { exact: true }).waitFor();
  await page
    .locator(".approval-mode-control > .composer-popover > summary")
    .press("Escape");
  await page.screenshot({
    path: join(output, "integrated-composer.png"),
    fullPage: true,
  });
  await composerInput.fill("中文輸入");
  await composerInput.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    bubbles: true,
  });
  assert.equal(
    await composerInput.inputValue(),
    "中文輸入",
    "IME Enter must not submit",
  );
  await composerInput.press("Shift+Enter");
  assert.equal(await composerInput.inputValue(), "中文輸入\n");
  await composerInput.fill("");
  assert.equal((await composerInput.boundingBox())!.height, shortHeight);
  await page.locator('input[type="file"]').setInputFiles({
    name: "ui-check.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("UI attachment verification"),
  });
  await page.getByRole("button", { name: "移除 ui-check.txt" }).click();
  assert.equal(await page.locator(".attachment-chips").count(), 0);
  assert.equal(app.product!.snapshot().bots[0].avatar, "cloud");
  await page.getByRole("button", { name: /新 Bot 隨時可以交辦/ }).click();
  await page.getByLabel("名稱", { exact: true }).fill("研究助理");
  await page.getByRole("radio", { name: "橘色星星" }).check();
  await page
    .getByLabel("角色與工作方式")
    .fill("整理可靠的來源，製作清楚的研究報告。");
  await page.getByRole("button", { name: "儲存變更" }).click();
  await page.getByText("已儲存變更", { exact: true }).waitFor();
  const saveButton = (await page
    .getByRole("button", { name: "儲存變更" })
    .boundingBox())!;
  const templateButton = (await page
    .getByRole("button", { name: "儲存為範本" })
    .boundingBox())!;
  assert.ok(
    templateButton.y - (saveButton.y + saveButton.height) >= 8,
    "profile save and template actions must have a visible touch gap",
  );
  await page.screenshot({
    path: join(output, "desktop-profile-actions.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  await page.getByRole("dialog", { name: "Bot 詳情" }).waitFor();
  const mobileSaveButton = (await page
    .getByRole("button", { name: "儲存變更" })
    .boundingBox())!;
  const mobileTemplateButton = (await page
    .getByRole("button", { name: "儲存為範本" })
    .boundingBox())!;
  assert.ok(
    mobileTemplateButton.y - (mobileSaveButton.y + mobileSaveButton.height) >=
      8,
    "mobile profile actions must have a visible touch gap",
  );
  await page
    .getByRole("button", { name: "儲存為範本" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "mobile-profile-actions.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(app.product!.snapshot().bots[0].avatar, "spark");
  await page.getByRole("button", { name: "返回詳情" }).click();
  await page
    .getByRole("textbox", { name: "傳送訊息" })
    .fill("研究資料並建立報告，最後執行驗證。");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.getByText("需要你的核准", { exact: true }).waitFor();
  await page
    .getByRole("region", { name: "目前任務進度" })
    .getByText("等待你的核准", { exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "desktop-approval.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("請保留來源。");
  await page.getByRole("combobox", { name: "傳送方式" }).selectOption("steer");
  await page.getByRole("button", { name: "補充指示" }).click();
  await page.getByRole("combobox", { name: "傳送方式" }).selectOption("queue");
  await page.getByRole("button", { name: "核准並繼續" }).click();
  await page
    .getByText("報告已完成，驗證命令成功。", { exact: false })
    .first()
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".task-progress"));
  assert.equal(
    app
      .product!.detail(app.product!.snapshot().bots[0].id)
      .runs[0].operations.find((o) => o.name === "shell")?.status,
    "succeeded",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("link", { name: /研究報告.md/ })
      .first()
      .click(),
  ]);
  assert.equal(download.suggestedFilename(), "研究報告.md");
  await download.saveAs(join(output, "report.md"));
  assert.equal(
    await details
      .getByRole("button", { name: /^電腦/ })
      .getAttribute("aria-expanded"),
    "true",
  );
  await page.screenshot({
    path: join(output, "desktop-details.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "關閉詳情", exact: true }).click();
  await page.screenshot({
    path: join(output, "desktop-completed.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "進入專注模式" }).click();
  await page.screenshot({
    path: join(output, "desktop-focus.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "離開專注模式" }).click();
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  await page.reload();
  await page.locator('.header-profile [data-avatar="spark"]').waitFor();
  await page
    .getByText("報告已完成，驗證命令成功。", { exact: false })
    .first()
    .waitFor();
  await details.getByRole("button", { name: /^排程/ }).click();
  await page.getByRole("button", { name: "新增排程", exact: true }).click();
  await page.getByLabel("名稱", { exact: true }).fill("每日日報");
  await page.getByLabel("交辦內容").fill("整理當天的研究資料");
  await page.getByRole("button", { name: "儲存排程" }).click();
  await page.getByRole("button", { name: /每日日報/ }).waitFor();
  // New UI contracts: both themes, readable token pairs and real modal focus.
  const checkContrast = async () => {
    const pairs = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const luminance = (name: string) => {
        const color = style.getPropertyValue(name).trim();
        const channels = color
          .match(/[a-f0-9]{2}/gi)!
          .map((c) => parseInt(c, 16) / 255)
          .map((c) =>
            c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
          );
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      return [
        ["--text", "--bg"],
        ["--muted", "--sidebar"],
        ["--muted", "--panel"],
        ["--muted", "--selected"],
        ["--accent", "--selected"],
        ["--on-accent", "--accent"],
        ["--mode-manual", "--mode-manual-bg"],
        ["--mode-yolo", "--mode-yolo-bg"],
        ["--mode-auto", "--mode-auto-bg"],
        ["--mode-manual", "--surface"],
        ["--mode-yolo", "--surface"],
        ["--mode-auto", "--surface"],
      ].map(([fg, bg]) => {
        const a = luminance(fg),
          b = luminance(bg);
        return {
          fg,
          bg,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    for (const pair of pairs)
      assert.ok(pair.ratio >= 4.5, `${pair.fg}/${pair.bg}: ${pair.ratio}`);
  };
  await checkContrast();
  await page.getByRole("button", { name: "切換為深色模式" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await checkContrast();
  await page.screenshot({
    path: join(output, "desktop-dark.png"),
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "設定與工具" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "設定與工具" });
  await settingsDialog.waitFor();
  await settingsDialog
    .getByRole("button", { name: "編輯", exact: true })
    .click();
  await settingsDialog.getByLabel("名稱", { exact: true }).fill("研究模型");
  await settingsDialog
    .getByRole("button", { name: "儲存供應商", exact: true })
    .click();
  await settingsDialog.getByText("供應商已儲存。", { exact: true }).waitFor();
  await settingsDialog.getByText("研究模型", { exact: true }).waitFor();
  const originalDefault = await settingsDialog
    .getByLabel("系統預設模型", { exact: true })
    .inputValue();
  await settingsDialog
    .getByRole("button", { name: "新增供應商", exact: true })
    .click();
  await settingsDialog.getByRole("button", { name: /自訂供應商/ }).click();
  await settingsDialog.getByLabel("名稱", { exact: true }).fill("模型目錄驗證");
  await settingsDialog
    .getByLabel("API 網址", { exact: true })
    .fill(`${websiteUrl}/v1`);
  await settingsDialog
    .getByRole("button", { name: "取得可用模型", exact: true })
    .click();
  await settingsDialog
    .getByRole("checkbox", { name: "fixture-alpha", exact: true })
    .check();
  await settingsDialog
    .getByRole("searchbox", { name: "搜尋模型" })
    .fill("beta");
  assert.equal(await settingsDialog.getByRole("checkbox").count(), 1);
  await settingsDialog
    .getByRole("checkbox", { name: "fixture-beta", exact: true })
    .check();
  await settingsDialog.getByRole("searchbox", { name: "搜尋模型" }).fill("");
  await page.screenshot({
    path: join(output, "desktop-provider-editor.png"),
    fullPage: true,
  });
  await settingsDialog
    .getByRole("button", { name: "儲存供應商", exact: true })
    .click();
  await settingsDialog.getByText("供應商已儲存。", { exact: true }).waitFor();
  assert.equal(
    await settingsDialog
      .getByLabel("系統預設模型", { exact: true })
      .inputValue(),
    originalDefault,
  );
  const providerCard = settingsDialog
    .locator(".provider-card")
    .filter({ hasText: "模型目錄驗證" });
  await providerCard.getByRole("button", { name: "編輯", exact: true }).click();
  await settingsDialog
    .getByRole("checkbox", { name: "fixture-beta", exact: true })
    .uncheck();
  // Deselecting a stored model must not make its row vanish or prevent undo.
  await settingsDialog
    .getByRole("checkbox", { name: "fixture-beta", exact: true })
    .check();
  await settingsDialog
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.screenshot({
    path: join(output, "desktop-settings-dark.png"),
    fullPage: true,
  });
  for (const category of [
    "連接器",
    "技能",
    "Telegram",
    "自動核准",
    "模型連線",
  ]) {
    await settingsDialog
      .getByRole("button", { name: category, exact: true })
      .click();
    assert.equal(
      await settingsDialog
        .getByRole("button", { name: category, exact: true })
        .getAttribute("aria-current"),
      "true",
    );
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(
      () => !!document.activeElement?.closest("dialog[open]"),
    ),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "設定與工具" })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.getByRole("textbox", { name: "傳送訊息" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
    const composer = await page.locator(".composer").boundingBox();
    assert.ok(
      composer && composer.y + composer.height <= 900,
      `composer hidden at ${width}`,
    );
  }
  await page.getByRole("button", { name: "切換為淺色模式" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("textbox", { name: "傳送訊息" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(output, "mobile-chat.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "開啟 Bot 名單" }).click();
  await page.getByRole("button", { name: "設定與工具" }).click();
  await page.screenshot({
    path: join(output, "mobile-settings.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "開啟 Bot 名單" }).click();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
    true,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "切換詳情面板" }).click();
  await page.getByRole("dialog", { name: "Bot 詳情" }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "傳送訊息" })
    .waitFor({ state: "visible" });
  await page.setViewportSize({ width: 740, height: 375 });
  await page.reload();
  await page.getByRole("textbox", { name: "傳送訊息" }).waitFor();
  const landscapeComposer = await page.locator(".composer").boundingBox();
  assert.ok(
    landscapeComposer && landscapeComposer.y + landscapeComposer.height <= 375,
  );
  await page.setViewportSize({ width: 375, height: 844 });
  await page.reload();
  await page.getByRole("textbox", { name: "傳送訊息" }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(output, "mobile-large-text.png"),
    fullPage: true,
  });
  await page
    .locator("style")
    .last()
    .evaluate((el) => el.remove());
  await page.getByRole("button", { name: "開啟 Bot 名單" }).click();
  await page.getByRole("button", { name: "切換為深色模式" }).click();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: join(output, "mobile-dark.png"),
    animations: "disabled",
    fullPage: true,
  });
  const touchContext = await browser.newContext({
    viewport: { width: 375, height: 844 },
    hasTouch: true,
    storageState: await page.context().storageState(),
  });
  try {
    const touchPage = await touchContext.newPage();
    await touchPage.goto(url);
    await touchPage.getByRole("textbox", { name: "傳送訊息" }).waitFor();
    const checkTouchTargets = async () => {
      const undersized = await touchPage.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .filter((el) => el.getClientRects().length && !el.closest("[inert]"))
          .flatMap((el) => {
            const { width, height } = el.getBoundingClientRect();
            return width < 44 || height < 44
              ? [{ label: el.ariaLabel || el.textContent, width, height }]
              : [];
          }),
      );
      assert.deepEqual(
        undersized,
        [],
        "visible touch targets must be at least 44px",
      );
    };
    await checkTouchTargets();
    await touchPage.getByRole("button", { name: "開啟 Bot 名單" }).click();
    await checkTouchTargets();
    await touchPage.getByRole("button", { name: "設定與工具" }).click();
    await checkTouchTargets();
    await touchPage.keyboard.press("Escape");
    await touchPage.getByRole("button", { name: "切換詳情面板" }).click();
    await checkTouchTargets();
  } finally {
    await touchContext.close();
  }
  const bot = app.product!.bot(app.product!.snapshot().bots[0].id);
  delegateWorkerId = (await app.product!.create("協作助理")).id;
  await page.getByRole("button", { name: "回覆", exact: true }).first().click();
  await page.locator(".reply-chip").waitFor();
  await page
    .getByRole("textbox", { name: "傳送訊息" })
    .fill("coordinate-browser");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.locator(".quoted-message").waitFor();
  await page.getByRole("button", { name: "前往核准" }).click();
  await page.getByText("需要你的核准", { exact: true }).waitFor();
  await page.getByRole("button", { name: "核准並繼續", exact: true }).click();
  await page
    .locator(".message.assistant")
    .getByText("協作結果：42", { exact: true })
    .waitFor();
  await page.locator(".task-history .task-summary").last().click();
  await page.locator(".task-row > summary").filter({ hasText: "來自" }).click();
  await page.getByRole("button", { name: "開啟 Bot 對話" }).click();
  await page
    .locator(".message.assistant")
    .getByText("秘書彙整：協作結果：42", { exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "mobile-delegation.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let releaseSend!: () => void;
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  const messageRoute = `**/api/v2/bots/${bot.id}/messages`;
  await page.route(messageRoute, async (route) => {
    await sendGate;
    await route.continue();
  });
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("progress-many");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.getByText("正在送出訊息…", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "傳送", exact: true }).isDisabled(),
    true,
  );
  releaseSend();
  const progress = page.getByRole("region", { name: "目前任務進度" });
  await progress.getByText("正在整理兩次協作的結果", { exact: true }).waitFor();
  await page.unroute(messageRoute);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(
    await progress
      .locator(".activity-orbit")
      .evaluate((el) => getComputedStyle(el).animationName),
    "activity-turn",
  );
  // A quiet model must not be presented as disconnected or falsely finished.
  await page.clock.install();
  await page.clock.fastForward(35000);
  await progress.getByText(/暫未收到新進度/).waitFor();
  assert.equal(
    await progress.locator(".task-progress-hint.is-quiet").count(),
    1,
  );
  await page.screenshot({
    path: join(output, "desktop-progress-quiet.png"),
    fullPage: true,
  });
  await page.clock.setFixedTime(new Date());
  assert.match(await progress.innerText(), /1 位 Bot 協作 · 1 位已完成/);
  const liveHistory = page.locator(".message.live .task-history");
  assert.equal(
    await liveHistory.locator(".task-summary").getAttribute("aria-expanded"),
    "false",
  );
  await progress.getByRole("button", { name: "查看過程" }).click();
  await liveHistory.locator(".task-row").nth(9).waitFor();
  assert.equal(await liveHistory.locator(".task-row").count(), 10);
  await liveHistory.getByRole("button", { name: /顯示更早紀錄/ }).click();
  assert.equal(await liveHistory.locator(".task-row").count(), 16);
  await page.screenshot({
    path: join(output, "desktop-progress-expanded.png"),
    fullPage: true,
  });
  // Status changes must not pull a reader away from earlier content.
  await page.locator(".messages").evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  const previousScroll = await page
    .locator(".messages")
    .evaluate((el) => el.scrollTop);
  app.product!.notify(bot.id);
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator(".messages").evaluate((el) => el.scrollTop),
    previousScroll,
  );
  await page.getByRole("button", { name: "回到最新訊息" }).click();
  assert.equal(
    await page.getByRole("button", { name: "回到最新訊息" }).count(),
    0,
  );
  await page.setViewportSize({ width: 375, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await progress
      .locator(".activity-orbit")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  for (const button of await progress.getByRole("button").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.height >= 44 && box.width >= 44);
  }
  await page.screenshot({
    path: join(output, "mobile-progress.png"),
    fullPage: true,
  });
  finishProgress!();
  await page
    .locator(".message.assistant")
    .getByText("多項操作與協作已完成。", { exact: true })
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".task-progress"));
  await page
    .locator(".run-outcome")
    .getByText(/已完成/)
    .waitFor();
  const finishedHistory = page
    .locator(".message.assistant")
    .filter({ hasText: "多項操作與協作已完成。" })
    .locator(".task-history");
  assert.equal(
    await finishedHistory
      .locator(".task-summary")
      .getAttribute("aria-expanded"),
    "true",
  );
  await finishedHistory.locator(".task-summary").click();
  assert.ok((await finishedHistory.boundingBox())!.height <= 90);
  assert.equal(await page.locator(".delegation-card").count(), 0);
  await page.reload();
  await page
    .locator(".message.assistant")
    .getByText("多項操作與協作已完成。", { exact: true })
    .waitFor();
  assert.equal(
    await finishedHistory
      .locator(".task-summary")
      .getAttribute("aria-expanded"),
    "false",
  );
  await finishedHistory.locator(".task-summary").focus();
  await page.keyboard.press("Enter");
  await finishedHistory.locator(".task-row").first().waitFor();
  await finishedHistory.locator(".task-summary").click();
  await page.screenshot({
    path: join(output, "mobile-compact-history.png"),
    fullPage: true,
  });
  // A broken live connection must remain visible even when no task is active.
  simulatingOffline = true;
  await page.context().setOffline(true);
  await page
    .locator(".connection-banner")
    .getByText(/即時連線中斷/)
    .waitFor();
  assert.equal(await page.locator(".run-outcome").count(), 1);
  await page.screenshot({
    path: join(output, "mobile-reconnecting.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await page.locator(".connection-banner").waitFor({ state: "detached" });
  simulatingOffline = false;
  // Pending, queued, stopping and cancelled states form one complete UI flow.
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("feedback-hold");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await progress.getByText("等待模型回應", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("progress-worker");
  await page
    .getByRole("button", { name: "排入下一個任務", exact: true })
    .click();
  await page
    .locator(".queue-feedback")
    .getByText(/1 個任務排隊中/)
    .waitFor();
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  const stopRoute = `**/api/v2/bots/${bot.id}/stop`;
  await page.route(stopRoute, async (route) => {
    await stopGate;
    await route.continue();
  });
  await page.getByRole("button", { name: "停止任務", exact: true }).click();
  await page
    .getByText("正在停止任務，等待執行中的操作結束…", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "停止任務", exact: true })
      .isDisabled(),
    true,
  );
  releaseStop();
  await page
    .locator(".run-outcome")
    .getByText(/已取消/)
    .waitFor();
  await page.locator(".queue-feedback").waitFor({ state: "detached" });
  await page.unroute(stopRoute);
  await app.product!.remove(delegateWorkerId);
  const pdf = await app.product!.createDocument(bot, "fixture", {
    format: "pdf",
    name: "PDF report",
    content: "Research result: 42",
  });
  assert.match(
    String(await app.product!.readDocument(pdf.path)),
    /Research result: 42/,
  );
  const image = await app.product!.browser.screenshot(bot.id);
  assert.ok(image?.length);
  await writeFile(join(output, "bot-browser.jpg"), image!);
  const screenshotPath = "test-image.jpg";
  await writeFile(await app.workspace.resolve(screenshotPath, true), image!);
  const imageResult = await app
    .product!.tools(bot, "fixture")
    .find((t) => t.name === "read_image")!
    .execute("image", { path: screenshotPath });
  assert.equal(imageResult.content[0].type, "image");
  await page.locator(".header-profile").click();
  await page.getByRole("button", { name: "刪除 Bot", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(app.product!.bot(bot.id).id, bot.id);
  await page.getByRole("button", { name: "刪除 Bot", exact: true }).click();
  await page.screenshot({
    path: join(output, "mobile-delete-bot.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "確認刪除", exact: true }).click();
  await page.getByRole("button", { name: "建立第一個 Bot" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "建立第一個 Bot" }).waitFor();
  assert.equal(app.product!.snapshot().bots.length, 0);
  assert.equal(app.product!.browser.pages.has(bot.id), false);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "desktop create/profile/chat",
          "real browser navigation",
          "approval before shell",
          "steering",
          "artifact download",
          "reload persistence",
          "desktop sidebar preferences and focus-mode restoration",
          "responsive drawers never overwrite desktop preferences",
          "detail section disclosure and connected computer expansion",
          "auto-growing composer, IME Enter and Shift+Enter",
          "attachment upload/removal, quoted reply and model settings save",
          "provider catalog, model discovery/search/multiselect, deselection undo and unchanged system default",
          "44px touch controls on chat, roster, settings and details",
          "routine creation",
          "mobile layout/settings",
          "light/dark contrast >= 4.5:1",
          "375/768/1024/1440px and landscape",
          "dialog/drawer keyboard focus and Escape",
          "200% text and reduced-motion layout",
          "PDF round-trip",
          "image tool",
          "delete confirmation, cancellation and reload persistence",
          "Bot delegation, approval navigation and secretary summary",
          "live progress, per-run compact history, 10-item disclosure, keyboard and retained expansion",
          "no browser console errors",
        ],
        artifacts: output,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await app.product!.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
  website.close();
}
