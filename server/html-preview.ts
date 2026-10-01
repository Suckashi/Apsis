import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ServerResponse } from "node:http";
import type { FileManager } from "./file-manager.ts";
import type { Artifact } from "../shared/product.ts";
import { Workspace } from "./workspace.ts";
import { previewEscapeScript } from "../shared/preview-escape.ts";

// A capability is required because sandboxed frames load assets with an opaque
// origin. Never relax the application's origin checks for ordinary file APIs.
export const htmlPreviewRoute =
  /^\/api\/v2\/work-locations\/([^/]+)\/html\/([a-f0-9]{48})\/(.+)$/;
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const fail = (message: string, status: number): never => {
  throw Object.assign(new Error(message), { status });
};

export class HtmlPreview {
  private tokens = new Map<string, string>();

  url(id: string, path: string) {
    let token = this.tokens.get(id);
    if (!token) {
      token = randomBytes(24).toString("hex");
      this.tokens.set(id, token);
    }
    return `/api/v2/work-locations/${encodeURIComponent(id)}/html/${token}/${path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`;
  }

  async serve(
    pathname: string,
    host: string,
    files: FileManager,
    res: ServerResponse,
    published?: { get: (id: string) => Artifact | undefined; root: string },
  ) {
    const match = pathname.match(htmlPreviewRoute);
    if (!match) return false;
    let id: string, path: string;
    try {
      id = decodeURIComponent(match[1]);
      path = decodeURIComponent(match[3]);
    } catch {
      return fail("無效的預覽路徑。", 400);
    }
    const token = this.tokens.get(id);
    if (!token || !timingSafeEqual(Buffer.from(token), Buffer.from(match[2])))
      fail("找不到檔案預覽，請重新整理。", 404);
    const type = mime[extname(path).toLowerCase()];
    if (!type) fail("此格式不支援網頁預覽。", 415);
    const bundled = id.startsWith("artifact-");
    let full: string;
    if (bundled) {
      const artifact = published?.get(id.slice("artifact-".length));
      if (!artifact?.bundle || !published) fail("找不到成果預覽。", 404);
      const normalized = path
        .replaceAll("\\", "/")
        .split("/")
        .filter((part) => part && part !== ".")
        .join("/");
      const file = artifact!.bundle!.files.find(
        (file) => file.path === normalized,
      );
      if (!file) fail("此檔案不在已發布的網頁資源中。", 404);
      full = await new Workspace(published!.root).resolve(file!.snapshotPath);
    } else full = await files.download(id, path);
    if ((await stat(full)).size > 20 * 1024 * 1024)
      fail("網頁預覽檔案上限為 20 MB。", 413);
    const scope = `http://${host}/api/v2/work-locations/${encodeURIComponent(id)}/html/${token}/`;
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": "null",
      "Content-Security-Policy": [
        "sandbox allow-scripts allow-forms",
        "default-src 'none'",
        `script-src 'unsafe-inline' ${scope}${bundled ? "" : " https:"}`,
        `style-src 'unsafe-inline' ${scope}${bundled ? "" : " https:"}`,
        `img-src ${scope}${bundled ? "" : " https:"} data: blob:`,
        `font-src ${scope}${bundled ? "" : " https:"} data:`,
        bundled ? `connect-src ${scope}` : "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
    });
    const stream = createReadStream(full).on("error", () => res.destroy());
    if (/\.html?$/i.test(path)) {
      stream.on("end", () => res.end(previewEscapeScript));
      stream.pipe(res, { end: false });
    } else stream.pipe(res);
    return true;
  }
}
