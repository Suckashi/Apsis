/** Reading structure only: no HTML, scripts, styles or embedded resource URLs. */
export type DocumentTag =
  | "p"
  | "span"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "strong"
  | "em"
  | "u"
  | "s"
  | "sub"
  | "sup"
  | "br"
  | "ul"
  | "ol"
  | "li"
  | "blockquote"
  | "pre"
  | "code"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "a";

export type DocumentNode =
  | string
  | {
      tag: DocumentTag;
      children: DocumentNode[];
      href?: string;
      id?: string;
      start?: number;
      colSpan?: number;
      rowSpan?: number;
    };

export interface DocumentReadingPreview {
  text: string;
  document?: DocumentNode[];
  truncated: boolean;
}
