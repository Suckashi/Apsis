import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Page, type Locator } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-roster-search-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  desktopOnly ? "artifacts/roster-search/desktop" : "artifacts/roster-search",
);
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => {
    throw new Error("Search must not start a model task");
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
const bot = await app.product.bots.create("研究夥伴", { avatar: "cloud" });
const other = await app.product.bots.create("文件幫手", { avatar: "bean" });
const longSource =
  "原文開頭\n" +
  "內容🙂".repeat(1200) +
  "\n全文驗證標記\n" +
  "後文".repeat(1000) +
  "\n原文結尾";
for (const item of [bot, other]) {
  for (let i = 0; i < 80; i++)
    app.store.conversations.append(item.sessionId, {
      id: `${item.id}-history-${i}`,
      role: i % 2 ? "assistant" : "user",
      status: "complete",
      createdAt: new Date(Date.UTC(2026, 8, 1, 9, i)).toISOString(),
      content:
        i === 0
          ? `青鳥：${item.name}的舊話題證據`
          : i === 1
            ? longSource
            : `日常合作紀錄 ${i}`,
    });
}
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
for (const item of [bot, other]) {
  const response = await fetch(`${base}/api/v2/bots/${item.id}/contexts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
    body: "{}",
  });
  assert.equal(response.ok, true);
  app.store.conversations.append(item.sessionId, {
    id: `${item.id}-current`,
    role: "assistant",
    content:
      "- **目前正在整理**的內容\n- [完整報告](https://example.com/report_(final))",
    status: "complete",
    createdAt: new Date(
      Date.now() - (item.id === bot.id ? 600000 : 1200000),
    ).toISOString(),
  });
  app.product.db.bots.put({
    ...item,
    createdAt: new Date(
      Date.now() - (item.id === bot.id ? 3600000 : 1800000),
    ).toISOString(),
  });
}
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const profiles: object[] = [];
async function hit(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  const viewport = page.viewportSize()!;
  assert.ok(box.width >= 44 && box.height >= 44, "44px action");
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    "visible action",
  );
  assert.equal(
    await locator.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    true,
    "actual paint-order hit",
  );
  return box;
}
async function openRoster(page: Page) {
  if ((await page.locator("#bot-roster").getAttribute("inert")) !== null)
    await page.locator("#roster-toggle").click();
  await expect(page.locator("#bot-roster")).not.toHaveAttribute("inert");
}
async function reviewContrast(
  page: Page,
  audit: Awaited<ReturnType<AxeBuilder["analyze"]>>,
  scope: string,
) {
  const review = [];
  for (const finding of audit.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const node of finding.nodes) {
      assert.equal(node.target.length, 1);
      const selector = node.target[0];
      assert.equal(typeof selector, "string");
      const topicText = await page
        .locator(scope)
        .locator(selector as string)
        .evaluateAll(
          (nodes) =>
            nodes.length === 1 &&
            nodes[0].matches(
              ".history-topic-list time, .history-topic-list > button > span",
            ),
        );
      const resultHeading = await page
        .locator(scope)
        .locator(selector as string)
        .evaluateAll(
          (nodes) =>
            nodes.length === 1 &&
            nodes[0].matches(
              ".history-results-heading > h4, .history-results-heading > span",
            ),
        );
      assert.ok(
        [
          ".settings-link > span:nth-child(2)",
          "header > strong",
          "time",
        ].includes(selector as string) ||
          topicText ||
          resultHeading,
      );
      if (topicText || resultHeading)
        assert.ok(
          node.any.some(
            (check) =>
              (check.data as { messageKey?: string })?.messageKey ===
              "elmPartiallyObscured",
          ),
        );
      const text = page.locator(scope).locator(selector as string);
      await text.scrollIntoViewIfNeeded();
      const result = await text.evaluate((element) => {
        const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = getComputedStyle(element).color;
        let parent: Element | null = element;
        while (
          parent &&
          parse(getComputedStyle(parent).backgroundColor)[3] === 0
        )
          parent = parent.parentElement;
        const background = getComputedStyle(parent!).backgroundColor;
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const range = document.createRange();
        range.selectNodeContents(element);
        const hits = Array.from(range.getClientRects())
          .filter((r) => r.width > 2 && r.height > 2)
          .flatMap((r) =>
            [0.25, 0.5, 0.75].map((x) =>
              element.contains(
                document.elementFromPoint(
                  r.left + r.width * x,
                  r.top + r.height / 2,
                ),
              ),
            ),
          );
        return {
          foreground,
          background,
          contrastRatio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          points: hits.length,
          textOnTop: hits.every(Boolean),
        };
      });
      assert.ok(
        result.opaque &&
          result.contrastRatio >= 4.5 &&
          result.points > 0 &&
          result.textOnTop,
      );
      review.push({ selector, ...result });
    }
  }
  return review;
}
try {
  const configurations = [
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
    ...(desktopOnly
      ? [
          { width: 1024, height: 768, locale: "en", theme: "dark", scale: 2 },
          {
            width: 1440,
            height: 900,
            locale: "zh-Hant",
            theme: "light",
            scale: 2,
          },
        ]
      : []),
  ];
  for (const profile of configurations.filter(
    (profile) => !desktopOnly || profile.width > 900,
  )) {
    app.product.settings.update(
      { locale: profile.locale as "zh-Hant" | "en" },
      app.product.settings.read().revision,
    );
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      reducedMotion: "reduce",
    });
    await context.addInitScript(
      ({ botId, theme, locale }) => {
        localStorage.setItem("apsis.bot", botId);
        localStorage.setItem("apsis.theme", theme);
        localStorage.setItem("apsis.locale", locale);
      },
      { botId: bot.id, theme: profile.theme, locale: profile.locale },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (request.url().includes("/history/search?"))
        requests.push(request.url());
    });
    await page.goto(base);
    const composer = page.getByRole("textbox", {
      name: /^(傳送訊息|Send message)$/,
    });
    await expect(composer).toBeVisible();
    await composer.fill("保留我的草稿");
    if (profile.scale === 2)
      await fixtureStyle(page, {
        content: "html { font-size:200% !important; }",
      });
    await openRoster(page);
    await expect(page.locator(".bot-row strong")).toHaveText([
      bot.name,
      other.name,
    ]);
    await expect(page.locator(".bot-row .preview")).toHaveText([
      "目前正在整理的內容 完整報告",
      "目前正在整理的內容 完整報告",
    ]);
    const search = page.getByRole("textbox", {
      name: /^(搜尋 Bot|Search Bots)$/,
    });
    const clear = page.getByRole("button", {
      name: /^(清除搜尋|Clear search)$/,
    });
    const history = page.locator(".roster-history-search");
    await expect(search).toHaveAttribute(
      "placeholder",
      profile.locale === "en" ? "Search Bots" : "搜尋 Bot",
    );
    await expect(history).toHaveCount(0);
    await expect(clear).toHaveCount(0);
    await search.fill("  ");
    await expect(page.locator(".bot-row")).toHaveCount(2);
    await expect(history).toHaveCount(0);
    await clear.click();
    await expect(search).toBeFocused();
    await search.fill("青");
    await expect(history).toHaveCount(0);
    await search.fill("  青鳥  ");
    await expect(page.locator(".bot-row")).toHaveCount(0);
    await expect(history).toHaveAccessibleName(
      profile.locale === "en"
        ? `Search message history for ${bot.name}`
        : `搜尋 ${bot.name} 的歷史訊息`,
    );
    assert.equal(requests.length, 0, "typing does not run history search");
    const controls = [await hit(page, clear), await hit(page, history)];
    const labelFits = await history.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll("strong,small")).every(
        (label) => {
          const r = label.getBoundingClientRect();
          return (
            r.top >= box.top &&
            r.bottom <= box.bottom &&
            r.left >= box.left &&
            r.right <= box.right
          );
        },
      );
    });
    assert.equal(labelFits, true, "history text stays inside its action");
    if (profile.height <= 480) {
      for (const control of await page
        .locator("#bot-roster button:visible")
        .all())
        controls.push(await hit(page, control));
      await search.scrollIntoViewIfNeeded();
    }
    const sidebarAudit = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(sidebarAudit.violations, []);
    const sidebarReview = await reviewContrast(
      page,
      sidebarAudit,
      "#bot-roster",
    );
    const name = `${profile.width}-${profile.height}-${profile.locale}-${profile.theme}-${profile.scale}x`;
    await page.screenshot({ path: join(output, `search-${name}.png`) });
    await history.press("Enter");
    const panel = page.locator(".history-browser");
    await expect(panel.locator("h3")).toContainText(bot.name);
    await expect(panel.getByLabel(/^(搜尋歷史|Search history)$/)).toHaveValue(
      "青鳥",
    );
    const results = panel.locator(".history-results .history-message");
    await expect(results).toHaveCount(1);
    await expect(results).toContainText(`青鳥：${bot.name}的舊話題證據`);
    await expect(results).not.toContainText(other.name);
    assert.equal(requests.length, 1, "one explicit search");
    assert.equal(new URL(requests[0]).searchParams.get("q"), "青鳥");
    assert.ok(new URL(requests[0]).pathname.includes(`/bots/${bot.id}/`));
    const resultAudit = await new AxeBuilder({ page }).analyze();
    await writeFile(
      join(output, `results-${name}-raw.json`),
      JSON.stringify(resultAudit, null, 2),
    );
    assert.deepEqual(resultAudit.violations, []);
    const resultReview = await reviewContrast(
      page,
      resultAudit,
      ".history-browser",
    );
    await page.screenshot({ path: join(output, `results-${name}.png`) });
    if (profile.width >= 901) {
      await expect(panel.locator(".history-topics")).toBeHidden();
      await expect(panel.locator(".history-search-help")).not.toHaveAttribute(
        "open",
      );
      await panel
        .getByText(/^(搜尋說明|Search tips)$/, { exact: true })
        .click();
      await expect(panel.locator(".history-search-help p")).toBeVisible();
      await panel
        .getByText(/^(搜尋說明|Search tips)$/, { exact: true })
        .click();
    }
    // A modal edit stays a draft; background snapshots cannot restart the seed search.
    await panel
      .getByLabel(/^(搜尋歷史|Search history)$/)
      .fill("尚未送出的查詢");
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v2/bots/${bot.id}` &&
        response.request().method() === "GET",
    );
    app.product.notify(bot.id);
    await refreshed;
    await expect(panel.getByLabel(/^(搜尋歷史|Search history)$/)).toHaveValue(
      "尚未送出的查詢",
    );
    assert.equal(requests.length, 1, "refresh does not restart search");
    if (profile.width >= 901) {
      await panel
        .getByRole("button", {
          name: /^(返回話題清單|Back to topics)$/,
          exact: true,
        })
        .click();
      await expect(panel.locator(".history-topics")).toBeVisible();
      await expect(panel.locator(".history-results")).toHaveCount(0);
      await expect(panel.getByLabel(/^(搜尋歷史|Search history)$/)).toHaveValue(
        "",
      );
      assert.equal(
        requests.length,
        1,
        "returning to topics does not repeat search",
      );
      await expect(
        panel.getByLabel(/^(搜尋歷史|Search history)$/),
      ).toBeFocused();
    }
    await page.keyboard.press("Escape");
    await expect(history).toBeFocused();
    await clear.click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.locator(".bot-row")).toHaveCount(2);
    await expect(history).toHaveCount(0);
    if (profile.width <= 900) await page.keyboard.press("Escape");
    await expect(composer).toHaveValue("保留我的草稿");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    profiles.push({
      name,
      controls,
      sidebarReview,
      resultReview,
      sidebarAudit: {
        violations: sidebarAudit.violations,
        incomplete: sidebarAudit.incomplete,
      },
      resultAudit: {
        violations: resultAudit.violations,
        incomplete: resultAudit.incomplete,
      },
      requests,
      errors,
    });
    await context.close();
  }
  // Delayed, failed and cancelled searches use the actual route, not fabricated UI state.
  app.product.settings.update(
    { locale: "zh-Hant" },
    app.product.settings.read().revision,
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(
    (botId) => localStorage.setItem("apsis.bot", botId),
    bot.id,
  );
  const page = await context.newPage();
  await page.goto(base);
  await expect(
    page.getByRole("textbox", { name: "傳送訊息", exact: true }),
  ).toBeVisible();
  const search = page.getByRole("textbox", { name: "搜尋 Bot", exact: true });
  const history = page.locator(".roster-history-search");
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began = () => {};
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const routePattern = "**/history/search?q=*";
  let delayOnce = true;
  await page.route(routePattern, async (route) => {
    if (
      delayOnce &&
      new URL(route.request().url()).searchParams.get("q") === "青鳥"
    ) {
      delayOnce = false;
      began();
      await paused;
    }
    await route.continue();
  });
  await search.fill("青鳥");
  await history.click();
  await started;
  await expect(page.locator(".history-browser")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.keyboard.press("Escape");
  await search.fill("不存在的查詢");
  await history.click();
  await expect(
    page.getByText("找不到符合的訊息，試試其他關鍵字。", { exact: true }),
  ).toBeVisible();
  const delayedDone = page.waitForResponse(
    (response) =>
      response.url().includes("/history/search?q=") &&
      new URL(response.url()).searchParams.get("q") === "青鳥",
  );
  release();
  await delayedDone;
  await page.unroute(routePattern);
  await expect(page.locator(".history-results")).toContainText("不存在的查詢");
  await expect(page.locator(".history-results .history-message")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await page.route(
    routePattern,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "測試搜尋暫時無法使用" }),
      }),
    { times: 1 },
  );
  await search.fill("青鳥");
  await history.click();
  await expect(page.locator(".history-browser [role=alert]")).toContainText(
    "測試搜尋暫時無法使用",
  );
  await page
    .locator(".history-browser")
    .getByRole("button", { name: "搜尋", exact: true })
    .click();
  await expect(page.locator(".history-results .history-message")).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "清除搜尋", exact: true }).click();
  await page.locator(".bot-row").filter({ hasText: other.name }).click();
  await expect(page.locator(".bot-row[aria-current=page]")).toHaveAttribute(
    "title",
    other.name,
  );
  await search.fill("青鳥");
  await history.click();
  await expect(page.locator(".history-results .history-message")).toContainText(
    `青鳥：${other.name}的舊話題證據`,
  );
  await expect(
    page.locator(".history-results .history-message"),
  ).not.toContainText(bot.name);
  await page.keyboard.press("Escape");
  await page.locator(".bot-actions-menu summary").click();
  await page.getByRole("button", { name: "瀏覽先前話題", exact: true }).click();
  await expect(page.getByLabel("搜尋歷史", { exact: true })).toHaveValue("");
  await expect(page.locator(".history-results")).toHaveCount(0);
  const fullRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/history/message?"))
      fullRequests.push(request.url());
  });
  await page.getByLabel("搜尋歷史", { exact: true }).fill("全文驗證標記");
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  const source = page.locator(".history-results .history-message");
  await expect(source).toHaveCount(1);
  await expect(source).toContainText("目前顯示搜尋片段");
  await expect(
    source.getByRole("button", { name: "引用片段", exact: true }),
  ).toBeVisible();
  assert.equal(
    fullRequests.length,
    0,
    "search does not eagerly download full messages",
  );
  let failSource = true;
  await page.route("**/history/message?*", async (route) => {
    if (failSource) {
      failSource = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "原文暫時無法載入" }),
      });
    } else await route.continue();
  });
  await source
    .getByRole("button", { name: "展開完整原文", exact: true })
    .click();
  await expect(source.getByRole("alert")).toContainText("原文暫時無法載入");
  await expect(source).toContainText("目前顯示搜尋片段");
  await source.getByRole("button", { name: "重試", exact: true }).click();
  await expect(source.locator(".history-message-content")).toContainText(
    "原文開頭",
  );
  await expect(source.locator(".history-message-content")).toContainText(
    "原文結尾",
  );
  await expect(source).not.toContainText("目前顯示搜尋片段");
  await expect(
    source.getByRole("button", { name: "引用", exact: true }),
  ).toHaveCount(1);
  assert.equal(fullRequests.length, 2, "one failed load and one retry");
  await source.getByRole("button", { name: "收合", exact: true }).click();
  await source.getByRole("button", { name: "展開內容", exact: true }).click();
  assert.equal(
    fullRequests.length,
    2,
    "successful source is cached on collapse and expansion",
  );
  const sequence = new URL(fullRequests[1]).searchParams.get("sequence");
  const full = await fetch(
    `${base}/api/v2/bots/${other.id}/history/message?sequence=${sequence}`,
  );
  assert.equal(full.status, 200);
  assert.equal((await full.json()).content, longSource);
  const denied = await fetch(
    `${base}/api/v2/bots/${bot.id}/history/message?sequence=${sequence}`,
  );
  assert.equal(
    denied.status,
    404,
    "a known sequence cannot expose another Bot's source",
  );
  await source.getByRole("button", { name: "收合", exact: true }).click();
  await source.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "history-source.png") });
  await source.getByRole("button", { name: "引用", exact: true }).click();
  await expect(page.locator(".reply-chip")).toContainText("原文開頭");
  await expect(page.locator(".reply-chip")).not.toContainText("全文驗證標記");
  await page.getByRole("button", { name: "取消回覆", exact: true }).click();
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        passed: true,
        profiles,
        cancelledResponseIgnored: true,
        retry: true,
        scopeSwitch: true,
        menuStartsEmpty: true,
        fullSource: { lazy: true, retry: true, cached: true, scope: true },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, profiles: profiles.length, output }),
  );
  await context.close();
} catch (error) {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page)
    await page
      .screenshot({ path: join(output, "verification-failed.png") })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
