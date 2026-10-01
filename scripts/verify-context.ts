import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Page } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

// Long expanded paragraphs can extend beyond the modal scrollport. Keep axe's
// raw uncertainty, and independently check the painted text where it is visible.
async function expandedAudit(page: Page) {
  const audit = await new AxeBuilder({ page }).analyze();
  await writeFile(
    join(output, "expanded-audit-raw.json"),
    JSON.stringify(audit, null, 2),
  );
  assert.deepEqual(audit.violations, []);
  const review = await page
    .locator(".history-message .markdown p, .history-topic-list time:visible")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        if (node.tagName === "TIME") node.scrollIntoView({ block: "center" });
        const parse = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const foreground = getComputedStyle(node).color;
        let backdrop: Element | null = node;
        while (
          backdrop &&
          parse(getComputedStyle(backdrop).backgroundColor)[3] === 0
        )
          backdrop = backdrop.parentElement;
        const background = getComputedStyle(backdrop!).backgroundColor;
        const a = luminance(parse(foreground)),
          b = luminance(parse(background));
        const box = node.getBoundingClientRect();
        const port = node
          .closest(".history-modal-body")!
          .getBoundingClientRect();
        const top = Math.max(box.top, port.top),
          bottom = Math.min(box.bottom, port.bottom);
        const hits = [];
        if (bottom > top + 4)
          for (const fraction of [0.2, 0.5, 0.8])
            hits.push(
              node.contains(
                document.elementFromPoint(
                  box.left + box.width / 2,
                  top + (bottom - top) * fraction,
                ),
              ),
            );
        return {
          topicDate: node.tagName === "TIME",
          foreground,
          background,
          contrastRatio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          opaque:
            (parse(foreground)[3] ?? 1) === 1 &&
            (parse(background)[3] ?? 1) === 1,
          visiblePoints: hits.length,
          allVisiblePointsOnTop: hits.every(Boolean),
        };
      }),
    );
  for (const item of review)
    assert.ok(
      item.opaque && item.contrastRatio >= 4.5 && item.allVisiblePointsOnTop,
    );
  for (const item of review.filter((item) => item.topicDate))
    assert.ok(item.visiblePoints === 3);
  assert.ok(review.some((item) => item.visiblePoints > 0));
  for (const finding of audit.incomplete) {
    assert.equal(finding.id, "color-contrast");
    for (const node of finding.nodes) {
      for (const target of node.target) {
        assert.equal(typeof target, "string");
        if (/^\.markdown > p(?::nth-child\(\d+\))?$/.test(target as string))
          continue;
        assert.equal(
          await page
            .locator(target as string)
            .evaluate((element) => element.matches(".history-topic-list time")),
          true,
        );
      }
      assert.ok(
        node.any.some(
          (check) =>
            (check.data as { messageKey?: string })?.messageKey ===
              "elmPartiallyObscured" ||
            (node.target.every((target) =>
              /^\.markdown > p(?::nth-child\(\d+\))?$/.test(target as string),
            ) &&
              (check.data as { messageKey?: string })?.messageKey ===
                "elmPartiallyObscuring"),
        ),
      );
    }
  }
  return { violations: audit.violations, incomplete: audit.incomplete, review };
}

