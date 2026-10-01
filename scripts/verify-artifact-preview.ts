import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { fixtureStyle } from "./browser-style.ts";

const directory = await mkdtemp(join(tmpdir(), "apsis-published-preview-"));
const output = resolve("artifacts/artifact-preview");
await mkdir(output, { recursive: true });
const longName = "成果 " + "發布時保留的完整版本".repeat(9) + ".md";
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    if (options.prompt.includes("引用成果：")) {
      const references = JSON.parse(
        options.executionContext!.match(
          /User referenced files \(relative to this task\): ([^\n]+)/,
        )![1],
      );
      assert.match(
        await options.workspace.read(references[0].path),
        /已保存的第一版/,
      );
      return { text: "引用已收到，保存版本內容正確。" };
    }
    const tools = createTools(options);
    const call = (name: string, args: unknown) =>
      tools
        .find((tool) => tool.name === name)!
        .execute(randomUUID(), args, options.signal);
    await call("write_file", {
      path: "report.md",
      content: "# 已保存的第一版\n\n原始版本仍可閱讀。",
    });
    await call("publish_file", { path: "report.md", name: longName });
    await unlink(await options.workspace.resolve("report.md"));
    await call("write_file", {
      path: "page.html",
      content: `<html lang="zh-Hant"><meta charset="utf-8"><style>body{font:16px sans-serif;padding:24px}button{min-height:44px}input{max-width:100%}</style><h1>已保存的網頁</h1><form onsubmit="event.preventDefault();document.querySelector('output').textContent=++count"><button type="submit">加一</button></form><output>0</output><p><label>備註 <input></label></p><label><input type="checkbox">保留選項</label><p id="isolation"></p><script>let count=0;try{parent.document.body;document.querySelector('#isolation').textContent='隔離失效'}catch{document.querySelector('#isolation').textContent='無法存取應用程式'}</script></html>`,
    });
    await call("publish_file", { path: "page.html", name: "互動網頁.html" });
    await call("write_file", {
      path: "page.html",
      content: "新版工作檔案，不應出現在發布預覽。",
    });
    await writeFile(
      await options.workspace.resolve("pixel.png", true),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await call("publish_file", { path: "pixel.png", name: "圖片.png" });
    for (const format of ["docx", "xlsx", "pdf"]) {
      await call("create_document", {
        format,
        name: `文件-${format}`,
        content: format === "xlsx" ? '[["總計",42]]' : "發布的文件內容",
      });
    }
    for (const [path, content] of [
      ["archive.dat", "binary placeholder"],
      ["large.txt", "長".repeat(400000)],
    ]) {
      await writeFile(await options.workspace.resolve(path, true), content);
      await call("publish_file", { path, name: path });
    }
    return { text: "成果已發布。工作檔案後續變動不會修改這份交付。" };
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
const bot = await app.product.bots.create("交付夥伴");
const otherBot = await app.product.bots.create("另一位夥伴");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
let release = () => {};
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const audits: unknown[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\/artifacts\/[^/]+\/preview$/.test(request.url()))
      requests.push(request.url());
  });
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  const input = page.getByRole("textbox", { name: "傳送訊息", exact: true });
  await input.fill("製作成果");
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const message = page
    .locator(".message.assistant")
    .filter({ hasText: "成果已發布。" });
  await expect(message.locator(".artifact-card")).toHaveCount(8, {
    timeout: 20000,
  });
  assert.equal(requests.length, 0, "no eager published-file reads");
  await expect(
    message.locator(":scope > .artifact-deliveries > li"),
  ).toHaveCount(8);
  const open = (name: string) =>
    message.getByRole("button", { name: `預覽成果 ${name}`, exact: true });
  const preview = page.getByRole("region", { name: "成果預覽", exact: true });
  const audit = async (name: string) => {
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
    audits.push({
      name,
      violations: result.violations,
      incomplete: result.incomplete.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    });
    assert.deepEqual(
      result.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
      [],
      name,
    );
  };
  await input.fill("保留我的下一句草稿");
  await open(longName).focus();
  await page.keyboard.press("Enter");
  await expect(
    preview.getByRole("heading", { name: "已保存的第一版", exact: true }),
  ).toBeVisible();
  await preview.locator(".file-preview-info > summary").click();
  await expect(preview.getByText(/發布時的版本/)).toBeVisible();
  await preview.locator(".file-preview-info > summary").click();
  await expect(input).toHaveValue("保留我的下一句草稿");
  const collection = page.locator("details.cw-deliveries");
  await collection.locator(":scope > summary").click();
  await expect(collection.locator(".artifact-scope-label")).toHaveText(
    "此話題的附件與成果",
  );
  await expect(collection.locator(".artifact-other-topics")).toHaveCount(0);
  await expect(
    collection.locator(":scope > .artifact-deliveries > li"),
  ).toHaveCount(8);
  const compactProfiles = [];
  for (const size of [
    { width: 1440, height: 950, scale: 1 },
    { width: 375, height: 812, scale: 1 },
    { width: 375, height: 812, scale: 2 },
    { width: 812, height: 375, scale: 2 },
  ]) {
    await page.setViewportSize(size);
    await fixtureStyle(page, {
      content: `html {font-size:${size.scale * 100}% !important;}`,
    });
    if (!(await collection.isVisible())) await open(longName).click();
    await expect(collection).toBeVisible();
    if ((await collection.getAttribute("open")) === null)
      await collection.locator(":scope > summary").click();
    await expect(collection.locator(".artifact-card")).toHaveCount(8);
    await expect(collection.locator(".artifact-download")).toHaveCount(8);
    const controls = [];
    for (const control of await collection
      .locator(".artifact-card,.artifact-download")
      .all()) {
      await control.scrollIntoViewIfNeeded();
      const geometry = await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.getAttribute("aria-label"),
          width: r.width,
          height: r.height,
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          // Native scrolling rounds fractional percentage-sized scrollports.
          visible:
            r.left >= -1 &&
            r.top >= -1 &&
            r.right <= innerWidth + 1 &&
            r.bottom <= innerHeight + 1,
          onTop: el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
        };
      });
      if (
        !(
          geometry.width >= 44 &&
          geometry.height >= 44 &&
          geometry.visible &&
          geometry.onTop
        )
      )
        await page.screenshot({
          path: join(
            output,
            `compact-failed-${size.width}-${size.height}-${size.scale}x.png`,
          ),
        });
      assert.ok(
        geometry.width >= 44 &&
          geometry.height >= 44 &&
          geometry.visible &&
          geometry.onTop,
        `${size.width}-${size.height}-${size.scale}x ${JSON.stringify(geometry)}`,
      );
      controls.push(geometry);
    }
    assert.equal(controls.length, 16);
    await expect(input).toHaveValue("保留我的下一句草稿");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const profile = `${size.width}-${size.height}-${size.scale}x`;
    compactProfiles.push({ profile, controls });
    await page.screenshot({
      path: join(output, `compact-deliveries-${profile}.png`),
    });
    if (size.height === 375) {
      await collection
        .getByRole("button", { name: `預覽成果 ${longName}`, exact: true })
        .click();
      await expect(collection).not.toHaveAttribute("open", "");
      await expect(preview).toBeVisible();
      await page.screenshot({
        path: join(output, "compact-return-preview.png"),
      });
    }
  }
  await fixtureStyle(page, { content: "html {font-size:100% !important;}" });
  await page.setViewportSize({ width: 1440, height: 950 });
  if (!(await collection.isVisible())) await open(longName).click();
  if ((await collection.getAttribute("open")) !== null)
    await collection.locator(":scope > summary").click();
  await audit("desktop-markdown");
  await page.screenshot({ path: join(output, "desktop-markdown.png") });
  await preview.getByRole("button", { name: "原始碼", exact: true }).click();
  await expect(preview.locator("pre.file-document")).toContainText(
    "# 已保存的第一版",
  );
  await preview.getByRole("button", { name: "預覽", exact: true }).click();
  await preview.getByRole("button", { name: "展開預覽", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "成果預覽", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    preview.getByRole("button", { name: "展開預覽", exact: true }),
  ).toBeFocused();
  const downloading = page.waitForEvent("download");
  await message
    .getByRole("link", { name: `下載成果 ${longName}`, exact: true })
    .click();
  const downloaded = await downloading;
  assert.equal(downloaded.suggestedFilename(), longName);
  assert.match(
    await readFile((await downloaded.path())!, "utf8"),
    /已保存的第一版/,
  );
  await open("互動網頁.html").click();
  const frame = preview.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "已保存的網頁", exact: true }),
  ).toBeVisible();
  await expect(
    frame.getByText("無法存取應用程式", { exact: true }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "加一", exact: true }).click();
  await expect(frame.locator("output")).toHaveText("1");
  await frame.getByRole("textbox", { name: "備註" }).fill("尚未送出的預覽草稿");
  await frame.getByRole("checkbox", { name: "保留選項" }).check();
  await expect(preview.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-forms",
  );
  await audit("desktop-html");
  await preview.getByRole("button", { name: "展開預覽", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "成果預覽", exact: true }),
  ).toBeVisible();
  const htmlStateAfterExpansion = await frame.locator("output").textContent();
  assert.equal(
    htmlStateAfterExpansion,
    "1",
    "expansion preserves the browsing context",
  );
  await expect(page.locator("dialog[open]")).toHaveAttribute(
    "aria-modal",
    "true",
  );
  await preview
    .getByRole("button", { name: "引用給 Bot", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(preview.locator(".file-content")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    frame.getByRole("button", { name: "加一", exact: true }),
  ).toBeFocused();
  await audit("desktop-html-expanded");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener("message", () => resolve(), { once: true });
        window.postMessage("apsis:preview:escape", "*");
      }),
  );
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(frame.locator("output")).toHaveText("1");
  await expect(
    preview.getByRole("button", { name: "展開預覽", exact: true }),
  ).toBeFocused();
  await preview.getByRole("button", { name: "原始碼", exact: true }).click();
  await expect(preview.locator("iframe")).toBeHidden();
  await expect(preview.locator("pre.file-document")).toBeVisible();
  await preview.getByRole("button", { name: "預覽", exact: true }).click();
  await expect(frame.locator("output")).toHaveText("1");
  await expect(frame.getByRole("textbox", { name: "備註" })).toHaveValue(
    "尚未送出的預覽草稿",
  );
  await expect(frame.getByRole("checkbox", { name: "保留選項" })).toBeChecked();
  await frame.getByRole("button", { name: "加一", exact: true }).click();
  await expect(frame.locator("output")).toHaveText("2");
  await page.locator(".details").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "關閉工作內容", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: join(output, "desktop-html.png") });
  for (const format of ["docx", "xlsx"]) {
    await open(`文件-${format}.${format}`).click();
    await expect(
      preview.locator(
        format === "docx" ? ".document-reading" : "pre.file-document",
      ),
    ).toContainText(format === "xlsx" ? "總計" : "發布的文件內容");
  }
  await open("文件-pdf.pdf").click();
  await expect(preview.locator("iframe")).toHaveAttribute(
    "title",
    "文件-pdf.pdf",
  );
  await open("圖片.png").click();
  await expect(
    preview.getByRole("img", { name: "圖片.png", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      preview
        .locator("img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  for (const name of ["archive.dat", "large.txt"]) {
    await open(name).click();
    await expect(
      preview.getByText("此格式或大小不支援預覽，請下載檔案。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      preview.getByRole("link", { name: "下載", exact: true }),
    ).toBeVisible();
  }
  const artifacts = app.product.queries.detail(bot.id).artifacts;
  const publishedHtml = artifacts.find(
    (artifact) => artifact.name === "互動網頁.html",
  )!;
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(`${base}/api/v2/artifacts/${publishedHtml.id}`)
      ).arrayBuffer(),
    ),
    await readFile(
      join(directory, "data", "artifacts", publishedHtml.snapshotPath!),
    ),
    "preview keyboard navigation never alters the downloaded snapshot",
  );
  const md = artifacts.find((artifact) => artifact.name === longName)!;
  const legacy = { ...md, id: randomUUID(), snapshotPath: undefined };
  app.product.db.artifacts.put(legacy);
  assert.deepEqual(
    await (await fetch(`${base}/api/v2/artifacts/${legacy.id}/preview`)).json(),
    { kind: "download" },
  );
  assert.equal(
    (await fetch(`${base}/api/v2/artifacts/${legacy.id}/view`)).status,
    415,
  );
  app.product.db.artifacts.remove(legacy.id);
  const large = artifacts.find((artifact) => artifact.name === "large.txt")!;
  const unsupported = artifacts.find(
    (artifact) => artifact.name === "archive.dat",
  )!;
  assert.deepEqual(
    await (await fetch(`${base}/api/v2/artifacts/${large.id}/preview`)).json(),
    { kind: "download" },
  );
  assert.equal(
    (await fetch(`${base}/api/v2/artifacts/${unsupported.id}/view`)).status,
    415,
  );
  assert.equal(
    (await fetch(`${base}/api/v2/artifacts/missing/preview`)).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/v2/artifacts/${md.id}/preview`, {
        headers: { Origin: "http://untrusted.invalid" },
      })
    ).status,
    403,
  );
  const image = artifacts.find((artifact) => artifact.name === "圖片.png")!;
  const viewed = await fetch(`${base}/api/v2/artifacts/${image.id}/view`);
  assert.equal(viewed.headers.get("content-type"), "image/png");
  assert.match(viewed.headers.get("content-security-policy")!, /sandbox/);
  const pattern = `**/artifacts/${md.id}/preview`;
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "讀取暫時失敗" }),
    }),
  );
  await open(longName).click();
  await expect(preview.getByRole("alert")).toContainText("讀取暫時失敗");
  await page.unroute(pattern);
  await preview.getByRole("button", { name: "重新載入", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "已保存的第一版", exact: true }),
  ).toBeVisible();
  await open("互動網頁.html").click();
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let readFinished = () => {};
  const finished = new Promise<void>((resolve) => {
    readFinished = resolve;
  });
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue();
    readFinished();
  });
  await open(longName).click();
  await expect(preview.getByRole("status")).toHaveText("載入中");
  await open("互動網頁.html").click();
  await expect(
    frame.getByRole("heading", { name: "已保存的網頁", exact: true }),
  ).toBeVisible();
  release();
  await finished;
  await page.unroute(pattern);
  await expect(preview.locator(".file-preview-path")).toHaveText(
    "互動網頁.html",
    { useInnerText: true },
  );
  await expect(preview.locator(".file-preview-path")).toHaveAttribute(
    "title",
    "互動網頁.html",
  );
  await input.fill("");
  await page.getByRole("button", { name: "開啟新話題", exact: true }).click();
  await expect(
    page.getByRole("separator", { name: "新話題", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".artifact-preview")).toHaveCount(0);
  if ((await collection.getAttribute("open")) === null)
    await collection.locator(":scope > summary").press("Enter");
  await expect(collection.locator(".artifact-scope-empty")).toHaveText(
    "此話題尚無附件或成果。",
  );
  const otherTopics = collection.locator(".artifact-other-topics");
  await expect(otherTopics).not.toHaveAttribute("open", "");
  const olderDelivery = otherTopics.getByRole("button", {
    name: `預覽成果 ${longName}`,
    exact: true,
  });
  await expect(olderDelivery).toBeHidden();
  await otherTopics.locator(":scope > summary").press("Enter");
  await expect(olderDelivery).toBeVisible();
  await expect(otherTopics.locator(".artifact-card")).toHaveCount(8);
  await olderDelivery.press("Enter");
  await expect(
    preview.getByRole("heading", { name: "已保存的第一版", exact: true }),
  ).toBeVisible();
  const currentContext = app.product.queries.detail(bot.id).session.context!.id;
  const referencePattern = `**/bots/${bot.id}/artifact-reference`;
  await page.route(referencePattern, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "引用暫時失敗" }),
    }),
  );
  await preview
    .getByRole("button", { name: "引用給 Bot", exact: true })
    .click();
  await expect(preview.getByRole("alert")).toHaveText("無法加入引用，請重試。");
  await expect(preview.getByRole("status")).toHaveCount(0);
  await expect(input).toHaveValue("");
  await page.unroute(referencePattern);
  await preview
    .getByRole("button", { name: "引用給 Bot", exact: true })
    .click();
  await expect.poll(() => input.inputValue()).toContain(longName);
  await expect(preview.getByRole("status")).toHaveText("已加入訊息引用");
  assert.equal(
    app.product.queries.detail(bot.id).session.context!.id,
    currentContext,
  );
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    if (theme === "dark") {
      await page
        .getByRole("button", { name: "關閉工作內容", exact: true })
        .click();
      await page
        .getByRole("button", { name: "開啟 Bot 名單", exact: true })
        .click();
      await page
        .getByRole("button", { name: "切換為深色模式", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await open(longName).click();
    } else await open(longName).click();
    const drawer = page.getByRole("dialog", { name: "工作內容", exact: true });
    await expect(drawer).toBeVisible();
    await expect(
      preview.getByRole("heading", { name: "已保存的第一版", exact: true }),
    ).toBeVisible();
    await audit(`phone-${theme}`);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: join(output, `phone-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(open(longName)).toBeFocused();
    const bounds = await message
      .getByRole("link", { name: `下載成果 ${longName}`, exact: true })
      .boundingBox();
    assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44);
    await open("互動網頁.html").click();
    await expect(
      frame.getByText("無法存取應用程式", { exact: true }),
    ).toBeVisible();
    await frame.getByRole("button", { name: "加一", exact: true }).click();
    await expect(frame.locator("output")).toHaveText("1");
    await preview
      .getByRole("button", { name: "展開預覽", exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(frame.locator("output")).toHaveText("1");
    await preview
      .getByRole("button", { name: "引用給 Bot", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(preview.locator(".file-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      frame.getByRole("button", { name: "加一", exact: true }),
    ).toBeFocused();
    await audit(`phone-${theme}-expanded`);
    await page.screenshot({
      path: join(output, `phone-${theme}-expanded.png`),
    });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeVisible();
    await expect(frame.locator("output")).toHaveText("1");
    await expect(
      preview.getByRole("button", { name: "展開預覽", exact: true }),
    ).toBeFocused();
    await preview
      .getByRole("button", { name: "引用給 Bot", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(preview.locator(".file-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      frame.getByRole("button", { name: "加一", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(open("互動網頁.html")).toBeFocused();
    if (theme === "light") await open(longName).click();
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/bots/${bot.id}/messages`) &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "傳送", exact: true }).click();
  const wire = (await sent).postDataJSON();
  assert.deepEqual(Object.keys(wire.fileReferences[0]).sort(), [
    "locationId",
    "path",
    "revision",
  ]);
  await expect(
    page
      .locator(".message.assistant")
      .filter({ hasText: "引用已收到，保存版本內容正確。" }),
  ).toBeVisible();
  await open(longName).click();
  const referenceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let referenceFinished = () => {};
  const referenced = new Promise<void>((resolve) => {
    referenceFinished = resolve;
  });
  await page.route(referencePattern, async (route) => {
    await referenceGate;
    await route.continue();
    referenceFinished();
  });
  await preview
    .getByRole("button", { name: "引用給 Bot", exact: true })
    .click();
  await expect(
    preview.getByRole("button", { name: "正在加入引用…", exact: true }),
  ).toBeDisabled();
  await expect(preview.getByRole("status")).toHaveCount(0);
  await page.locator('.bot-row[title="另一位夥伴"]').click();
  await expect(
    page.getByRole("heading", { name: "你好，我是 另一位夥伴。", exact: true }),
  ).toBeVisible();
  release();
  await referenced;
  await page.unroute(referencePattern);
  await expect(input).toHaveValue("");
  await expect(page.locator(".attachment-chips")).toHaveCount(0);
  const uploaded = await fetch(
    `${base}/api/v2/bots/${otherBot.id}/attachments`,
    {
      method: "POST",
      headers: {
        "X-Apsis-Client": "1",
        "X-File-Name": encodeURIComponent("附件.txt"),
      },
      body: "已上傳的內容",
    },
  );
  assert.equal(uploaded.status, 201);
  await page.locator("details.cw-deliveries > summary").click();
  await page
    .getByRole("button", { name: "預覽附件 附件.txt", exact: true })
    .click();
  const attachmentPreview = page.getByRole("region", {
    name: "附件預覽",
    exact: true,
  });
  await expect(attachmentPreview.locator("pre.file-document")).toHaveText(
    "已上傳的內容",
  );
  await attachmentPreview.locator(".file-preview-info > summary").click();
  await expect(attachmentPreview.getByText(/上傳時的版本/)).toBeVisible();
  await attachmentPreview.locator(".file-preview-info > summary").click();
  await page.getByRole("button", { name: "關閉工作內容", exact: true }).click();
  await page.locator('.bot-row[title="交付夥伴"]').click();
  await page.setViewportSize({ width: 812, height: 375 });
  await fixtureStyle(page, { content: "html {font-size:200% !important;}" });
  await open("互動網頁.html").click();
  await expect(frame.locator("output")).toHaveText("0");
  await expect(
    frame.getByText("無法存取應用程式", { exact: true }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "加一", exact: true }).click();
  await expect(frame.locator("output")).toHaveText("1");
  await frame
    .getByRole("textbox", { name: "備註" })
    .fill("切換成果清單後仍保留");
  await frame.getByRole("checkbox", { name: "保留選項" }).check();
  const readsBeforeCollection = requests.length;
  await expect(frame.locator("output")).toHaveText("1");
  const retainedFrame = await preview.locator("iframe").elementHandle();
  await collection.locator(":scope > summary").click();
  await expect(preview).toBeHidden();
  const otherCollection = collection.locator(".artifact-other-topics");
  if (
    (await otherCollection.count()) > 0 &&
    (await otherCollection.getAttribute("open")) === null
  )
    await otherCollection.locator(":scope > summary").press("Enter");
  await collection
    .getByRole("button", { name: "預覽成果 互動網頁.html", exact: true })
    .click();
  await expect(collection).not.toHaveAttribute("open", "");
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "返回檔案", exact: true }),
  ).toBeFocused();
  assert.equal(
    await retainedFrame!.evaluate((el) => el.isConnected),
    true,
    "the same iframe node remains mounted",
  );
  assert.equal(
    requests.length,
    readsBeforeCollection,
    "collection navigation does not refetch the preview",
  );
  await expect(frame.locator("output")).toHaveText("1");
  await expect(frame.getByRole("textbox", { name: "備註" })).toHaveValue(
    "切換成果清單後仍保留",
  );
  await expect(frame.getByRole("checkbox", { name: "保留選項" })).toBeChecked();
  assert.equal(
    requests.length,
    readsBeforeCollection,
    "collection navigation keeps the same preview",
  );
  await page.screenshot({
    path: join(output, "short-collection-preserved-html.png"),
  });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        audits,
        compactProfiles,
        shortCollectionPreservedHtml: true,
        errors,
        formats: [
          "markdown",
          "html",
          "image",
          "pdf",
          "docx",
          "xlsx",
          "unsupported",
          "large-text",
        ],
        lazyReads: true,
        immutablePreview: true,
        oldTopic: true,
        topicScopedDesktopCollection: true,
        retry: true,
        staleResponseIgnored: true,
        keyboardFocus: true,
        keyboardFrameEntryAndEscape: true,
        foreignEscapeMessageIgnored: true,
        referenceWireVerified: true,
        referenceSwitchIsolation: true,
        attachmentPreview: true,
        htmlStateAfterExpansion,
        previewStatePreserved: [
          "expansion",
          "collapse",
          "source switch",
          "form draft",
          "checkbox",
          "mobile nested Escape",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: lazy immutable published previews, preserved source deletion/edits, Markdown/source, sandboxed HTML interaction, image/PDF/document formats, bounded fallback, download, retry, stale response isolation, old topic/reference, draft retention, phone themes/focus/touch, axe and no page errors",
  );
} catch (error) {
  const failedPage = browser
    .contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (failedPage)
    await failedPage.screenshot({
      path: join(output, "verification-failed.png"),
    });
  console.log(
    JSON.stringify(
      app.product.queries
        .detail(bot.id)
        .session.messages.map(({ role, status, content }) => ({
          role,
          status,
          content: content.slice(0, 240),
        })),
    ),
  );
  throw error;
} finally {
  release();
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
