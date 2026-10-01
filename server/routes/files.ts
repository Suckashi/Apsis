import { parseRequest, fileRequestSchemas } from "../request-schema.ts";
import { basename, extname } from "node:path";
import { createReadStream } from "node:fs";
import { previewDocx } from "../docx-preview.ts";

import { fail, string, reply } from "../product-support.ts";

import type { RouteDependencies, RequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  "files" | "htmlPreview" | "notify" | "readDocument" | "tasks"
>;
export class FileRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: RequestContext): Promise<boolean> {
    const { req, res, url, path, method, body } = context;
    if (path === "/work-locations" && method === "GET") {
      reply(res, this.deps.tasks.locations.list());
      return true;
    }
    const files = path.match(
      /^\/work-locations\/([^/]+)\/(files|status|content|download|preview|directory|move|upload|trash|restore)$/,
    );
    if (files) {
      const id = files[1],
        action = files[2],
        filePath = url.searchParams.get("path") || "";
      if (method === "GET") {
        if (action === "status") {
          reply(res, await this.deps.files.status(id, filePath));
          return true;
        }
        if (action === "files") {
          reply(
            res,
            await this.deps.files.list(
              id,
              filePath,
              Number(url.searchParams.get("offset") || 0),
            ),
          );
          return true;
        }
        if (action === "content") {
          const content = await this.deps.files.read(id, filePath);
          reply(res, {
            ...content,
            ...(content.editable && /\.html?$/i.test(filePath)
              ? { previewUrl: this.deps.htmlPreview.url(id, filePath) }
              : {}),
          });
          return true;
        }
        if (action === "trash") {
          reply(res, this.deps.files.trash(id));
          return true;
        }
        if (action === "download" || action === "preview") {
          const full = await this.deps.files.download(id, filePath);
          const extension = extname(filePath).toLowerCase();
          if (action === "preview" && [".docx", ".xlsx"].includes(extension)) {
            if (extension === ".docx") {
              reply(res, await previewDocx(full));
              return true;
            }
            reply(res, {
              text: await this.deps.readDocument(
                filePath,
                this.deps.tasks.locations.workspace(
                  this.deps.tasks.locations.get(id),
                ),
              ),
            });
            return true;
          }
          const previewMime: Record<string, string> = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".pdf": "application/pdf",
          };
          res.writeHead(200, {
            "Content-Type":
              action === "preview"
                ? previewMime[extension] || "text/plain; charset=utf-8"
                : "application/octet-stream",
            "Content-Disposition": `${action === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`,
            "Content-Security-Policy":
              extension === ".pdf"
                ? "default-src 'none'"
                : "default-src 'none'; sandbox",
          });
          createReadStream(full)
            .on("error", () => res.destroy())
            .pipe(res);
          return true;
        }
      }
      if (action === "upload" && method === "POST") {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) fail("檔案超過 20 MB。", 413);
          chunks.push(chunk);
        }
        const result = await this.deps.files.upload(
          id,
          filePath,
          Buffer.concat(chunks),
        );
        this.deps.notify();
        reply(res, result, 201);
        return true;
      }
      const schema = fileRequestSchemas[`${method}:${action}`];
      if (!schema) fail("找不到檔案操作。", 404);
      const input = parseRequest(schema, await body(req));
      let result: unknown;
      if (action === "content" && method === "PUT")
        result = await this.deps.files.save(
          id,
          string(input.path, 4096),
          input.content as string,
          input.revision,
        );
      else if (action === "directory" && method === "POST")
        result = await this.deps.files.createDirectory(
          id,
          string(input.path, 4096),
        );
      else if (action === "move" && method === "POST")
        result = await this.deps.files.move(
          id,
          string(input.path, 4096),
          string(input.to, 4096),
          typeof input.revision === "string" ? input.revision : undefined,
        );
      else if (action === "trash" && method === "POST")
        result = await this.deps.files.remove(id, string(input.path, 4096));
      else if (action === "restore" && method === "POST")
        result = await this.deps.files.restore(
          id,
          string(input.id, 100),
          typeof input.path === "string" ? input.path : undefined,
        );
      else {
        fail("找不到檔案操作。", 404);
        return true;
      }
      this.deps.notify();
      reply(res, result);
      return true;
    }
    return false;
  }
}
