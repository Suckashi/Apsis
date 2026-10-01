import MarkdownIt from "markdown-it";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  NumberFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type INumberingOptions,
  type ParagraphChild,
} from "docx";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { browserExecutable } from "./bot-browser.ts";

export type DocumentContentFormat = "plain" | "markdown";
const markdown = new MarkdownIt({ html: false, breaks: true });
type Token = ReturnType<typeof markdown.parse>[number];
const escape = markdown.utils.escapeHtml;
// Document export never loads model-supplied images or executes supplied HTML.
markdown.renderer.rules.image = (tokens, index) =>
  escape(`[圖片：${tokens[index].content || "未提供說明"}]`);

function inline(
  tokens: Token[],
  strong = false,
  emphasis = false,
  deleted = false,
  linked = false,
): ParagraphChild[] {
  const result: ParagraphChild[] = [];
  let bold = strong ? 1 : 0;
  let italic = emphasis ? 1 : 0;
  let strike = deleted ? 1 : 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "strong_open") bold++;
    else if (token.type === "strong_close") bold--;
    else if (token.type === "em_open") italic++;
    else if (token.type === "em_close") italic--;
    else if (token.type === "s_open") strike++;
    else if (token.type === "s_close") strike--;
    else if (token.type === "link_open") {
      const end = tokens.findIndex((t, n) => n > i && t.type === "link_close");
      if (end > i) {
        result.push(
          new ExternalHyperlink({
            link: String(token.attrGet("href") || ""),
            children: inline(
              tokens.slice(i + 1, end),
              bold > 0,
              italic > 0,
              strike > 0,
              true,
            ),
          }),
        );
        i = end;
      }
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      result.push(new TextRun({ break: 1 }));
    } else if (["text", "code_inline", "image"].includes(token.type)) {
      result.push(
        new TextRun({
          text:
            token.type === "image"
              ? `[圖片：${token.content || "未提供說明"}]`
              : token.content,
          bold: bold > 0,
          italics: italic > 0,
          strike: strike > 0,
          ...(linked ? { style: "Hyperlink" } : {}),
          ...(token.type === "code_inline" ? { font: "Consolas" } : {}),
        }),
      );
    }
  }
  return result;
}

export async function exportDocx(
  content: string,
  title: string,
  contentFormat: DocumentContentFormat,
) {
  const children: (Paragraph | Table)[] = [];
  const numbering: INumberingOptions["config"][number][] = [];
  const lists: { reference: string; first: boolean; depth: number }[] = [];
  let quote = 0;
  const tokens =
    contentFormat === "markdown" ? markdown.parse(content, {}) : [];
  if (contentFormat === "plain") {
    for (const text of content.split(/\r?\n/))
      children.push(new Paragraph(text));
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (["bullet_list_open", "ordered_list_open"].includes(token.type)) {
      const reference = `list-${numbering.length}`;
      const depth = lists.length;
      const ordered = token.type === "ordered_list_open";
      numbering.push({
        reference,
        levels: [
          {
            level: 0,
            format: ordered ? NumberFormat.DECIMAL : NumberFormat.BULLET,
            text: ordered ? "%1." : "•",
            start: Number(token.attrGet("start") || 1),
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (depth + 1), hanging: 240 } },
            },
          },
        ],
      });
      lists.push({ reference, first: false, depth });
    } else if (
      ["bullet_list_close", "ordered_list_close"].includes(token.type)
    ) {
      lists.pop();
    } else if (token.type === "list_item_open") {
      if (lists.length) lists.at(-1)!.first = true;
    } else if (token.type === "blockquote_open") quote++;
    else if (token.type === "blockquote_close") quote--;
    else if (token.type === "heading_open" || token.type === "paragraph_open") {
      const next = tokens[i + 1];
      if (next?.type !== "inline") continue;
      const list = lists.at(-1);
      const level = token.type === "heading_open" ? Number(token.tag[1]) : 0;
      const headings = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ];
      children.push(
        new Paragraph({
          children: inline(next.children || []),
          ...(level
            ? {
                heading:
                  level === 1 && children.length === 0
                    ? HeadingLevel.TITLE
                    : headings[level - 1],
                keepNext: true,
              }
            : list?.first
              ? { numbering: { reference: list.reference, level: 0 } }
              : {}),
          ...(!level && list ? { spacing: { after: 40, line: 348 } } : {}),
          ...(!list?.first && list
            ? { indent: { left: 360 * (list.depth + 1) } }
            : quote
              ? { indent: { left: 360 * quote } }
              : {}),
        }),
      );
      if (list) list.first = false;
      i += 2;
    } else if (["fence", "code_block"].includes(token.type)) {
      for (const line of token.content.replace(/\n$/, "").split("\n")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: "Consolas", size: 22 })],
            spacing: { after: 0, line: 300 },
          }),
        );
      }
    } else if (token.type === "hr") {
      children.push(
        new Paragraph({
          border: {
            bottom: { color: "D9D9D9", style: BorderStyle.SINGLE, size: 4 },
          },
        }),
      );
    } else if (token.type === "table_open") {
      const rows: TableRow[] = [];
      let cells: TableCell[] = [];
      let header = false;
      while (++i < tokens.length && tokens[i].type !== "table_close") {
        const cell = tokens[i];
        if (cell.type === "thead_open") header = true;
        else if (cell.type === "thead_close") header = false;
        else if (cell.type === "tr_open") cells = [];
        else if (cell.type === "tr_close")
          rows.push(
            new TableRow({
              children: cells,
              ...(header ? { tableHeader: true } : {}),
            }),
          );
        else if (cell.type === "inline")
          cells.push(
            new TableCell({
              children: [
                new Paragraph({
                  children: inline(cell.children || [], header),
                  spacing: { after: 0 },
                }),
              ],
              verticalAlign: VerticalAlign.CENTER,
              ...(header ? { shading: { fill: "EEF0F3" } } : {}),
            }),
          );
      }
      const border = { color: "D9D9D9", style: BorderStyle.SINGLE, size: 4 };
      children.push(
        new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          borders: {
            top: border,
            bottom: border,
            left: border,
            right: border,
            insideHorizontal: border,
            insideVertical: border,
          },
        }),
      );
    }
  }
  return Packer.toBuffer(
    new Document({
      title,
      styles: {
        default: {
          title: {
            run: { size: 36, bold: true, color: "20242B" },
            paragraph: { spacing: { before: 0, after: 180 }, keepNext: true },
          },
          document: {
            run: {
              font: { ascii: "Calibri", eastAsia: "Microsoft JhengHei" },
              size: 22,
              color: "20242B",
            },
            paragraph: { spacing: { after: 100, line: 348 } },
          },
          heading1: {
            run: { size: 36, bold: true, color: "20242B" },
            paragraph: { spacing: { before: 0, after: 180 }, keepNext: true },
          },
          heading2: {
            run: { size: 28, bold: true, color: "20242B" },
            paragraph: { spacing: { before: 160, after: 80 }, keepNext: true },
          },
          heading3: { run: { size: 24, bold: true, color: "20242B" } },
        },
      },
      numbering: { config: numbering },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
            },
          },
          children,
        },
      ],
    }),
  );
}

