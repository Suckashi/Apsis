import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { Workspace } from "./workspace.ts";
import { browserExecutable } from "./bot-browser.ts";
import type {
  WebCheckStep,
  WebVerification,
} from "../shared/coding-verification.ts";

const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
const mime: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const maxErrors = 40;
const maxRequests = 200;
const maxAssetBytes = 5_000_000;
const maxTotalBytes = 20_000_000;

async function assertRendered(
  element: Locator,
  step: WebCheckStep,
  timeout: number,
  signal: AbortSignal,
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    signal.throwIfAborted();
    const actual =
      step.action === "expect_text"
        ? (await element.innerText()).trim()
        : await element.inputValue();
    const matches =
      step.action === "expect_text"
        ? actual.includes(step.value!)
        : actual === step.value;
    if (matches) return;
    if (Date.now() >= deadline)
      throw new Error(
        `預期${step.action === "expect_text" ? "包含" : "值"}「${step.value}」，實際為「${actual.slice(0, 300)}」`,
      );
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  }
}

export function parseWebSteps(input: unknown): WebCheckStep[] {
  const steps = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(steps) || !steps.length || steps.length > 40)
    throw new Error(
      "請提供 1–40 個網頁操作，並至少包含一個 expect_text、expect_value 或 expect_visible 檢查。",
    );
  for (const s of steps) {
    if (
      !s ||
      ![
        "fill",
        "click",
        "press",
        "expect_text",
        "expect_value",
        "expect_visible",
      ].includes(s.action) ||
      typeof s.selector !== "string" ||
      !s.selector.trim() ||
      s.selector.length > 500 ||
      (s.value !== undefined &&
        (typeof s.value !== "string" || s.value.length > 2000)) ||
      (["fill", "press", "expect_text", "expect_value"].includes(s.action) &&
        typeof s.value !== "string")
    )
      throw new Error(
        "網頁操作需包含 action、CSS selector，以及需要時的 value。",
      );
    if (s.action === "expect_text" && !s.value.trim())
      throw new Error("文字檢查不可使用空白預期值。");
  }
  if (!steps.some((s) => s.action.startsWith("expect_")))
    throw new Error("只有點擊或載入不能視為驗證通過；請加入預期結果檢查。");
  return steps;
}

