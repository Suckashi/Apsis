import { english } from "./translations.ts";

export type Locale = "zh-TW" | "en";
export const languageKey = "apsis-language";
export function parseLocale(value: unknown): Locale {
  return value === "en" ? "en" : "zh-TW";
}
function readLocale(): Locale {
  try {
    return parseLocale(localStorage.getItem(languageKey));
  } catch {
    return "zh-TW";
  }
}
export const locale = readLocale();

export function translate(
  language: Locale,
  source: string,
  ...values: unknown[]
): string {
  const template =
    language === "en" && Object.hasOwn(english, source)
      ? english[source]!
      : source;
  // A single pass keeps placeholders inside user values intact.
  return template.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
export const t = (source: string, ...values: unknown[]) =>
  translate(locale, source, ...values);

// Call only for application-owned status/error messages, never conversation content.
export function translateServerText(source: string): string {
  return t(source);
}

export function saveLocale(
  value: Locale,
  storage?: Pick<Storage, "setItem" | "getItem">,
): boolean {
  try {
    const target = storage || localStorage;
    target.setItem(languageKey, value);
    return target.getItem(languageKey) === value;
  } catch {
    return false;
  }
}

// Run once, before any user data is rendered. No mutation observer or global
// replacement: saved names, messages, code and tool output are not UI strings.
export function initI18n(root: Document = document) {
  root.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
  function walk(node: Node) {
    if (node.nodeType === 3) {
      const text = node.textContent || "";
      const key = text.replace(/\s+/g, " ").trim();
      if (Object.hasOwn(english, key))
        node.textContent = text.replace(/\S[\s\S]*\S|\S/, () => t(key));
      return;
    }
    if (node instanceof Element) {
      if (["SCRIPT", "STYLE"].includes(node.tagName)) return;
      for (const name of ["title", "placeholder", "aria-label"]) {
        const value = node.getAttribute(name);
        if (value && Object.hasOwn(english, value))
          node.setAttribute(name, t(value));
      }
      if (node instanceof HTMLTemplateElement) walk(node.content);
    }
    for (const child of node.childNodes) walk(child);
  }
  walk(root);
}
