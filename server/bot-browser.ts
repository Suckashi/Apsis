import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import { existsSync } from "node:fs";

export function browserExecutable() {
  if (existsSync(chromium.executablePath())) return undefined;
  return [
    process.env.APSIS_BROWSER_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((path): path is string => !!path && existsSync(path));
}

export class BotBrowser {
  directory: string;
  context?: BrowserContext;
  opening?: Promise<BrowserContext>;
  pages = new Map<string, Page>();
  owner?: string;
  constructor(directory: string) {
    this.directory = join(directory, "browser");
  }
  async page(botId: string) {
    if (this.owner) throw new Error("使用者正在接管瀏覽器，請等待交還控制權。");
    if (!this.context) {
      this.opening ||= chromium.launchPersistentContext(this.directory, {
        executablePath: browserExecutable(),
        headless: true,
        viewport: { width: 1280, height: 800 },
      });
      try {
        this.context = await this.opening;
      } finally {
        this.opening = undefined;
      }
    }
    let page = this.pages.get(botId);
    if (!page || page.isClosed()) {
      page = await this.context.newPage();
      this.pages.set(botId, page);
    }
    return page;
  }
  async act(botId: string, input: Record<string, string>) {
    const page = await this.page(botId);
    page.setDefaultTimeout(15000);
    if (input.action === "navigate") {
      const url = new URL(input.url);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("只允許 HTTP 網頁。");
      await page.goto(url.href, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } else if (input.action === "click")
      await page.locator(input.selector).click();
    else if (input.action === "fill")
      await page.locator(input.selector).fill(input.text);
    else if (input.action === "press")
      await page.locator(input.selector).press(input.text);
    else if (input.action !== "read") throw new Error("未知瀏覽器動作。");
    return {
      url: page.url(),
      title: await page.title(),
      text: (await page.locator("body").innerText()).slice(0, 24000),
      controls: await page
        .locator("a,button,input,textarea,select")
        .evaluateAll((nodes) =>
          nodes
            .slice(0, 100)
            .map((n) => ({
              tag: n.tagName,
              text: n.textContent?.slice(0, 100),
              id: n.id,
              name: n.getAttribute("name"),
              href: n.getAttribute("href"),
              placeholder: n.getAttribute("placeholder"),
            })),
        ),
    };
  }
  async screenshot(botId: string) {
    const page = this.pages.get(botId);
    if (!page || page.isClosed()) return undefined;
    return page.screenshot({ type: "jpeg", quality: 65 });
  }
  async takeover(botId: string, take: boolean) {
    const urls = [...this.pages].map(([id, page]) => [id, page.url()] as const);
    await this.context?.close();
    this.context = undefined;
    this.pages.clear();
    this.owner = take ? botId : undefined;
    this.context = await chromium.launchPersistentContext(this.directory, {
      executablePath: browserExecutable(),
      headless: !take,
      viewport: { width: 1280, height: 800 },
    });
    for (const [id, url] of urls) {
      const page = await this.context.newPage();
      this.pages.set(id, page);
      await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
    }
    if (take)
      await (
        this.pages.get(botId) || (await this.context.newPage())
      ).bringToFront();
  }
  async close() {
    await this.context?.close();
  }
}