export function documentHtml(
  content: string,
  title: string,
  contentFormat: DocumentContentFormat,
) {
  const body =
    contentFormat === "markdown"
      ? markdown.render(content)
      : `<div class="plain">${escape(content)}</div>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>
    @page { size:A4; margin:20mm; }
    * { box-sizing:border-box; }
    body { margin:0; color:#20242b; font:11pt/1.45 Calibri,"Microsoft JhengHei","Noto Sans CJK TC",sans-serif; overflow-wrap:anywhere; }
    h1,h2,h3,h4,h5,h6 { color:inherit; font-weight:700; break-after:avoid; line-height:1.3; }
    h1 { font-size:18pt; margin:0 0 9pt; }
    h2 { font-size:14pt; margin:8pt 0 4pt; }
    h3,h4,h5,h6 { font-size:12pt; margin:8pt 0 4pt; }
    p { margin:0 0 5pt; orphans:2; widows:2; }
    ul,ol { margin:0 0 5pt; padding-left:18pt; }
    li { margin:0 0 2pt; }
    li p { margin:0; }
    blockquote { margin:5pt 0 5pt 18pt; }
    pre,.plain { white-space:pre-wrap; }
    pre,code { font-family:Consolas,monospace; font-size:11pt; }
    a { color:inherit; text-decoration:underline; }
    table { width:100%; border-collapse:collapse; margin:8pt 0; }
    th,td { border:0.5pt solid #d9d9d9; padding:5pt 6pt; vertical-align:middle; }
    th { background:#eef0f3; text-align:left; }
    thead { display:table-header-group; }
    tr { break-inside:avoid; }
    hr { border:0; border-top:0.5pt solid #d9d9d9; margin:8pt 0; }
  </style></head><body>${body}</body></html>`;
}

export async function exportPdf(
  file: string,
  content: string,
  title: string,
  contentFormat: DocumentContentFormat,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
  });
  const abort = () => void browser.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(documentHtml(content, title, contentFormat));
    await page.pdf({
      path: file,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
      printBackground: true,
    });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
    await browser.close();
  }
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({ data: new Uint8Array(await readFile(file)) });
  try {
    return (await loading.promise).numPages;
  } finally {
    await loading.destroy();
  }
}
