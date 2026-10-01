import { readFile, stat } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import type {
  DocumentNode,
  DocumentTag,
  DocumentReadingPreview,
} from "../shared/document-preview.ts";
import { fail } from "./product-support.ts";

const tags = new Set<string>([
  "p",
  "span",
  "strong",
  "em",
  "u",
  "s",
  "sub",
  "sup",
  "br",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
]);
const excluded = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "svg",
  "math",
  "form",
]);
const identifier = (value: string) =>
  /^[a-zA-Z0-9_.:-]{1,150}$/.test(value) ? value : undefined;

/** Only the converter's XML-compatible fragment is parsed, entirely on the server. */
export function documentReadingNodes(html: string): DocumentNode[] {
  if (html.length > 500_000) throw new Error("Document preview too large");
  const parsed = new DOMParser({
    errorHandler: {
      warning: () => {
        throw new Error("Invalid document fragment");
      },
      error: () => {
        throw new Error("Invalid document fragment");
      },
      fatalError: () => {
        throw new Error("Invalid document fragment");
      },
    },
  }).parseFromString(`<document>${html}</document>`, "application/xml");
  const headings = Array.from(parsed.getElementsByTagName("*")).filter(
    (element) => /^h[1-6]$/.test(element.tagName),
  );
  const lowestHeading = Math.min(
    6,
    ...headings.map((element) => Number(element.tagName.slice(1))),
  );
  let count = 0;
  const children = (node: Node, depth: number): DocumentNode[] =>
    Array.from(node.childNodes).flatMap((child) => read(child, depth));
  const read = (node: Node, depth: number): DocumentNode[] => {
    if (++count > 20_000 || depth > 64)
      throw new Error("Document structure too large");
    if (node.nodeType === 3) return [node.nodeValue || ""];
    if (node.nodeType !== 1) return [];
    const element = node as Element;
    const originalTag = element.tagName.toLowerCase();
    if (excluded.has(originalTag)) return [];
    if (originalTag === "img")
      return element.getAttribute("alt")
        ? [element.getAttribute("alt")!.slice(0, 1000)]
        : [];
    const content = children(element, depth + 1);
    const tag = /^h[1-6]$/.test(originalTag)
      ? `h${Math.min(6, 2 + Number(originalTag.slice(1)) - lowestHeading)}`
      : originalTag;
    if (!tags.has(tag) && !/^h[2-6]$/.test(tag)) return content;
    const result: Exclude<DocumentNode, string> = {
      tag: tag as DocumentTag,
      children: content,
    };
    const id = identifier(element.getAttribute("id") || "");
    if (id) result.id = id;
    if (tag === "a") {
      const href = element.getAttribute("href") || "";
      if (href.startsWith("#") && identifier(href.slice(1))) result.href = href;
      else {
        try {
          const url = new URL(href);
          if (["https:", "http:", "mailto:"].includes(url.protocol))
            result.href = url.href;
        } catch {
          /* Invalid/relative links remain readable text. */
        }
      }
      if (!result.href)
        return id ? [{ tag: "span", id, children: content }] : content;
    }
    for (const [attribute, property] of [
      ["start", "start"],
      ["colspan", "colSpan"],
      ["rowspan", "rowSpan"],
    ] as const) {
      const value = element.getAttribute(attribute);
      if (value && /^\d{1,6}$/.test(value) && Number(value) > 0) {
        if (
          (attribute === "start" && tag === "ol") ||
          (attribute !== "start" && ["td", "th"].includes(tag))
        )
          result[property] = Math.min(
            Number(value),
            attribute === "start" ? 100_000 : 1000,
          );
      }
    }
    if (
      tag === "table" &&
      content.some((child) => typeof child !== "string" && child.tag === "tr")
    ) {
      result.children = [{ tag: "tbody", children: content }];
    }
    return [result];
  };
  return children(parsed.documentElement, 0);
}

/** Callers resolve and authorize the workspace/snapshot before providing this path. */
export async function previewDocx(
  file: string,
): Promise<DocumentReadingPreview> {
  if ((await stat(file)).size > 20 * 1024 * 1024) fail("文件超過 20 MB。");
  const buffer = await readFile(file);
  const mammoth = await import("mammoth");
  const [html, raw] = await Promise.all([
    mammoth.convertToHtml(
      { buffer },
      {
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        styleMap: ["p[style-name='Title'] => h1:fresh"],
        // Preserve alt text without reading embedded or external image resources.
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      },
    ),
    mammoth.extractRawText({ buffer }),
  ]);
  const text = raw.value.slice(0, 100_000);
  if (raw.value.length > 100_000) return { text, truncated: true };
  try {
    return {
      text,
      document: documentReadingNodes(html.value),
      truncated: false,
    };
  } catch {
    // Rich conversion may exceed the structure budget; the full text is still available.
    return { text, truncated: false };
  }
}