const dir = await mkdtemp(join(tmpdir(), "apsis-context-ui-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  desktopOnly
    ? "artifacts/context-verification/desktop"
    : "artifacts/context-verification",
);
await mkdir(output, { recursive: true });
let quoted = "";
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "work"),
  runner: async (options) => {
    quoted = options.executionContext || "";
    return { text: "完成本次工作" };
  },
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  model: "fixture",
  url: "http://127.0.0.1:1/v1",
  modelSettings: { fixture: { contextWindowTokens: 32768 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.bots.create("長期對話測試");
app.store.conversations.transaction(() => {
  for (let i = 0; i < 80; i++)
    app.store.conversations.append(bot.sessionId, {
      id: "history-" + i,
      role: i % 2 ? "assistant" : "user",
      content:
        i === 0
          ? "舊任務唯一證據青鳥"
          : i === 1
            ? "歷史紀錄 1\n\n" + "保留完整來源內容。".repeat(70)
            : `歷史紀錄 ${i}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 9, i)).toISOString(),
      status: "complete",
    });
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.locator(".bot-row").filter({ hasText: bot.name }).click();
  await expect(page.locator("article.message")).toHaveCount(50);
  await page.getByRole("button", { name: "更早的訊息", exact: true }).click();
  await expect(page.locator("article.message")).toHaveCount(80);
  await expect(
    page.getByText("舊任務唯一證據青鳥", { exact: true }),
  ).toBeVisible();
  const response = await fetch(url + "/api/v2/bots/" + bot.id + "/contexts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Apsis-Client": "1" },
    body: "{}",
  });
  assert.equal(response.ok, true);
  await expect
    .poll(() => app.tasks.store.conversations.contexts(bot.sessionId).length)
    .toBe(2);
  await page.locator(".bot-actions-menu summary").click();
  await page
    .locator(".bot-actions-menu")
    .getByRole("button", { name: "記憶與背景", exact: true })
    .click();
  const panel = page.locator(".context-panel");
  await panel.getByRole("button", { name: "新增記憶" }).click();
  await panel.getByLabel("記憶內容").fill("請使用繁體中文");
  await panel.locator(".memory-edit-advanced > summary").press("Enter");
  await panel.getByLabel("分類").selectOption("core");
  await panel.getByLabel("鎖定").check();
  await panel.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(
    panel.getByText("請使用繁體中文", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.tasks.store.state.memories.some(
        (m) => m.content === "請使用繁體中文",
      ),
    )
    .toBe(true);
  const memory = app.tasks.store.state.memories.find(
    (m) => m.content === "請使用繁體中文",
  )!;
  assert.equal(memory.locked, true);
  assert.equal(memory.tier, "core");
  await page.keyboard.press("Escape");
  await page.locator(".bot-actions-menu summary").click();
  await page.getByRole("button", { name: "瀏覽先前話題", exact: true }).click();
  await panel.getByLabel("搜尋歷史").fill("不存在的關鍵字");
  await panel.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(
    panel.getByText("找不到符合的訊息，試試其他關鍵字。", { exact: true }),
  ).toBeVisible();
  await panel.getByLabel("搜尋歷史").fill("歷史紀錄");
  await panel.getByRole("button", { name: "搜尋", exact: true }).click();
  const results = panel.getByRole("region", { name: "搜尋結果", exact: true });
  await expect(results.locator(".history-message")).toHaveCount(20);
  await expect(results.locator(".history-message header time")).toHaveCount(20);
  // A new draft keyword must not silently change the query used for pagination.
  await panel.getByLabel("搜尋歷史").fill("其他未送出的查詢");
  for (const count of [40, 60, 79]) {
    await panel
      .getByRole("button", { name: "更早的搜尋結果", exact: true })
      .click();
    await expect(results.locator(".history-message")).toHaveCount(count);
  }
  await expect(
    panel.getByRole("button", { name: "更早的搜尋結果", exact: true }),
  ).toHaveCount(0);
  const longMessage = results.locator(".history-message").last();
  await expect(
    longMessage.locator(".history-message-content"),
  ).not.toContainText("保留完整來源內容。".repeat(70));
  await longMessage
    .getByRole("button", { name: "展開內容", exact: true })
    .click();
  await expect(longMessage.locator(".history-message-content")).toContainText(
    "保留完整來源內容。".repeat(70),
  );
  await longMessage
    .getByRole("button", { name: "前後文", exact: true })
    .click();
  await expect(
    panel.getByRole("region", { name: "前後文", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "返回搜尋結果", exact: true })
    .click();
  await expect(results.locator(".history-message")).toHaveCount(79);
  await panel
    .getByRole("button", { name: "返回話題清單", exact: true })
    .click();
  const topics = panel.getByLabel("瀏覽先前話題", { exact: true });
  await expect(topics).toBeHidden();
  await expect(topics.locator("option")).toHaveCount(3);
  const earlierContext = app.store.conversations
    .contexts(bot.sessionId)
    .at(-1)!;
  const earlierTopic = panel.locator(
    `.history-topic-list button[data-context-id="${earlierContext.id}"]`,
  );
  await expect(earlierTopic).toBeVisible();
  await earlierTopic.focus();
  await page.keyboard.press("Enter");
  await expect(earlierTopic).toHaveAttribute("aria-pressed", "true");
  const transcript = panel.getByRole("region", {
    name: "先前話題的訊息",
    exact: true,
  });
  await expect(transcript.locator(".history-message")).toHaveCount(50);
  await transcript
    .getByRole("button", { name: "更早的訊息", exact: true })
    .click();
  await expect(transcript.locator(".history-message")).toHaveCount(80);
  await panel
    .getByRole("button", { name: "收合話題訊息", exact: true })
    .click();
  await expect(earlierTopic).toHaveAttribute("aria-pressed", "false");
  await expect(transcript.locator(".history-message")).toHaveCount(0);
  await panel.getByLabel("搜尋歷史").fill("青鳥");
  await panel.getByRole("button", { name: "搜尋", exact: true }).click();
  await expect(
    panel.getByText("舊任務唯一證據青鳥", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "引用", exact: true }).click();
  await page.getByRole("textbox", { name: "傳送訊息" }).fill("引用這份證據");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  await expect.poll(() => quoted).toContain("舊任務唯一證據青鳥");
  await expect(
    page.locator("#conversation").getByText("完成本次工作", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: join(output, "desktop.png"), fullPage: true });
  if (!desktopOnly) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(output, "mobile.png"), fullPage: true });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  assert.deepEqual(errors, []);
  app.store.conversations.archiveEngine(
    bot.sessionId,
    app.store.conversations.activeId(bot.sessionId),
    "fixture-tool-run",
    [
      {
        type: "tool",
        data: {
          id: "technical-history",
          content: JSON.stringify({
            name: "工具輸出測試",
            id: "opaque-tool-id",
            result: "已保存",
          }),
        },
      },
    ],
  );
  const profiles = [];
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const theme of ["light", "dark"] as const) {
      for (const width of desktopOnly ? [1440] : [1440, 375]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        await context.addInitScript(
          (theme) => localStorage.setItem("apsis.theme", theme),
          theme,
        );
        const sample = await context.newPage();
        const failures: string[] = [];
        sample.on("pageerror", (error) => failures.push(error.message));
        sample.on("console", (message) => {
          if (message.type() === "error") failures.push(message.text());
        });
        await sample.goto(url);
        await sample
          .getByRole("textbox", { name: /^(傳送訊息|Send message)$/ })
          .fill("保留我的草稿");
        await sample.locator(".bot-actions-menu summary").click();
        await sample
          .getByRole("button", {
            name: /^(瀏覽先前話題|Browse earlier topics)$/,
          })
          .click();
        const browserPanel = sample.locator(".history-browser");
        if (width > 900) {
          await expect(
            browserPanel.locator(".history-topic-select"),
          ).toBeHidden();
          await expect(
            browserPanel.locator(".history-topic-list"),
          ).toBeVisible();
        }
        await browserPanel
          .getByLabel(/^(搜尋歷史|Search history)$/)
          .fill("工具輸出測試");
        await browserPanel
          .getByRole("button", { name: /^(搜尋|Search)$/ })
          .click();
        await expect(browserPanel.locator(".history-message")).toHaveCount(1);
        await expect(browserPanel).not.toContainText("opaque-tool-id");
        await browserPanel
          .getByRole("button", { name: /^(展開內容|Expand content)$/ })
          .click();
        await expect(
          browserPanel.locator(".history-tool-record"),
        ).toContainText("opaque-tool-id");
        await browserPanel
          .getByLabel(/^(搜尋歷史|Search history)$/)
          .fill("保留完整來源");
        await browserPanel
          .getByRole("button", { name: /^(搜尋|Search)$/ })
          .click();
        await expect(browserPanel.locator(".history-message")).toHaveCount(1);
        assert.equal(
          await browserPanel
            .innerText()
            .then((text) => text.includes(earlierContext.id)),
          false,
          "opaque internal IDs are not presentation labels",
        );
        const name = `${width}-${locale}-${theme}`;
        await sample.screenshot({ path: join(output, `history-${name}.png`) });
        const audit = await new AxeBuilder({ page: sample }).analyze();
        assert.deepEqual(audit.violations, []);
        assert.deepEqual(audit.incomplete, []);
        await browserPanel
          .getByRole("button", { name: /^(展開內容|Expand content)$/ })
          .click();
        await expect(
          browserPanel.locator(".history-message .markdown"),
        ).toContainText("保留完整來源內容。".repeat(70));
        assert.equal(
          await sample.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        for (const button of await browserPanel
          .locator("button:visible")
          .all()) {
          const rect = (await button.boundingBox())!;
          assert.ok(
            rect.width >= 44 && rect.height >= 44,
            "44px history actions",
          );
        }
        const expanded = await expandedAudit(sample);
        await sample.screenshot({
          path: join(output, `history-${name}-expanded.png`),
        });
        let zoom;
        if (locale === "en" && theme === "dark" && width === 375) {
          const textSize = await browserPanel
            .locator(".history-message-content p")
            .first()
            .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
          await fixtureStyle(sample, {
            content: "html { font-size: 200% !important; }",
          });
          const zoomTextSize = await browserPanel
            .locator(".history-message-content p")
            .first()
            .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
          assert.ok(
            zoomTextSize >= textSize * 1.9,
            "history content actually scales with larger text",
          );
          assert.equal(
            await sample.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          await sample.screenshot({
            path: join(output, "history-375-en-dark-200pct.png"),
          });
          zoom = await expandedAudit(sample);
        }
        await sample.keyboard.press("Escape");
        await expect(
          sample.getByRole("textbox", { name: /^(傳送訊息|Send message)$/ }),
        ).toHaveValue("保留我的草稿");
        assert.deepEqual(failures, []);
        profiles.push({
          name,
          violations: audit.violations,
          incomplete: audit.incomplete,
          expanded,
          zoom,
          errors: failures,
        });
        await context.close();
      }
    }
  }
  await writeFile(
    join(output, "history-report.json"),
    JSON.stringify({ profiles }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "latest 50",
        "older page",
        "new task",
        "core memory and lock",
        "Chinese search",
        "empty-search feedback, retained search pages and submitted query",
        "expand message, surrounding messages and return to retained results",
        "topic pagination preserves all 80 messages",
        desktopOnly
          ? "four desktop history profiles, axe and 44px actions"
          : "eight history profiles plus 200% English phone, axe and 44px actions",
        "quote across contexts",
        "raw tool records hidden until explicitly expanded",
        ...(desktopOnly ? [] : ["mobile overflow"]),
        "no page errors",
      ],
      output,
    }),
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
