import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { createApp } from "../server/app.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { createShareGateway } from "../server/share-gateway.ts";
const directory = await mkdtemp(join(tmpdir(), "apsis-files-browser-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  "artifacts/work-files-verification",
  desktopOnly ? "desktop" : ".",
);
await mkdir(output, { recursive: true });
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async () => ({ text: "工作完成。" }),
});
const connection = await app.connections.save({
  name: "Fixture",
  provider: "openai-compatible",
  url: "http://127.0.0.1:1/v1",
  model: "fixture",
  modelSettings: { fixture: { contextWindowTokens: 128000 } },
});
await app.connections.setDefault({
  connectionId: connection.id,
  model: connection.model,
});
const bot = await app.product.bots.create("檔案助理");
const location = app.product.workLocation(bot);
await app.product.files.save(
  location.id,
  "notes.md",
  "# Working notes\n\nOriginal draft.",
  null,
);
await app.product.files.save(location.id, ".gitignore", "node_modules/", null);
const htmlPath = "site/展示 頁.HTML";
const htmlFixture = (
  heading: string,
) => `<!doctype html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./assets/style.css"><style>h1 { font-size: 24px }</style>
</head><body><h1>${heading}</h1><img src="../sample.png" alt="Local image">
<form id="counter-form"><button id="counter" type="submit">Count: 0</button></form><p id="module"></p>
<script>document.body.dataset.inline = 'ready'</script>
<script src="./assets/app.js"></script><script type="module" src="./assets/module.mjs"></script>
</body></html>`;
await app.product.files.save(
  location.id,
  htmlPath,
  htmlFixture("HTML preview"),
  null,
);
await app.product.files.save(
  location.id,
  "site/assets/style.css",
  "body { margin: 16px; background: rgb(240, 245, 250); font-family: sans-serif } button { padding: 12px }",
  null,
);
await app.product.files.save(
  location.id,
  "site/assets/app.js",
  "let count = 0; document.querySelector('#counter-form').onsubmit = event => {event.preventDefault();document.querySelector('#counter').textContent = 'Count: ' + ++count;};",
  null,
);
await app.product.files.save(
  location.id,
  "site/assets/module.mjs",
  "import { label } from './label.mjs'; document.querySelector('#module').textContent = label;",
  null,
);
await app.product.files.save(
  location.id,
  "site/assets/label.mjs",
  "export const label = 'Module ready';",
  null,
);
await app.product.files.save(
  location.id,
  "sample.htm",
  "<h1>HTM preview</h1>",
  null,
);
await writeFile(
  join(location.path, "sample.docx"),
  await Packer.toBuffer(
    new Document({
      sections: [{ children: [new Paragraph("Document preview fixture")] }],
    }),
  ),
);
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet("Data").addRows([["Preview column", 42]]);
await workbook.xlsx.writeFile(join(location.path, "sample.xlsx"));
await writeFile(
  join(location.path, "sample.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ioAAAAASUVORK5CYII=",
    "base64",
  ),
);
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
console.log(JSON.stringify({ url, output, botId: bot.id }));
const close = async () => {
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
};
if (process.argv.includes("--serve")) {
  process.on("SIGINT", () => void close().then(() => process.exit(0)));
} else {
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  let expectingDirectoryFailure = false;
  const violations: unknown[] = [];
  await page.exposeFunction("reportCsp", (event: unknown) =>
    violations.push(event),
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) => {
      void (
        window as unknown as { reportCsp: (value: unknown) => Promise<void> }
      ).reportCsp({
        directive: event.effectiveDirective,
        source: event.sourceFile,
        line: event.lineNumber,
        target: (event.target as Element)?.outerHTML,
        sample: event.sample,
      });
    }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("409 (Conflict)") &&
      !(
        expectingDirectoryFailure &&
        m.text().includes("503 (Service Unavailable)")
      )
    )
      errors.push(m.text());
  });
  try {
    await page.setContent("<html><body>PDF preview fixture</body></html>");
    await page.pdf({ path: join(location.path, "sample.pdf"), format: "A4" });
    await page.goto(url);
    await page.locator(".bot-row").filter({ hasText: "檔案助理" }).click();
    await page.getByRole("button", { name: "切換工作內容" }).click();
    await page.getByRole("button", { name: "檔案", exact: true }).click();
    const files = page.getByRole("region", { name: "工作資料與檔案" });
    const directoryFailure = async (route: import("playwright").Route) => {
      if (new URL(route.request().url()).searchParams.get("path") === "site")
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture directory read failed." }),
        });
      else await route.continue();
    };
    expectingDirectoryFailure = true;
    await page.route("**/files?**", directoryFailure);
    const site = files.getByRole("button", { name: "site", exact: true });
    await site.press("Enter");
    const childFiles = files.getByRole("list", { name: "site", exact: true });
    await expect(childFiles.getByRole("alert")).toHaveText(
      "Fixture directory read failed.",
    );
    await expect(site).toHaveAttribute("aria-expanded", "true");
    await expect(site).toHaveAccessibleName("site");
    await page.screenshot({ path: join(output, "directory-retry.png") });
    await page.unroute("**/files?**", directoryFailure);
    await childFiles
      .getByRole("button", { name: "重新載入", exact: true })
      .press("Enter");
    await expect(childFiles).toBeFocused();
    await expect(
      childFiles.getByRole("button", { name: "展示 頁.HTML", exact: true }),
    ).toBeVisible();
    await expect(childFiles.getByRole("alert")).toHaveCount(0);
    expectingDirectoryFailure = false;
    await site.press("Enter");
    await expect(site).toHaveAttribute("aria-expanded", "false");
    await files
      .getByRole("button", { name: "sample.docx", exact: true })
      .click();
    await files
      .getByText("Document preview fixture", { exact: true })
      .waitFor();
    await files.getByRole("button", { name: "返回檔案", exact: true }).click();
    await files
      .getByRole("button", { name: "sample.xlsx", exact: true })
      .click();
    await files
      .locator(".file-document")
      .filter({ hasText: "Preview column" })
      .waitFor();
    await files.getByRole("button", { name: "返回檔案", exact: true }).click();
    await files
      .getByRole("button", { name: "sample.png", exact: true })
      .click();
    await files.locator(".file-image").waitFor();
    await page.waitForFunction(
      () =>
        !!document.querySelector<HTMLImageElement>(".file-image")?.naturalWidth,
    );
    await files.getByRole("button", { name: "返回檔案", exact: true }).click();
    await files
      .getByRole("button", { name: "sample.pdf", exact: true })
      .click();
    await files.locator("iframe.file-pdf[title='sample.pdf']").waitFor();
    await files
      .locator("iframe.file-pdf[title='sample.pdf']")
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await writeFile(
      join(output, "pdf-frames.json"),
      JSON.stringify(
        await Promise.all(
          page.frames().map(async (frame) => ({
            url: frame.url(),
            html: (await frame.content()).slice(0, 1500),
          })),
        ),
        null,
        2,
      ),
    );
    await page.screenshot({
      path: join(output, "pdf-preview.png"),
      fullPage: true,
    });
    const back = () =>
      files.getByRole("button", { name: "返回檔案", exact: true }).click();
    await back();
    await files.getByRole("button", { name: "notes.md", exact: true }).click();
    await files.getByRole("heading", { name: "Working notes" }).waitFor();
    assert.equal(
      await files
        .locator("textarea, [contenteditable=true], input, select")
        .count(),
      0,
    );
    for (const name of [
      "新增檔案",
      "新增資料夾",
      "上傳",
      "回收區",
      "儲存",
      "編輯",
      "新增或連結專案",
    ]) {
      assert.equal(
        await files.getByRole("button", { name, exact: true }).count(),
        0,
      );
    }
    const downloaded = page.waitForEvent("download");
    await files.getByRole("link", { name: "下載", exact: true }).click();
    assert.equal(
      await readFile(await (await downloaded).path(), "utf8"),
      "# Working notes\n\nOriginal draft.",
    );
    await files
      .getByRole("button", { name: "引用給 Bot", exact: true })
      .click();
    await files.getByText("已加入訊息引用", { exact: true }).waitFor();
    await writeFile(join(location.path, "notes.md"), "# Refreshed notes");
    await files.getByRole("button", { name: "重新整理", exact: true }).click();
    await files.getByRole("heading", { name: "Refreshed notes" }).waitFor();
    await files.getByRole("button", { name: "展開預覽" }).click();
    await page.getByRole("dialog", { name: "檔案預覽" }).waitFor();
    await page.screenshot({
      path: join(output, "desktop-preview.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await back();
    await files
      .getByRole("button", { name: "sample.htm", exact: true })
      .click();
    await page
      .frameLocator(".file-html")
      .getByRole("heading", { name: "HTM preview" })
      .waitFor();
    await back();
    await files.getByRole("button", { name: "site", exact: true }).click();
    await files
      .getByRole("button", { name: "展示 頁.HTML", exact: true })
      .click();
    const html = page.frameLocator(".file-html");
    await expect(files.locator(".html-preview-note")).toBeVisible();
    await expect(files.locator(".html-preview-note")).toContainText(
      "預覽不保存網頁資料",
    );
    await html
      .getByRole("heading", { name: "HTML preview", exact: true })
      .waitFor();
    await html.getByText("Module ready", { exact: true }).waitFor();
    await html.getByRole("button", { name: "Count: 0", exact: true }).click();
    await html.getByRole("button", { name: "Count: 1", exact: true }).waitFor();
    const htmlFrame = await files
      .locator(".file-html")
      .elementHandle()
      .then((el) => el!.contentFrame());
    assert.deepEqual(
      await htmlFrame!.evaluate(() => {
        let parentBlocked = false,
          storageBlocked = false;
        try {
          void parent.document;
        } catch {
          parentBlocked = true;
        }
        try {
          void localStorage.length;
        } catch {
          storageBlocked = true;
        }
        return {
          background: getComputedStyle(document.body).backgroundColor,
          image:
            !!document.querySelector<HTMLImageElement>("img")?.naturalWidth,
          inline: document.body.dataset.inline,
          parentBlocked,
          storageBlocked,
        };
      }),
      {
        background: "rgb(240, 245, 250)",
        image: true,
        inline: "ready",
        parentBlocked: true,
        storageBlocked: true,
      },
    );
    await files.getByRole("button", { name: "原始碼", exact: true }).click();
    await expect(files.locator(".html-preview-note")).toBeHidden();
    assert.match(
      await files.locator(".file-document").innerText(),
      /<!doctype html>/,
    );
    await expect(files.locator(".file-html")).toBeHidden();
    await files.getByRole("button", { name: "預覽", exact: true }).click();
    await html
      .getByRole("heading", { name: "HTML preview", exact: true })
      .waitFor();
    await expect(
      html.getByRole("button", { name: "Count: 1", exact: true }),
    ).toBeVisible();
    await files.getByRole("button", { name: "展開預覽", exact: true }).click();
    await expect(page.locator("dialog[open]")).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await expect(
      html.getByRole("button", { name: "Count: 1", exact: true }),
    ).toBeVisible();
    await files
      .getByRole("button", { name: "引用給 Bot", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(files.locator(".file-content")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      html.getByRole("button", { name: "Count: 1", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      files.getByRole("button", { name: "展開預覽", exact: true }),
    ).toBeFocused();
    await expect(
      html.getByRole("button", { name: "Count: 1", exact: true }),
    ).toBeVisible();
    await html.getByRole("button", { name: "Count: 1", exact: true }).click();
    await expect(
      html.getByRole("button", { name: "Count: 2", exact: true }),
    ).toBeVisible();
    await writeFile(
      join(location.path, htmlPath),
      htmlFixture("Refreshed HTML"),
    );
    await files.getByRole("button", { name: "重新整理", exact: true }).click();
    await html
      .getByRole("heading", { name: "Refreshed HTML", exact: true })
      .waitFor();
    await writeFile(
      join(location.path, "site/assets/label.mjs"),
      "export const label = 'Module refreshed';",
    );
    await files.getByRole("button", { name: "重新整理", exact: true }).click();
    await html.getByText("Module refreshed", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "html-desktop.png"),
      fullPage: true,
    });
    await files.getByRole("button", { name: "展開預覽" }).click();
    await html
      .getByRole("heading", { name: "Refreshed HTML", exact: true })
      .waitFor();
    await page.screenshot({
      path: join(output, "html-expanded.png"),
      fullPage: true,
    });
    await files.getByRole("button", { name: "收合", exact: true }).click();
    await back();
    await mkdir(join(location.path, "nested"));
    await writeFile(
      join(location.path, "nested", "child.txt"),
      "Nested preview",
    );
    await files.getByRole("button", { name: "重新整理", exact: true }).click();
    await files.getByRole("button", { name: "nested", exact: true }).click();
    await files.getByRole("button", { name: "child.txt", exact: true }).click();
    await files.getByText("Nested preview", { exact: true }).waitFor();
    await back();
    assert.equal(
      await files
        .getByRole("button", { name: "nested", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await files.getByRole("button", { name: "nested", exact: true }).click();
    assert.equal(
      await files
        .getByRole("button", { name: "child.txt", exact: true })
        .isVisible(),
      false,
    );
    await page.screenshot({
      path: join(output, "desktop-files.png"),
      fullPage: true,
    });
    await page
      .locator(".chat-header")
      .getByRole("button", { name: "工作資料夾", exact: true })
      .click();
    const folderDialog = page.getByRole("dialog", {
      name: "工作資料夾",
      exact: true,
    });
    await folderDialog.getByLabel("主機資料夾完整路徑").fill(location.path);
    await folderDialog.getByRole("button", { name: "使用此資料夾" }).click();
    await folderDialog.waitFor({ state: "hidden" });
    await files
      .getByRole("button", { name: "notes.md", exact: true })
      .waitFor();
    // A new topic keeps history and starts a fresh working folder.
    await page.request.post(url + `/api/v2/bots/${bot.id}/contexts`, {
      headers: { "X-Apsis-Client": "1" },
      data: {},
    });
    await files.getByText("此資料夾尚無檔案。", { exact: true }).waitFor();
    assert.equal(
      await files
        .getByRole("button", { name: "notes.md", exact: true })
        .count(),
      0,
    );
    await page
      .locator(".chat-header")
      .getByRole("button", { name: "工作資料夾", exact: true })
      .click();
    await folderDialog.getByLabel("主機資料夾完整路徑").fill(location.path);
    await folderDialog.getByRole("button", { name: "使用此資料夾" }).click();
    await folderDialog.waitFor({ state: "hidden" });
    await files
      .getByRole("button", { name: "notes.md", exact: true })
      .waitFor();
    for (const width of desktopOnly ? [] : [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      if (!(await files.isVisible()))
        await page.getByRole("button", { name: "切換工作內容" }).click();
      await files
        .getByRole("button", { name: "notes.md", exact: true })
        .click();
      await files.getByRole("heading", { name: "Refreshed notes" }).waitFor();
      await files.getByRole("button", { name: "原始碼", exact: true }).click();
      assert.equal(
        await files.locator(".file-document").innerText(),
        "# Refreshed notes",
      );
      await files.getByRole("button", { name: "預覽", exact: true }).click();
      await files.getByRole("heading", { name: "Refreshed notes" }).waitFor();
      await files.getByRole("button", { name: "展開預覽" }).click();
      await page.screenshot({
        path: join(output, `preview-${width}.png`),
        fullPage: true,
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.keyboard.press("Escape");
      await back();
      await files
        .getByRole("button", { name: "sample.htm", exact: true })
        .click();
      await page
        .frameLocator(".file-html")
        .getByRole("heading", { name: "HTM preview" })
        .waitFor();
      await files.getByRole("button", { name: "展開預覽" }).click();
      await page
        .frameLocator(".file-html")
        .getByRole("heading", { name: "HTM preview" })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: join(output, `html-${width}.png`),
        fullPage: true,
      });
      await files.getByRole("button", { name: "收合", exact: true }).click();
      await back();
      await page.screenshot({
        path: join(output, `files-${width}.png`),
        fullPage: true,
      });
    }
    await page.evaluate(
      () => (document.documentElement.dataset.theme = "dark"),
    );
    await page.screenshot({
      path: join(output, desktopOnly ? "desktop-dark.png" : "mobile-dark.png"),
      fullPage: true,
    });
    // Exercise real browser cookie/sandbox behavior through the authenticated
    // gateway, routing a fixture HTTPS origin locally without opening a tunnel.
    const shareOrigin = "https://apsis-preview-test.trycloudflare.com";
    const sharePassword = "preview-browser-fixture-password";
    const gateway = createShareGateway({
      upstreamPort: (app.server.address() as AddressInfo).port,
      password: sharePassword,
    });
    gateway.setPublicOrigin(shareOrigin);
    gateway.server.listen(0, "127.0.0.1");
    await once(gateway.server, "listening");
    const shared = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const cookie = await new Promise<string>((resolve, reject) => {
        const login = httpRequest(
          {
            hostname: "127.0.0.1",
            port: (gateway.server.address() as AddressInfo).port,
            path: "/__share/login",
            method: "POST",
            headers: {
              Host: new URL(shareOrigin).host,
              Origin: shareOrigin,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          },
          (response) => {
            response.resume();
            response.on("end", () =>
              resolve(response.headers["set-cookie"]![0].split(";")[0]),
            );
            response.on("error", reject);
          },
        );
        login.on("error", reject);
        login.end(new URLSearchParams({ password: sharePassword }).toString());
      });
      const separator = cookie.indexOf("=");
      await shared.addCookies([
        {
          name: cookie.slice(0, separator),
          value: cookie.slice(separator + 1),
          url: shareOrigin,
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await shared.route(`${shareOrigin}/**`, async (route) => {
        const request = route.request();
        const remote = new URL(request.url());
        // This fixture has no live jobs; do not buffer an unbounded SSE stream.
        if (remote.pathname === "/api/v2/events") {
          await route.fulfill({
            status: 200,
            contentType: "text/event-stream",
            body: ": fixture\n\n",
          });
          return;
        }
        const headers = { ...(await request.allHeaders()), host: remote.host };
        const response = await new Promise<{
          status: number;
          headers: Record<string, string>;
          body: Buffer;
        }>((resolve, reject) => {
          const upstream = httpRequest(
            {
              hostname: "127.0.0.1",
              port: (gateway.server.address() as AddressInfo).port,
              path: remote.pathname + remote.search,
              method: request.method(),
              headers,
            },
            (incoming) => {
              const chunks: Buffer[] = [];
              incoming.on("data", (chunk) => chunks.push(chunk));
              incoming.on("error", reject);
              incoming.on("end", () =>
                resolve({
                  status: incoming.statusCode!,
                  headers: Object.fromEntries(
                    Object.entries(incoming.headers)
                      .filter(([, value]) => value !== undefined)
                      .map(([key, value]) => [
                        key,
                        Array.isArray(value) ? value.join("\n") : value!,
                      ]),
                  ),
                  body: Buffer.concat(chunks),
                }),
              );
            },
          );
          upstream.on("error", reject);
          upstream.end(request.postDataBuffer());
        });
        await route.fulfill(response);
      });
      const remotePage = await shared.newPage();
      remotePage.on("pageerror", (e) => errors.push(e.message));
      remotePage.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await remotePage.goto(shareOrigin);
      await remotePage
        .locator(".bot-row")
        .filter({ hasText: "檔案助理" })
        .click();
      await remotePage.getByRole("button", { name: "切換工作內容" }).click();
      await remotePage
        .getByRole("button", { name: "檔案", exact: true })
        .click();
      const remoteFiles = remotePage.getByRole("region", {
        name: "工作資料與檔案",
      });
      await remoteFiles
        .getByRole("button", { name: "site", exact: true })
        .click();
      await remoteFiles
        .getByRole("button", { name: "展示 頁.HTML", exact: true })
        .click();
      const remoteHtml = remotePage.frameLocator(".file-html");
      await remoteHtml.getByText("Module refreshed", { exact: true }).waitFor();
      await remoteHtml
        .getByRole("button", { name: "Count: 0", exact: true })
        .click();
      await remoteHtml
        .getByRole("button", { name: "Count: 1", exact: true })
        .waitFor();
      await remotePage.screenshot({
        path: join(output, "html-share.png"),
        fullPage: true,
      });
    } finally {
      await shared.close();
      gateway.server.closeAllConnections();
      await new Promise<void>((r) => gateway.server.close(() => r()));
    }
    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      checks: [
        "image/PDF/Office previews",
        "Markdown and read-only text preview",
        "HTML/HTM with local CSS, images, inline scripts and ES modules",
        "HTML sandbox blocks parent and storage access",
        "authenticated share preview and opaque-origin assets",
        "preview/source switch, refresh HTML and assets, expand/collapse",
        "download and file reference",
        "refresh external changes",
        "expand and collapse folders",
        "single working folder dialog",
        "new task isolates files",
        desktopOnly
          ? "desktop preview"
          : "desktop/mobile preview and no overflow",
        "light/dark",
        "no browser errors",
      ],
    };
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    await writeFile(
      join(output, "csp.json"),
      JSON.stringify(violations, null, 2),
    );
    await page.screenshot({
      path: join(output, "failure.png"),
      fullPage: true,
    });
    await writeFile(join(output, "failure.html"), await page.content());
    throw error;
  } finally {
    await browser.close();
    await close();
  }
}
