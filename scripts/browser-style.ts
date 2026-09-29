import type { Page } from "playwright";

/** Test-only accessibility styles must obey the page's real CSP. */
export function fixtureStyle(page: Page, { content }: { content: string }) {
  return page.evaluateHandle((css) => {
    const style = document.createElement("style");
    style.nonce =
      document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')
        ?.content || "";
    style.textContent = css;
    document.head.append(style);
    return style;
  }, content);
}
