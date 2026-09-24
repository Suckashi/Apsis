import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
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
const website = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<html><title>Research fixture</title><body><h1>研究資料</h1><p>Verified source: 42.</p><button id="action" onclick="this.textContent=\'Completed\'">Submit</button></body></html>',
  );
});
website.listen(0, "127.0.0.1");
await once(website, "listening");
const websiteUrl = `http://127.0.0.1:${(website.address() as AddressInfo).port}`;
let delegateWorkerId = "";
const app = await createApp({
  productMode: true,
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  env: {},
  runner: async (options) => {
    const tools = createTools(options);
    const call = async (name: string, args: unknown) =>
      tools.find((t) => t.name === name)!.execute(name, args, options.signal);
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
        command:
          process.platform === "win32"
            ? "Write-Output 'delegation'"
            : "printf delegation",
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
      command:
        process.platform === "win32"
          ? "Write-Output 'verified'"
          : "printf verified",
      timeout: 5,
    });
    options.emit({ type: "delta", text: "報告已完成，驗證命令成功。" });
    return {
      text: "報告已完成，驗證命令成功。\n\n來源：研究資料（本機測試資料）。",
    };
  },
});
const model = await app.tasks.connections!.save({
  name: "測試模型",
  provider: "openai-compatible",
  model: "fixture-model",
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
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
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
  assert.equal(app.product!.snapshot().bots[0].avatar, "cloud");
  await page.getByRole("button", { name: /新 Bot 隨時可以交辦/ }).click();
  await page.getByLabel("名稱", { exact: true }).fill("研究助理");
  await page.getByRole("radio", { name: "橘色星星" }).check();
  await page
    .getByLabel("角色與工作方式")
    .fill("整理可靠的來源，製作清楚的研究報告。");
  await page.getByRole("button", { name: "儲存變更" }).click();
  await page.getByText("已儲存變更", { exact: true }).waitFor();
  assert.equal(app.product!.snapshot().bots[0].avatar, "spark");
  await page.getByRole("button", { name: "返回詳情" }).click();
  await page
    .getByRole("textbox", { name: "傳送訊息" })
    .fill("研究資料並建立報告，最後執行驗證。");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.getByText("需要你的核准", { exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "desktop-approval.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("請保留來源。");
  await page.getByRole("button", { name: "補充指示" }).click();
  await page.getByRole("button", { name: "核准並繼續" }).click();
  await page
    .getByText("報告已完成，驗證命令成功。", { exact: false })
    .first()
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".working-label"));
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
  await page.screenshot({
    path: join(output, "desktop-completed.png"),
    fullPage: true,
  });
  await page.reload();
  await page.locator('.header-profile [data-avatar="spark"]').waitFor();
  await page
    .getByText("報告已完成，驗證命令成功。", { exact: false })
    .first()
    .waitFor();
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
  const bot = app.product!.bot(app.product!.snapshot().bots[0].id);
  delegateWorkerId = (await app.product!.create("協作助理")).id;
  await page
    .getByRole("textbox", { name: "傳送訊息" })
    .fill("coordinate-browser");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await page.getByRole("button", { name: "前往核准" }).click();
  await page.getByText("需要你的核准", { exact: true }).waitFor();
  await page.getByRole("button", { name: "核准並繼續", exact: true }).click();
  await page
    .locator(".message.assistant")
    .getByText("協作結果：42", { exact: true })
    .waitFor();
  await page
    .getByRole("region", { name: "Bot 協作" })
    .getByRole("button", { name: "開啟 Bot 對話" })
    .click();
  await page
    .locator(".message.assistant")
    .getByText("秘書彙整：協作結果：42", { exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "mobile-delegation.png"),
    fullPage: true,
  });
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
