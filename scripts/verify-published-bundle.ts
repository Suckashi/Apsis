import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import type { AddressInfo } from "node:net";
import { chromium, type Page, type FrameLocator } from "playwright";
import { expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import JSZip from "jszip";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";
import { browserExecutable } from "../server/bot-browser.ts";
import { createShareGateway } from "../server/share-gateway.ts";
import { Workspace } from "../server/workspace.ts";
import { fixtureStyle } from "./browser-style.ts";

// One meaningful static application. CSS imports, module imports, SVG and JSON
// all have to survive publication, source deletion, download and a new topic.
const entry = "site/展示 頁.html",
  name = "旅費試算.html";
const sources: Record<string, string> = {
  [entry]: `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>旅費試算</title><link rel="icon" href="assets/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/style.css"><script type="module" src="modules/main.mjs"></script></head><body><main><img src="assets/logo.svg" alt="" width="36" height="36"><h1>旅費試算</h1><p>將預算換算為旅行時可使用的金額。</p><form><label for="amount">旅行預算</label><input id="amount" type="number" min="0" step="0.01" value="100" required><button type="submit">換算預算</button></form><p id="ready" role="status">讀取匯率中</p><output id="result" aria-live="polite">尚未換算</output><label for="note">備註</label><input id="note" placeholder="旅程的下一步"></main></body></html>`,
  "site/assets/style.css": `@import url("theme.css");*{box-sizing:border-box}body{margin:0;padding:20px;font:16px/1.5 system-ui;background:#faf8ff;color:#272333}main{max-width:480px;margin:auto}h1{font-size:26px;margin:12px 0}label{display:block;margin-top:20px;font-weight:600}input,button{font:inherit;min-height:44px;border-radius:10px;width:100%;padding:10px 12px}input{border:1px solid #898293;min-width:0;background:white;color:#272333}button{border:0;background:var(--accent);color:white;margin-top:12px;cursor:pointer}output{display:block;font-size:28px;font-weight:650;margin:20px 0;color:var(--accent)}input:focus-visible,button:focus-visible{outline:3px solid #7953a8;outline-offset:3px}`,
  "site/assets/theme.css": ":root{--accent:#674193}",
  "site/modules/main.mjs": `import {convert} from './calc.mjs';const rates=await (await fetch(new URL('../data/匯率.json',import.meta.url))).json();document.querySelector('#ready').textContent='匯率已就緒';document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#result').textContent=convert(document.querySelector('#amount').value,rates.rate)});`,
  "site/modules/calc.mjs":
    "export const convert=(amount,rate)=>'NT$ '+(Number(amount)*rate).toFixed(2);",
  "site/data/匯率.json": '{"rate":1.25}',
  "site/assets/logo.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" rx="12" fill="#674193"/><path d="M10 18h16m-6-6 6 6-6 6" stroke="white" stroke-width="3" fill="none"/></svg>',
};
const assets = Object.keys(sources).filter((path) => path !== entry);
const directory = await mkdtemp(join(tmpdir(), "apsis-web-bundle-"));
const desktopOnly = process.argv.includes("--desktop");
const output = resolve(
  "artifacts/published-bundle",
  desktopOnly ? "desktop" : ".",
);
await mkdir(output, { recursive: true });
let published = false;
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
  runner: async (options) => {
    const tools = createTools(options);
    const call = async (name: string, args: unknown) => {
      const result = await tools
        .find((tool) => tool.name === name)!
        .execute(randomUUID(), args, options.signal);
      const content = result.content[0];
      assert.equal(content.type, "text");
      return content.type === "text" ? content.text : "";
    };
    if (published) {
      const references = JSON.parse(
        options.executionContext!.match(
          /User referenced files \(relative to this task\): ([^\n]+)/,
        )![1],
      );
      const prefix = references[0].path.slice(0, -entry.length);
      for (const [path, text] of Object.entries(sources))
        assert.equal(await options.workspace.read(prefix + path), text);
      const receipt = await call("verify_web", {
        path: references[0].path,
        steps: JSON.stringify([
          { action: "expect_text", selector: "#ready", value: "匯率已就緒" },
          { action: "fill", selector: "#amount", value: "240" },
          { action: "click", selector: "button" },
          { action: "expect_text", selector: "#result", value: "NT$ 300.00" },
        ]),
      });
      assert.equal(JSON.parse(receipt).status, "passed");
      return { text: "已收到完整網頁引用，新的話題可繼續修改。" };
    }
    for (const [path, content] of Object.entries(sources))
      await call("write_file", { path, content });
    await call("write_file", {
      path: "work-only.md",
      content: "This working note is deliberately not published.",
    });
    const receipt = await call("verify_web", {
      path: entry,
      steps: JSON.stringify([
        { action: "expect_text", selector: "#ready", value: "匯率已就緒" },
        { action: "fill", selector: "#amount", value: "200" },
        { action: "click", selector: "button" },
        { action: "expect_text", selector: "#result", value: "NT$ 250.00" },
      ]),
    });
    assert.equal(JSON.parse(receipt).status, "passed");
    await call("publish_file", { path: entry, name, assets });
    published = true;
    // Deliberately break the original application after publication. The preview,
    // downloaded ZIP and references must continue using only its saved version.
    await options.workspace.write("site/assets/style.css", "body{color:red}");
    await unlink(await options.workspace.resolve("site/modules/main.mjs"));
    await options.workspace.write("site/data/匯率.json", '{"rate":999}');
    return { text: "網頁已完成，七個檔案已一併交付。" };
  },
});
app.product.settings.update(
  { approvalMode: "auto" },
  app.product.settings.read().revision,
);
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
const bot = await app.product.bots.create("網頁夥伴");
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const port = (app.server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable(),
});
const errors: string[] = [],
  audits: unknown[] = [],
  profiles: unknown[] = [];
