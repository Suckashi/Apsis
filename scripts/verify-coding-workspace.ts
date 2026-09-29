import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { git } from "../server/git-workspaces.ts";
const dir = await mkdtemp(join(tmpdir(), "apsis-coding-ui-")),
  repo = join(dir, "repo"),
  out = resolve("artifacts/coding-workspace");
await mkdir(repo);
await mkdir(out, { recursive: true });
await git(repo, "init");
await git(repo, "config", "core.autocrlf", "false");
await git(repo, "config", "user.name", "Fixture");
await git(repo, "config", "user.email", "test@example.invalid");
await writeFile(join(repo, "login.ts"), "export const login = false;\n");
await writeFile(join(repo, "README.md"), "# Working project\n");
await git(repo, "add", ".");
await git(repo, "commit", "-m", "Initial project");
let releaseFirstWork!: () => void;
const firstWorkGate = new Promise<void>((resolve) => {
  releaseFirstWork = resolve;
});
let firstWorkHeld = false;
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  worktreeRoot: join(dir, "isolated-worktrees"),
  runner: async (o) => {
    if (o.executionContext?.includes("PLAN MODE"))
      return {
        text:
          "# 實作計畫\n\n" +
          Array.from(
            { length: 24 },
            (_, index) => `${index + 1}. 檢查登入邏輯，修復並驗證。`,
          ).join("\n\n"),
      };
    if (!firstWorkHeld) {
      firstWorkHeld = true;
      await firstWorkGate;
    }
    await o.workspace.write("login.ts", "export const login = true;\n");
    return { text: "已修復登入邏輯。" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://localhost:1/v1",
  modelSettings: { fixture: { contextWindowTokens: 128000 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const project = await app.tasks.projects.add({
  name: "Example Repo",
  path: repo,
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors: string[] = [];
const runRequests: string[] = [];
const missingTaskRequests: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => {
  if (/\/bots\/[^/]+\/runs\//.test(request.url()))
    runRequests.push(request.url());
  if (request.url().includes("/coding-tasks/missing-task"))
    missingTaskRequests.push(request.url());
});
try {
  await page.goto(
    `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
  );
  await page.getByRole("textbox", { name: "傳送訊息", exact: true }).waitFor();
  assert.equal(
    app.product.snapshot().bots.length,
    1,
    "fresh install has one default Bot",
  );
  await page
    .locator(".cw-project-nav")
    .getByRole("button", { name: /Example Repo/ })
    .click();
  assert.equal(await page.locator("#bot-details").count(), 0);
  await page.getByRole("button", { name: "專案設定", exact: true }).click();
  const projectDialog = page.getByRole("dialog", {
    name: "專案設定",
    exact: true,
  });
  await projectDialog.getByLabel("專案說明").fill("登入功能測試專案");
  await projectDialog.getByRole("button", { name: "儲存說明" }).click();
  await projectDialog.getByRole("status").waitFor();
  await projectDialog.getByRole("button", { name: "新增專案記憶" }).click();
  await projectDialog.getByLabel("記憶內容").fill("開 PR 前先執行測試");
  await projectDialog.getByRole("button", { name: "儲存記憶" }).click();
  await projectDialog
    .locator(".memory")
    .getByText("開 PR 前先執行測試", { exact: true })
    .waitFor();
  const memory = app.tasks.store.state.memories.find(
    (m) => m.content === "開 PR 前先執行測試",
  )!;
  assert.equal(memory.scopeKey, "project:" + project.id);
  await projectDialog
    .locator(".memory")
    .getByRole("button", { name: "編輯" })
    .click();
  await projectDialog.getByLabel("啟用", { exact: true }).uncheck();
  await projectDialog.getByRole("button", { name: "儲存記憶" }).click();
  await projectDialog.getByText("v2 · 已停用", { exact: true }).waitFor();
  await projectDialog.getByRole("button", { name: "關閉專案設定" }).click();
  await page.getByRole("button", { name: "專案設定", exact: true }).click();
  assert.equal(
    await projectDialog.getByLabel("專案說明").inputValue(),
    "登入功能測試專案",
  );
  await projectDialog.getByText("v2 · 已停用", { exact: true }).waitFor();
  await projectDialog.getByRole("button", { name: "關閉專案設定" }).click();
  await page
    .locator(".cw-project-page")
    .getByRole("button", { name: "← Bot 對話", exact: true })
    .click();
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  await page.getByLabel("工作位置").selectOption(project.id);
  await page
    .getByLabel("起始分支")
    .locator("option")
    .first()
    .waitFor({ state: "attached" });
  await page.getByRole("button", { name: "關閉工作選項", exact: true }).click();
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill("修復登入邏輯");
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .press("Enter");
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "修復登入邏輯" })
    .waitFor();
  assert.equal(
    await page.locator(".cw-workspace").count(),
    1,
    "assignment opens the created task immediately",
  );
  await page.getByLabel("補充指示", { exact: true }).waitFor();
  const activeBadge = page.locator(".bot-row.selected .cw-tags .cw-running");
  await activeBadge.waitFor();
  assert.equal(
    (await activeBadge.textContent())?.trim(),
    "執行中 1",
    "one task is not double-counted as another chat run",
  );
  await page.getByLabel("補充指示", { exact: true }).fill("保留任務草稿");
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill("保留主對話草稿");
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "修復登入邏輯", exact: true })
    .click();
  await page.evaluate(() => {
    const navigation = JSON.parse(
      sessionStorage.getItem("apsis.task-navigation.v1") || "{}",
    );
    navigation.tabs.push("missing-task", "../../invalid", null);
    sessionStorage.setItem(
      "apsis.task-navigation.v1",
      JSON.stringify(navigation),
    );
  });
  await page.reload();
  await page.getByLabel("補充指示", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("補充指示", { exact: true }).inputValue(),
    "保留任務草稿",
    "reload restores active task and its unsent draft",
  );
  assert.equal(
    await page.locator(".cw-tabs > span").count(),
    1,
    "reload drops unknown task IDs",
  );
  assert.deepEqual(
    missingTaskRequests,
    [],
    "invalid saved task IDs are never requested",
  );
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "傳送訊息", exact: true })
      .inputValue(),
    "保留主對話草稿",
    "task restoration preserves the Bot conversation draft",
  );
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "修復登入邏輯", exact: true })
    .click();
  await page.getByLabel("補充指示", { exact: true }).fill("");
  releaseFirstWork();
  assert.equal(
    await page.locator(".message-column .cw-card").count(),
    0,
    "task cards stay out of chat",
  );
  const taskToggle = page.locator(".bot-task-toggle");
  await taskToggle.click();
  assert.equal(await page.locator(".bot-task-link").count(), 0);
  await taskToggle.press("Enter");
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "修復登入邏輯" })
    .waitFor();
  await page.screenshot({
    path: join(out, "desktop-task-created.png"),
    fullPage: true,
  });
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "修復登入邏輯" })
    .click();
  await page.getByLabel("補充指示", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".cw-inspector").count(),
    0,
    "tasks start without an empty inspector",
  );
  const composerBounds = await page.locator(".cw-compose").boundingBox();
  assert.ok(
    composerBounds && composerBounds.height <= 180,
    "empty task composer remains compact",
  );
  await page
    .locator(".cw-header")
    .getByRole("button", { name: /查看變更/ })
    .click();
  await page
    .locator(".cw-file-list button")
    .filter({ hasText: "login.ts" })
    .waitFor();
  await page
    .locator(".cw-diff")
    .getByText("export const login = true;", { exact: true })
    .first()
    .waitFor();
  assert.deepEqual(
    await page.locator(".cw-panel-tabs button").allTextContents(),
    ["檔案", "變更"],
  );
  assert.equal(
    await page.getByRole("button", { name: "Git", exact: true }).count(),
    0,
  );
  await page.locator(".cw-git-details summary").click();
  await page.getByLabel("Git 分支圖").waitFor();
  await page.locator(".cw-git-details summary").click();
  await page.locator(".cw-message .task-summary").first().click();
  assert.equal(
    await page.locator(".cw-message.assistant .task-history").count(),
    1,
    "run history belongs to its reply",
  );
  assert.equal(
    runRequests.length,
    0,
    "task run records use supplied data, not a main-chat-only API",
  );
  await page.locator(".cw-message .task-summary").first().click();
  const resizeHandle = page.getByRole("separator", { name: "調整檢視區寬度" });
  const originalWidth = Number(
    await resizeHandle.getAttribute("aria-valuenow"),
  );
  await resizeHandle.press("ArrowLeft");
  assert.equal(
    Number(await resizeHandle.getAttribute("aria-valuenow")),
    originalWidth + 24,
    "inspector width is keyboard adjustable",
  );
  await resizeHandle.press("ArrowRight");
  await page.setViewportSize({ width: 1280, height: 900 });
  await resizeHandle.press("End");
  assert.equal(await resizeHandle.getAttribute("aria-valuenow"), "640");
  const discussionAtMax = (await page.locator(".cw-discussion").boundingBox())!;
  const inspectorAtMax = (await page.locator(".cw-inspector").boundingBox())!;
  assert.ok(
    discussionAtMax.width >= 480,
    "maximum task inspector preserves a 480px discussion",
  );
  assert.ok(
    inspectorAtMax.width <= 544,
    "task inspector fits 1280px screen with 256px roster",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "task inspector resize has no horizontal overflow",
  );
  await page.screenshot({
    path: join(out, "desktop-diff-max-1280.png"),
    fullPage: true,
  });
  await resizeHandle.press("Home");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: join(out, "desktop-diff.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "引用程式碼，請 Bot 修改" }).click();
  assert.match(await page.getByLabel("補充指示").inputValue(), /login.ts/);
  await page
    .locator(".cw-panel-tabs")
    .getByRole("button", { name: "檔案", exact: true })
    .click();
  await page
    .locator(".file-tree")
    .getByRole("button", { name: "README.md", exact: true })
    .click();
  await page
    .locator(".file-preview-path")
    .filter({ hasText: "README.md" })
    .waitFor();
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "修復登入邏輯", exact: true })
    .click();
  await page
    .locator(".file-preview-path")
    .filter({ hasText: "README.md" })
    .waitFor();
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page.getByRole("button", { name: "工作選項", exact: true }).click();
  await page.getByLabel("工作位置", { exact: true }).selectOption(project.id);
  await page
    .getByLabel("起始分支")
    .locator("option")
    .first()
    .waitFor({ state: "attached" });
  await page.getByLabel("模式", { exact: true }).selectOption("plan");
  await page.getByRole("button", { name: "關閉工作選項", exact: true }).click();
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill("規劃權限功能");
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .press("Enter");
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "規劃權限功能" })
    .waitFor();
  assert.equal(await page.locator(".message-column .cw-card").count(), 0);
  const planTask = app.product
    .snapshot()
    .codingTasks.find((t) => t.title === "規劃權限功能");
  assert.ok(planTask);
  await page.locator(".cw-plan-card").waitFor();
  assert.equal(
    await page.locator(".cw-header h1").textContent(),
    "規劃權限功能",
    "planning assignment opens its own task",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".cw-plan-card .markdown li").length >= 24,
  );
  assert.equal(
    await page.locator(".cw-plan-preview").getAttribute("open"),
    null,
    "plan is a compact summary by default",
  );
  assert.equal(
    await page.locator(".cw-plan-preview .markdown").isVisible(),
    false,
  );
  await page.locator(".cw-plan-preview > summary").click();
  assert.equal(
    await page.locator(".cw-plan-preview .markdown").isVisible(),
    true,
    "full plan remains available on demand",
  );
  await page.locator(".cw-plan-preview > summary").click();
  assert.equal(
    await page.locator(".cw-inspector").count(),
    0,
    "plan starts in conversation",
  );
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".cw-message.assistant .markdown li").length >=
      24,
  );
  await page.locator(".cw-messages").evaluate((element) => {
    element.scrollTop = 130;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.getByRole("button", { name: "編輯計畫", exact: true }).click();
  await page.getByLabel("計畫文件").waitFor();
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLTextAreaElement>('[aria-label="計畫文件"]')
      ?.value.includes("實作計畫"),
  );
  await page.getByLabel("計畫文件").fill("# 我調整的計畫\n驗證相容性");
  const planReadingPosition = await page
    .locator(".cw-messages")
    .evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "規劃權限功能", exact: true })
    .click();
  assert.ok(
    Math.abs(
      (await page
        .locator(".cw-messages")
        .evaluate((element) => element.scrollTop)) - planReadingPosition,
    ) <= 2,
    "switching tasks preserves the reading position",
  );
  assert.equal(
    await page.getByLabel("計畫文件").inputValue(),
    "# 我調整的計畫\n驗證相容性",
  );
  await page.getByRole("button", { name: "儲存計畫", exact: true }).click();
  await page
    .locator(".cw-inspector")
    .getByRole("button", { name: "開始實作", exact: true })
    .click();
  await page
    .locator(".cw-header>.cw-tag")
    .filter({ hasText: "待你檢查成果" })
    .waitFor();
  await page.getByRole("button", { name: "關閉工具返回討論" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.locator(".cw-plan-message").getAttribute("open"),
    null,
    "automatic implementation message does not repeat the entire plan",
  );
  const mobileHeader = (await page.locator(".cw-header").boundingBox())!;
  assert.ok(
    mobileHeader.height <= 180,
    "phone header leaves space to read the conversation",
  );
  await page.screenshot({
    path: join(out, "mobile-plan-summary.png"),
    fullPage: true,
  });
  await page
    .locator(".cw-header")
    .getByRole("button", { name: /查看變更/ })
    .click();
  await page.locator(".cw-diff-unified").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: join(out, "mobile-diff.png"), fullPage: true });
  await page.getByRole("button", { name: "關閉工具返回討論" }).click();
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-pressed"),
    ),
    "false",
    "closing the inspector restores its trigger focus",
  );
  await page.getByLabel("補充指示").fill("保留手機草稿");
  await page.getByLabel("補充指示").press("End");
  await page.getByLabel("補充指示").press("Enter");
  assert.equal(
    await page.getByLabel("補充指示").inputValue(),
    "保留手機草稿\n",
  );
  await page.getByLabel("補充指示").fill("保留手機草稿");
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page
    .getByRole("button", { name: "開啟 Bot 名單", exact: true })
    .click();
  await page
    .locator(".bot-task-link")
    .filter({ hasText: "規劃權限功能" })
    .click();
  await page.getByLabel("補充指示").waitFor();
  assert.equal(await page.getByLabel("補充指示").inputValue(), "保留手機草稿");
  for (const size of [
    { width: 375, height: 812 },
    { width: 844, height: 390 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.getByRole("button", { name: "Bot 對話", exact: true }).click();
  await page
    .locator(".cw-tabs")
    .getByRole("button", { name: "規劃權限功能", exact: true })
    .click();
  assert.equal(await page.getByLabel("補充指示").inputValue(), "保留手機草稿");
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.screenshot({ path: join(out, "dark-task.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "verification.json"),
    JSON.stringify(
      {
        passed: true,
        realGit: true,
        model: "deterministic fixture",
        checks: [
          "project settings and scoped knowledge",
          "files/changes only, secondary Git, execution records in chat",
          "assignment opens the created task immediately",
          "reload restores task tabs, active task and both conversation drafts",
          "unknown saved task IDs are ignored without requests",
          "a running coding task is counted once",
          "no task cards in chat",
          "real task worktree diff",
          "quote filename",
          "versioned plan edit and start",
          "desktop and mobile diff",
          "mobile discussion",
          "no overflow",
          "no page errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Coding workspace browser verification passed.");
} finally {
  releaseFirstWork();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