export async function verificationStale(
  root: string,
  receipt: WebVerification,
) {
  const workspace = new Workspace(root);
  for (const [path, hash] of Object.entries(receipt.files)) {
    try {
      if (digest(await readFile(await workspace.resolve(path))) !== hash)
        return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** A disposable browser with only this workspace's static assets accessible. */
export async function verifyWeb(
  root: string,
  workContextId: string,
  runId: string,
  path: string,
  input: unknown,
  signal?: AbortSignal,
  options: { timeoutMs?: number; assertionTimeoutMs?: number } = {},
): Promise<WebVerification> {
  const steps = parseWebSteps(input);
  const workspace = new Workspace(root);
  await workspace.resolve(path);
  if (!/\.html?$/i.test(path))
    throw new Error(
      "請指定工作區內的 HTML 相對路徑，例如 index.html。此檢查適用於靜態網頁。",
    );
  const receipt: WebVerification = {
    id: randomUUID(),
    workContextId,
    runId,
    path,
    checkedAt: new Date().toISOString(),
    status: "failed",
    assertions: 0,
    steps: steps.map((s) => ({ ...s, status: "skipped" })),
    errors: [],
    files: {},
  };
  const errorText = (error: unknown) =>
    (error instanceof Error ? error.message : String(error)).slice(0, 1500);
  const recordError = (error: unknown) => {
    if (receipt.errors.length < maxErrors)
      receipt.errors.push(errorText(error));
  };
  const controller = new AbortController();
  const assertionTimeout = Math.max(
    1,
    Math.min(3500, options.assertionTimeoutMs ?? 3500),
  );
  let requested = 0;
  let servedBytes = 0;
  const asset = async (url: string) => {
    let pathname = "";
    try {
      pathname = decodeURIComponent(
        new URL(url, "http://localhost").pathname,
      ).slice(1);
      const file = await workspace.resolve(pathname);
      const type = mime[extname(file).toLowerCase()];
      const info = await stat(file);
      if (!type || !info.isFile() || info.size > maxAssetBytes)
        throw new Error("unsupported asset");
      servedBytes += info.size;
      if (servedBytes > maxTotalBytes) {
        recordError("網頁資源超過 20 MB 驗證上限。");
        throw new Error("asset limit");
      }
      const data = await readFile(file);
      const hash = digest(data);
      if (receipt.files[pathname] && receipt.files[pathname] !== hash)
        recordError("驗證期間檔案變更，請重新檢查。");
      receipt.files[pathname] ||= hash;
      return {
        status: 200,
        headers: {
          "Content-Type": type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'",
        },
        body: data,
      };
    } catch {
      // Chromium may request this implicitly; an absent favicon says nothing
      // about the interactions being checked.
      return {
        status: pathname === "favicon.ico" ? 204 : 404,
        body: pathname === "favicon.ico" ? "" : "Asset unavailable",
      };
    }
  };
  const server = createServer(async (req, res) => {
    const response =
      req.method === "GET"
        ? await asset(req.url!)
        : { status: 405, body: "Read only" };
    res.writeHead(
      response.status,
      "headers" in response ? response.headers : undefined,
    );
    res.end(response.body);
  });
  let browser: Browser | undefined;
  const closeBrowser = () => {
    void browser?.close().catch(() => {});
  };
  const abort = () =>
    controller.abort(signal?.reason ?? new Error("網頁驗證已取消。"));
  const timer = setTimeout(
    () => controller.abort(new Error("網頁驗證逾時。")),
    Math.max(1, Math.min(60000, options.timeoutMs ?? 60000)),
  );
  controller.signal.addEventListener("abort", closeBrowser, { once: true });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    controller.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("無法啟動網頁驗證。");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      executablePath: browserExecutable(),
      headless: true,
      timeout: 15000,
      args: ["--js-flags=--max-old-space-size=128"],
    });
    controller.signal.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    await context.route("**/*", async (route) => {
      if (++requested > maxRequests) {
        recordError("網頁請求超過 200 次驗證上限。");
        return route.abort();
      }
      if (new URL(route.request().url()).origin !== origin) {
        recordError(
          `已阻擋工作區外的網路請求：${new URL(route.request().url()).origin}`,
        );
        return route.abort();
      }
      if (route.request().method() !== "GET") {
        recordError("靜態網頁驗證只允許讀取工作區資源。");
        return route.abort();
      }
      // Serve the exact bytes we fingerprint, bypassing host HTTP filters that
      // may inject scripts (for example AdGuard) even into loopback responses.
      return route.fulfill(await asset(route.request().url()));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(assertionTimeout);
    page.on("pageerror", recordError);
    page.on("console", (message) => {
      if (message.type() === "error") recordError(message.text());
    });
    await page.goto(
      `${origin}/${path.split(/[\\/]/).map(encodeURIComponent).join("/")}`,
      { waitUntil: "networkidle", timeout: 10000 },
    );
    for (const step of receipt.steps) {
      controller.signal.throwIfAborted();
      try {
        const element = page.locator(step.selector);
        if (step.action === "fill") await element.fill(step.value!);
        else if (step.action === "click") await element.click();
        else if (step.action === "press") await element.press(step.value!);
        else {
          await element.waitFor({ state: "visible" });
          if (step.action === "expect_text" || step.action === "expect_value")
            await assertRendered(
              element,
              step,
              assertionTimeout,
              controller.signal,
            );
          receipt.assertions++;
        }
        step.status = "passed";
      } catch (error) {
        step.status = "failed";
        step.error = errorText(error);
        break;
      }
    }
    controller.signal.throwIfAborted();
    if (await verificationStale(root, receipt))
      recordError("驗證期間檔案變更，請重新檢查。");
    receipt.status =
      receipt.steps.every((s) => s.status === "passed") &&
      !receipt.errors.length
        ? "passed"
        : "failed";
  } catch (error) {
    recordError(controller.signal.aborted ? controller.signal.reason : error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", closeBrowser);
    await browser?.close().catch(() => {});
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return receipt;
}