const watch = (page: Page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
};
const exercise = async (
  frame: FrameLocator,
  amount: string,
  expected: string,
) => {
  await expect(frame.locator("#ready")).toHaveText("匯率已就緒");
  await expect(frame.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator("img")
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    )
    .toBe(true);
  assert.equal(
    await frame
      .locator("button")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(103, 65, 147)",
  );
  await frame.locator("#amount").fill(amount);
  await frame.getByRole("button", { name: "換算預算", exact: true }).click();
  await expect(frame.locator("#result")).toHaveText(expected);
  assert.equal(
    await frame
      .locator("body")
      .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
};
try {
  for (const locale of ["zh-Hant", "en"] as const) {
    app.product.settings.update(
      { locale },
      app.product.settings.read().revision,
    );
    for (const theme of ["light", "dark"] as const) {
      const sizes = [
        { width: 1440, height: 900, scale: false },
        ...(desktopOnly ? [] : [{ width: 375, height: 812, scale: false }]),
        ...(desktopOnly && locale === "en"
          ? [{ width: 1440, height: 900, scale: true }]
          : []),
        ...(!desktopOnly && locale === "en" && theme === "dark"
          ? [
              { width: 375, height: 812, scale: true },
              { width: 812, height: 375, scale: true },
            ]
          : []),
      ];
      for (const size of sizes) {
        const profile = `${locale}-${theme}-${size.width}${size.scale ? "-200" : ""}`;
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          watch(page);
          const previewRequests: string[] = [],
            assetRequests: string[] = [];
          page.on("request", (request) => {
            if (/\/artifacts\/[^/]+\/preview$/.test(request.url()))
              previewRequests.push(request.url());
            if (/\/html\/[a-f0-9]{48}\//.test(request.url()))
              assetRequests.push(request.url());
          });
          await page.goto(base);
          const botRow = page.locator(`.bot-row[title="${bot.name}"]`);
          if (await botRow.isVisible()) await botRow.click();
          await expect(page.locator(".header-profile")).toContainText(bot.name);
          if (size.scale)
            await fixtureStyle(page, {
              content: "html{font-size:200% !important}",
            });
          const input = page.getByRole("textbox", {
            name: locale === "en" ? "Send message" : "傳送訊息",
            exact: true,
          });
          if (!published) {
            await input.fill("製作旅費試算網頁");
            await page.locator(".composer-send-actions .send").click();
          }
          const card = page.locator(".message.assistant .artifact-delivery");
          await expect(card).toHaveCount(1, { timeout: 20000 });
          const workDetails = page.locator(
            ".message.assistant .execution-tools",
          );
          await workDetails.locator(":scope > summary").click();
          await expect(workDetails.locator(".task-row").first()).toBeVisible();
          const workingFiles = page.locator(".message.assistant .run-files");
          await expect(workingFiles).toHaveCount(1);
          await expect(workingFiles.locator("li")).toHaveCount(1);
          await expect(workingFiles).toContainText("work-only.md");
          await workDetails.locator(":scope > summary").click();
          await expect(card).toContainText(
            locale === "en" ? "7 files" : "7 個檔案",
          );
          assert.equal(previewRequests.length, 0, "no eager preview reads");
          assert.equal(assetRequests.length, 0, "no eager asset reads");
          await input.fill("保留下一句草稿");
          await card.locator("button").click();
          const preview = page.locator(".artifact-preview");
          const frame = preview.frameLocator("iframe");
          if (size.width > 768) {
            await expect(preview.locator(".html-preview-note")).toBeVisible();
            await expect(preview.locator(".html-preview-note")).toContainText(
              locale === "en"
                ? "Download the complete website"
                : "請下載完整網頁",
            );
          }
          await exercise(frame, "200", "NT$ 250.00");
          await frame.locator("#note").fill("尚未送出的旅程草稿");
          assert.equal(
            await frame.locator("body").evaluate(() => {
              let parentBlocked = false,
                storageBlocked = false;
              try {
                void parent.document.body;
              } catch {
                parentBlocked = true;
              }
              try {
                void localStorage.length;
              } catch {
                storageBlocked = true;
              }
              return parentBlocked && storageBlocked;
            }),
            true,
            "opaque sandbox blocks parent and storage",
          );
          const t = (zh: string, en: string) => (locale === "en" ? en : zh);
          const information = preview.locator(".file-preview-info > summary");
          await information.focus();
          await information.press("Enter");
          await expect(preview.locator(".artifact-version")).toContainText(
            t("已包含 7 個檔案", "Includes 7 files"),
          );
          await information.press("Enter");
          await expect(preview.locator(".artifact-version")).toBeHidden();
          await expect(
            preview.getByRole("link", {
              name: t("下載完整網頁", "Download complete web app"),
              exact: true,
            }),
          ).toBeVisible();
          await preview
            .getByRole("button", {
              name: t("展開預覽", "Expand preview"),
              exact: true,
            })
            .click();
          await expect(page.locator("dialog[open]")).toHaveAttribute(
            "aria-modal",
            "true",
          );
          assert.equal(
            await page
              .locator("dialog[open]")
              .evaluate((node) => node.matches(":modal")),
            true,
            "expanded preview must be a native modal",
          );
          await expect(frame.locator("#result")).toHaveText("NT$ 250.00");
          await expect(frame.locator("#note")).toHaveValue(
            "尚未送出的旅程草稿",
          );
          assert.equal(
            errors.length,
            0,
            "application has no errors before audit",
          );
          const note = preview.locator(".html-preview-note");
          if (await note.isVisible()) {
            await note.scrollIntoViewIfNeeded();
            await expect(note).toBeInViewport();
          }
          const auditStart = errors.length;
          // Scan the active modal separately: axe cannot reliably determine
          // background contrast for inert controls behind its iframe.
          const audit = await new AxeBuilder({ page })
            .include("dialog[open]")
            .withTags([
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "wcag22aa",
              "best-practice",
            ])
            .analyze();
          const scannerErrors = errors.splice(auditStart);
          if (scannerErrors.length) {
            // axe's cross-origin CSS preload reparses @import in a synthetic
            // stylesheet and requests theme.css relative to the document,
            // rather than assets/style.css. Keep these exact scanner errors;
            // never permit other console errors or relax the manifest for axe.
            const wrongImport = new URL(
              "theme.css",
              new URL(
                (await preview.locator("iframe").getAttribute("src"))!,
                base,
              ),
            ).href;
            assert.equal(scannerErrors.length, 2);
            assert.ok(
              scannerErrors[0].startsWith(
                `Access to XMLHttpRequest at '${wrongImport}' from origin 'null' has been blocked by CORS policy:`,
              ),
            );
            assert.equal(
              scannerErrors[1],
              "Failed to load resource: net::ERR_FAILED",
            );
          }
          audits.push({
            profile,
            violations: audit.violations,
            incomplete: audit.incomplete,
            scannerErrors,
          });
          await page.screenshot({ path: join(output, `${profile}.png`) });
          assert.deepEqual(audit.violations, [], profile);
          assert.deepEqual(audit.incomplete, [], profile);
          await frame.locator("#note").press("Escape");
          await expect(page.locator("dialog[open]")).toHaveCount(0);
          await expect(
            preview.getByRole("button", {
              name: t("展開預覽", "Expand preview"),
              exact: true,
            }),
          ).toBeFocused();
          await preview
            .getByRole("button", { name: t("原始碼", "Source"), exact: true })
            .click();
          await expect(preview.locator("iframe")).toBeHidden();
          await expect(preview.locator(".html-preview-note")).toBeHidden();
          await expect(preview.locator("pre")).toContainText(
            'src="modules/main.mjs"',
          );
          await preview
            .getByRole("button", { name: t("預覽", "Preview"), exact: true })
            .click();
          await expect(frame.locator("#result")).toHaveText("NT$ 250.00");
          await expect(frame.locator("#note")).toHaveValue(
            "尚未送出的旅程草稿",
          );
          await expect(input).toHaveValue("保留下一句草稿");
          assert.equal(
            previewRequests.length,
            1,
            "source and expand preserve preview",
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          profiles.push({
            profile,
            previewReads: previewRequests.length,
            assetReads: assetRequests.length,
            statePreserved: true,
          });
          if (profiles.length === 1) {
            const waiting = page.waitForEvent("download");
            await preview
              .getByRole("link", { name: "下載完整網頁", exact: true })
              .click();
            const download = await waiting;
            assert.equal(download.suggestedFilename(), "旅費試算.zip");
            const bytes = await readFile((await download.path())!);
            await writeFile(join(output, "旅費試算.zip"), bytes);
            const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
            assert.deepEqual(Object.keys(zip.files), Object.keys(sources));
            const extracted = new Workspace(join(directory, "download"), true);
            for (const [path, text] of Object.entries(sources)) {
              const content = await zip.file(path)!.async("nodebuffer");
              assert.equal(content.toString("utf8"), text);
              await writeFile(await extracted.resolve(path, true), content);
            }
            const types: Record<string, string> = {
              ".html": "text/html; charset=utf-8",
              ".css": "text/css",
              ".mjs": "text/javascript",
              ".json": "application/json",
              ".svg": "image/svg+xml",
            };
            const staticServer = createServer(async (req, res) => {
              try {
                const path = decodeURIComponent(
                  new URL(req.url!, "http://localhost").pathname,
                ).slice(1);
                if (req.method !== "GET" || !(path in sources)) {
                  res.writeHead(404);
                  res.end();
                  return;
                }
                res.writeHead(200, { "Content-Type": types[extname(path)] });
                res.end(await readFile(await extracted.resolve(path)));
              } catch {
                res.writeHead(500);
                res.end();
              }
            });
            staticServer.listen(0, "127.0.0.1");
            await once(staticServer, "listening");
            try {
              const standalone = await context.newPage();
              watch(standalone);
              await standalone.goto(
                `http://127.0.0.1:${(staticServer.address() as AddressInfo).port}/${entry}`,
              );
              await expect(standalone.locator("#ready")).toHaveText(
                "匯率已就緒",
              );
              await standalone.locator("#amount").fill("320");
              await standalone.locator("button").click();
              await expect(standalone.locator("#result")).toHaveText(
                "NT$ 400.00",
              );
              await standalone.screenshot({
                path: join(output, "downloaded-app.png"),
              });
              await standalone.close();
            } finally {
              staticServer.closeAllConnections();
              await new Promise<void>((r) => staticServer.close(() => r()));
            }
          }
        } finally {
          await context.close();
        }
      }
    }
  }

  // Exercise the real gateway and browser's Secure/SameSite/opaque-origin
  // behavior without opening a public tunnel. Only idle SSE is a finite fixture.
  app.product.settings.update(
    { locale: "zh-Hant" },
    app.product.settings.read().revision,
  );
  const shareOrigin = "https://apsis-bundle-test.trycloudflare.com";
  const password = randomUUID();
  const gateway = createShareGateway({ upstreamPort: port, password });
  gateway.setPublicOrigin(shareOrigin);
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const gatewayPort = (gateway.server.address() as AddressInfo).port;
  const proxy = (
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: Buffer,
  ) =>
    new Promise<{
      status: number;
      headers: Record<string, string>;
      body: Buffer;
    }>((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port: gatewayPort, path, method, headers },
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
      request.on("error", reject);
      request.end(body);
    });
  const shared = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    // Browser routing does not intercept every hop of a redirected request.
    // Authenticate against the real gateway first, then install its real Secure
    // cookie for the fixture HTTPS origin (as in the work-file verifier).
    const login = await proxy(
      "/__share/login",
      "POST",
      {
        host: new URL(shareOrigin).host,
        origin: shareOrigin,
        "content-type": "application/x-www-form-urlencoded",
      },
      Buffer.from(new URLSearchParams({ password }).toString()),
    );
    assert.equal(login.status, 303);
    const cookie = login.headers["set-cookie"].split(";")[0];
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
      const request = route.request(),
        url = new URL(request.url());
      if (url.pathname === "/api/v2/events") {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: ": idle fixture\n\n",
        });
        return;
      }
      await route.fulfill(
        await proxy(
          url.pathname + url.search,
          request.method(),
          { ...(await request.allHeaders()), host: url.host },
          request.postDataBuffer() || undefined,
        ),
      );
    });
    const remote = await shared.newPage();
    watch(remote);
    await remote.goto(shareOrigin);
    await remote.locator(`.bot-row[title="${bot.name}"]`).click();
    await remote.locator(".message.assistant .artifact-card").click();
    const remotePreview = remote.locator(".artifact-preview"),
      remoteFrame = remotePreview.frameLocator("iframe");
    await exercise(remoteFrame, "160", "NT$ 200.00");
    await remote.screenshot({ path: join(output, "authenticated-share.png") });
    const source = await remotePreview.locator("iframe").getAttribute("src");
    const capability = new URL(source!, shareOrigin);
    const opaque = {
      host: new URL(shareOrigin).host,
      origin: "null",
      "sec-fetch-site": "cross-site",
    };
    assert.equal((await proxy(capability.pathname, "GET", opaque)).status, 200);
    await remote.evaluate(async () => {
      await fetch("/__share/logout", {
        method: "POST",
        headers: { "X-Apsis-Client": "1" },
        redirect: "manual",
      });
    });
    assert.equal(
      (await proxy(capability.pathname, "GET", opaque)).status,
      401,
      "logout revokes cookie-less capability access",
    );
  } finally {
    await shared.close();
    gateway.server.closeAllConnections();
    await new Promise<void>((r) => gateway.server.close(() => r()));
  }

  // Reference the complete immutable app into a new topic, send it and use the
  // product's verification tool again against the copied module/data tree.
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  watch(page);
  const newTopic = app.product.messages.newContext(bot.id);
  await page.goto(base);
  await page.locator(`.bot-row[title="${bot.name}"]`).click();
  const artifact = app.product.queries.detail(bot.id).artifacts[0]!;
  const reference = await page.request.post(
    `${base}/api/v2/bots/${bot.id}/artifact-reference`,
    {
      headers: { "X-Apsis-Client": "1" },
      data: {
        artifactId: artifact.id,
        contextId: newTopic.id,
      },
    },
  );
  assert.equal(reference.status(), 200);
  const ref = await reference.json();
  const referencedWorkspace = app.tasks.locations.workspace(
    app.tasks.locations.get(ref.locationId),
  );
  const prefix = ref.path.slice(0, -entry.length);
  for (const [path, text] of Object.entries(sources))
    assert.equal(await referencedWorkspace.read(prefix + path), text);
  // Exercise the existing preview's real reference button in the new topic.
  await page.getByRole("button", { name: "切換工作內容", exact: true }).click();
  await page.getByRole("button", { name: "檔案", exact: true }).click();
  await page
    .getByRole("button", { name: `預覽成果 ${name}`, exact: true })
    .click();
  await page
    .locator(".artifact-preview")
    .getByRole("button", { name: "引用給 Bot", exact: true })
    .click();
  await expect(page.locator(".attachment-chips")).toContainText(name);
  await page
    .getByRole("textbox", { name: "傳送訊息", exact: true })
    .fill("繼續修改這份網頁");
  await page.locator(".composer-send-actions .send").click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "已收到完整網頁引用",
    { timeout: 15000 },
  );
  const policyPage = await browser.newPage();
  const expectedFormPolicyErrors: string[] = [],
    externalFormRequests: string[] = [];
  policyPage.on("pageerror", (error) => errors.push(error.message));
  policyPage.on("console", (message) => {
    if (message.type() === "error")
      expectedFormPolicyErrors.push(message.text());
  });
  policyPage.on("request", (request) => {
    if (request.url().startsWith("https://example.invalid"))
      externalFormRequests.push(request.url());
  });
  await policyPage.goto(base);
  const policyPreview = await (
    await policyPage.request.get(
      `${base}/api/v2/artifacts/${artifact.id}/preview`,
    )
  ).json();
  await policyPage.locator("body").evaluate((body, url) => {
    const frame = document.createElement("iframe");
    frame.title = "form policy test";
    frame.sandbox.add("allow-scripts", "allow-forms");
    frame.src = url;
    body.appendChild(frame);
  }, policyPreview.previewUrl);
  const policyFrame = policyPage.frameLocator(
    'iframe[title="form policy test"]',
  );
  await expect(policyFrame.locator("#ready")).toHaveText("匯率已就緒");
  let blockedNavigation = "";
  try {
    await policyFrame.locator("body").evaluate(() => {
      const form = document.createElement("form");
      form.action = "https://example.invalid/capture";
      form.method = "POST";
      document.body.appendChild(form);
      form.submit();
    });
  } catch (error) {
    // Chromium may replace a blocked navigation with its internal error page.
    // Observe the browser's CSP error and network in the parent, never a promise
    // kept inside a browsing context that can be destroyed by this probe.
    blockedNavigation = String(error);
    assert.match(blockedNavigation, /Execution context was destroyed/);
  }
  await expect.poll(() => expectedFormPolicyErrors.length > 0).toBe(true);
  assert.deepEqual(externalFormRequests, []);
  assert.ok(
    expectedFormPolicyErrors.some(
      (message) =>
        message.includes("form-action 'none'") &&
        message.includes("https://example.invalid/capture"),
    ),
  );
  assert.ok(
    expectedFormPolicyErrors.every(
      (message) =>
        (message.startsWith(
          "Sending form data to 'https://example.invalid/capture'",
        ) &&
          message.includes("form-action 'none'")) ||
        (message.startsWith("Framing 'https://example.invalid/'") &&
          message.includes("frame-src 'self' data:")),
    ),
    "only this negative probe's exact CSP failures may be recorded separately",
  );
  await policyPage.close();
  assert.deepEqual(errors, []);
  assert.equal(
    app.product.db.jobs.list().filter((job) => job.status === "completed")
      .length,
    2,
  );
  const report = {
    passed: true,
    profiles,
    audits,
    errors,
    formPolicy: {
      attemptedTarget: "https://example.invalid/capture",
      blockedNavigation,
      expectedFormPolicyErrors,
      externalFormRequests,
    },
    checks: [
      "7-file CSS imports, ES modules, SVG and JSON after original files changed/deleted",
      "immutable ZIP decoded with CRCs and executed on a separate local static server",
      "no eager asset reads; expand/source/Escape preserve inputs and computed results",
      "sandbox parent/storage blocked; authenticated share and logout revocation",
      "all 7 files referenced into a new topic and verify_web executed there",
      "local form submission works; an external form is blocked by CSP before a network request",
    ],
    scope:
      "deterministic isolated runner; Chromium only; no external model calls; share HTTPS routed locally; idle SSE finite fixture; default axe CSS preload makes document-relative imported CSS requests, with exact scanner errors preserved separately",
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    `PASS published bundle: ${profiles.length} profiles, independent ZIP, standalone app, authenticated share and new-topic verification.`,
  );
} finally {
  await browser.close();
  await app.product.close();
  app.server.closeAllConnections();
  await new Promise<void>((r) => app.server.close(() => r()));
}
