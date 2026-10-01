import {
  parseRequest,
  approvalSchema,
  draftSchema,
  connectorSchema,
} from "../request-schema.ts";
import { randomUUID } from "node:crypto";
import { previewEscapeScript } from "../../shared/preview-escape.ts";

import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import type { ArtifactPreview } from "../../shared/api.ts";
import { previewDocx } from "../docx-preview.ts";

import { Workspace } from "../workspace.ts";

import type { Connector } from "../../shared/product.ts";

import { withConnector } from "../bot-connectors.ts";

import { now, fail, string, reply } from "../product-support.ts";

import type { RouteDependencies, RequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  | "connector"
  | "connectors"
  | "db"
  | "decide"
  | "notify"
  | "policy"
  | "readDocument"
  | "routine"
  | "runRoutine"
  | "tasks"
  | "htmlPreview"
  | "writableBot"
>;
export class OperationRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: RequestContext): Promise<boolean> {
    const { req, res, url, path, method, body } = context;
    const approval = path.match(/^\/approvals\/([^/]+)$/);
    if (approval && method === "POST") {
      this.deps.decide(
        approval[1],
        parseRequest(approvalSchema, await body(req)),
      );
      reply(res, { ok: true });
      return true;
    }
    const draftMatch = path.match(/^\/drafts\/([^/]+)$/);
    if (draftMatch && method === "POST") {
      const draft =
        this.deps.db.drafts.get(draftMatch[1]) || fail("找不到草稿。", 404);
      if (draft.status !== "draft") fail("草稿已處理，不會重複執行。", 409);
      const input = parseRequest(draftSchema, await body(req));
      if (this.deps.db.drafts.get(draft.id)?.status !== "draft")
        fail("草稿已處理，不會重複執行。", 409);
      this.deps.writableBot(draft.botId);
      if (input.action === "discard") draft.status = "discarded";
      else if (input.action === "send") {
        const argumentsText = string(input.arguments, 32000);
        let args: unknown;
        try {
          args = JSON.parse(argumentsText);
        } catch {
          fail("請填入有效的 JSON 參數。");
        }
        if (!args || typeof args !== "object" || Array.isArray(args))
          fail("參數需為 JSON 物件。");
        const connector = this.deps.connector(draft.connectorId);
        if (
          this.deps.policy(draft.botId, draft.runId, "mcp_call", {
            connectorId: draft.connectorId,
            tool: draft.tool,
            arguments: argumentsText,
          }).effect === "deny"
        )
          fail("這項操作被權限規則拒絕。", 403);
        draft.arguments = argumentsText;
        draft.status = "sending";
        this.deps.db.drafts.put(draft);
        this.deps.notify(draft.botId);
        try {
          const result = await withConnector(connector, (client) =>
            client.callTool(
              {
                name: draft.tool,
                arguments: args as Record<string, unknown>,
              },
              undefined,
              { timeout: connector.toolTimeoutMs ?? 60000 },
            ),
          );
          draft.status = result.isError ? "unknown" : "sent";
          draft.result = JSON.stringify(result).slice(0, 16000);
        } catch {
          draft.status = "unknown";
          draft.result = "無法確認外部操作結果。請先向服務確認，避免重複傳送。";
        }
      } else fail("未知草稿操作。");
      this.deps.db.drafts.put(draft);
      this.deps.notify(draft.botId);
      reply(res, draft);
      return true;
    }
    const routine = path.match(/^\/routines\/([^/]+)(?:\/(test))?$/);
    if (routine) {
      const r =
        this.deps.db.routines.get(routine[1]) || fail("找不到排程。", 404);
      if (method === "PATCH") {
        reply(res, await this.deps.routine(r.botId, await body(req), r.id));
        return true;
      }
      if (method === "POST" && routine[2]) {
        const job = await this.deps.runRoutine(r, randomUUID());
        r.history.push({ at: now(), jobId: job.id });
        this.deps.db.routines.put(r);
        reply(res, job);
        return true;
      }
      if (method === "DELETE") {
        this.deps.db.routines.remove(r.id);
        this.deps.notify(r.botId);
        reply(res, { ok: true });
        return true;
      }
    }
    const artifact = path.match(/^\/artifacts\/([^/]+)(?:\/(preview|view))?$/);
    if (artifact && method === "GET") {
      const a =
        this.deps.db.artifacts.get(artifact[1]) || fail("找不到檔案。", 404);
      if (artifact[2] && !a.snapshotPath) {
        // A live-file reference cannot prove the delivered version.
        if (artifact[2] === "preview")
          reply(res, { kind: "download" } satisfies ArtifactPreview);
        else fail("此格式不支援預覽。", 415);
        return true;
      }
      const workspace = a.snapshotPath
        ? new Workspace(join(this.deps.tasks.store.directory, "artifacts"))
        : a.location
          ? this.deps.tasks.locations.workspace(a.location)
          : this.deps.tasks.workspace;
      const downloadBundle = !artifact[2] && a.bundle;
      const storedPath = downloadBundle
        ? a.bundle!.archivePath
        : a.snapshotPath || a.path;
      const file = await workspace.resolve(storedPath);
      const extension = extname(a.path).toLowerCase();
      const imageTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
      };
      if (artifact[2] === "preview") {
        // Read only the published snapshot; never substitute the live work file.
        const size = (await stat(file)).size;
        let preview: ArtifactPreview;
        if (size > 20 * 1024 * 1024) preview = { kind: "download" };
        else if (imageTypes[extension]) preview = { kind: "image" };
        else if (extension === ".pdf") preview = { kind: "pdf" };
        else if ([".docx", ".xlsx"].includes(extension)) {
          if (extension === ".docx") {
            const document = await previewDocx(file);
            reply(res, {
              kind: "document",
              content: document.text,
              document: document.document,
              truncated: document.truncated,
            } satisfies ArtifactPreview);
            return true;
          }
          const document = await this.deps.readDocument(storedPath, workspace);
          const content =
            typeof document === "string"
              ? document
              : JSON.stringify(document, null, 2);
          preview = {
            kind: "document",
            content: content.slice(0, 100000),
            truncated: content.length > 100000,
          };
        } else if (
          size <= 1024 * 1024 &&
          /\.(md|txt|csv|json|log|html?|css|js|ts|py|yaml|yml|toml)$/i.test(
            a.path,
          )
        ) {
          preview = {
            kind:
              extension === ".md"
                ? "markdown"
                : /\.html?$/i.test(extension)
                  ? "html"
                  : "text",
            content: await readFile(file, "utf8"),
            truncated: false,
            ...(a.bundle
              ? {
                  previewUrl: this.deps.htmlPreview.url(
                    `artifact-${a.id}`,
                    a.bundle.entry,
                  ),
                }
              : {}),
          };
        } else preview = { kind: "download" };
        reply(res, preview);
        return true;
      }
      const inline = artifact[2] === "view";
      if (inline && a.bundle) {
        res.writeHead(302, {
          Location: this.deps.htmlPreview.url(
            `artifact-${a.id}`,
            a.bundle.entry,
          ),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        });
        res.end();
        return true;
      }
      const html = /\.html?$/i.test(extension);
      if (inline && !imageTypes[extension] && extension !== ".pdf" && !html)
        fail("此格式不支援預覽。", 415);
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": inline
          ? html
            ? "text/html; charset=utf-8"
            : imageTypes[extension] || "application/pdf"
          : downloadBundle
            ? "application/zip"
            : a.mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(downloadBundle ? a.name.replace(/\.html?$/i, "") + ".zip" : a.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          inline && html
            ? "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
            : extension === ".pdf"
              ? "default-src 'none'"
              : "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      });
      res.end(
        inline && html
          ? Buffer.concat([data, Buffer.from(previewEscapeScript)])
          : data,
      );
      return true;
    }
    if (path === "/connectors" && method === "POST") {
      const revision = this.deps.connectors.storage.read().revision;
      const input = parseRequest(connectorSchema, await body(req));
      const url = new URL(string(input.url, 2000));
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        fail("請輸入 HTTP MCP endpoint。");
      const c: Connector = {
        id: randomUUID(),
        name: string(input.name, 100),
        url: url.href,
        enabled: true,
        token: typeof input.token === "string" ? input.token : undefined,
      };
      await withConnector(c, (client) =>
        client.listTools(undefined, { timeout: c.toolTimeoutMs ?? 60000 }),
      );
      this.deps.connectors.put(c, revision);
      this.deps.notify();
      reply(res, { id: c.id, name: c.name });
      return true;
    }
    const connector = path.match(/^\/connectors\/([^/]+)$/);
    if (connector && method === "DELETE") {
      this.deps.connectors.remove(connector[1]);
      this.deps.notify();
      reply(res, { ok: true });
      return true;
    }
    if (path === "/rules" && method === "GET") {
      reply(res, [
        ...this.deps.db
          .all<Record<string, unknown>>("session-allow")
          .map((rule) => ({ ...rule })),
      ]);
      return true;
    }
    const rule = path.match(/^\/rules\/([^/]+)$/);
    if (rule && method === "DELETE") {
      this.deps.db.remove("session-allow", rule[1]);
      reply(res, { ok: true });
      return true;
    }
    return false;
  }
}
