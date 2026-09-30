import {
  parseRequest,
  ollamaDiscoverySchema,
  compatibleDiscoverySchema,
  connectionSchema,
  defaultConnectionSchema,
  connectionTestSchema,
  skillSchema,
} from "./request-schema.ts";
import { appDirectories, type DirectoryOptions } from "./app-directories.ts";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { asError } from "../shared/errors.ts";
import type { RunResult, Skill } from "../shared/types.ts";
import { runAgent } from "./agent.ts";
import { discoverCompatibleModels } from "./compatible.ts";
import { Connections } from "./connections.ts";
import { discoverOllama } from "./ollama.ts";
import { testConnection } from "./probe.ts";
import { ProductService } from "./product.ts";
import type { RunOptions } from "./runtime.ts";
import { Store } from "./store.ts";
import { TaskService } from "./tasks.ts";
import { Workspace } from "./workspace.ts";
import { htmlPreviewRoute } from "./html-preview.ts";

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    fail("需要 application/json。", 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (
      size >
      (req.url?.startsWith("/api/v2/work-locations/") ? 8 * 1024 * 1024 : 64000)
    )
      fail("內容過大。", 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("需要 JSON 物件。");
    return value;
  } catch {
    fail("JSON 格式錯誤。");
  }
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
function text(value: unknown, limit: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    fail(`${label}需為 1–${limit} 字。`);
  return value.trim();
}

export interface AppOptions extends DirectoryOptions {
  globalSkillsDirectory?: string;
  worktreeRoot?: string;
  runner?: (options: RunOptions) => Promise<RunResult>;
}
export async function createApp(options: AppOptions = {}) {
  const { worktreeRoot, runner = runAgent, globalSkillsDirectory } = options;
  const { dataDir, workspaceDir } = appDirectories(options);
  const store = await new Store(dataDir, globalSkillsDirectory).init();
  const workspace = await new Workspace(workspaceDir).init();
  const tasks = new TaskService(store, workspace, runner);
  await tasks.runs.init();
  const connections = await new Connections(dataDir).init();
  const product = await new ProductService(tasks, connections).init();
  product.workspaces.worktreeRoot = worktreeRoot;

  const server = createServer(async (req, res) => {
    const styleNonce = randomUUID().replaceAll("-", "");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    try {
      if (product.execution.closed) fail("服務正在關閉。", 503);
      const port = (server.address() as AddressInfo | null)?.port;
      if (
        !["localhost:" + port, "127.0.0.1:" + port].includes(
          req.headers.host || "",
        )
      )
        fail("不允許的 Host。", 403);
      const path = new URL(req.url || "/", "http://localhost").pathname;
      const previewRequest =
        req.method === "GET" &&
        htmlPreviewRoute.test(path) &&
        (!req.headers.origin || req.headers.origin === "null");
      if (
        req.headers.origin &&
        !previewRequest &&
        !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(
          req.headers.origin,
        )
      )
        fail("不允許跨來源請求。", 403);
      if (req.headers["sec-fetch-site"] === "cross-site" && !previewRequest)
        fail("不允許跨網站請求。", 403);
      if (
        !["GET", "HEAD"].includes(req.method || "") &&
        req.headers["x-apsis-client"] !== "1"
      )
        fail("缺少工作台請求標頭。", 403);

      if (
        req.method === "GET" &&
        (await product.htmlPreview.serve(
          path,
          req.headers.host!,
          product.files,
          res,
        ))
      )
        return;
      if (path.startsWith("/api/v2/"))
        return await product.routes.handle(
          req,
          res,
          new URL(req.url || "/", "http://localhost"),
          body,
        );
      if (
        req.method === "GET" &&
        [
          "/",
          "/bot.js",
          "/bot.js.map",
          "/bot.css",
          "/providers.css",
          "/files.css",
          "/favicon.svg",
        ].includes(path)
      ) {
        const file =
          path === "/"
            ? new URL("../public/bot.html", import.meta.url)
            : path === "/bot.css" ||
                path === "/providers.css" ||
                path === "/files.css" ||
                path === "/favicon.svg"
              ? new URL("../public" + path, import.meta.url)
              : new URL("../dist/public" + path, import.meta.url);
        const type = path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : path.endsWith(".map")
              ? "application/json"
              : path.endsWith(".js")
                ? "text/javascript"
                : "text/html";
        res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
        const data = await readFile(file);
        return res.end(
          type === "text/html"
            ? data
                .toString("utf8")
                .replace(
                  "</head>",
                  `<meta name="style-nonce" content="${styleNonce}"></head>`,
                )
            : data,
        );
      }
      if (path === "/api/status" && req.method === "GET")
        return json(res, {
          runtimes: ["deepagents"],
          version: "0.2.0",
          dataDir: store.directory,
          workspace: workspace.root,
          running: tasks.running.size,
        });
      if (path === "/api/storage/backup" && req.method === "GET") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="apsis-backup.json"',
        );
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.write(
          '{"version":4,"state":' +
            JSON.stringify(store.state) +
            ',"conversations":',
        );
        for await (const chunk of store.conversations.exportChunks()) {
          if (!res.write(chunk))
            await new Promise<void>((resolve) => res.once("drain", resolve));
        }
        res.end("}");
        return;
      }
      if (path === "/api/ollama/models" && req.method === "POST")
        return json(
          res,
          await discoverOllama(
            parseRequest(ollamaDiscoverySchema, await body(req)).url,
          ),
        );
      if (path === "/api/compatible/models" && req.method === "POST") {
        const input = parseRequest(compatibleDiscoverySchema, await body(req));
        return json(
          res,
          await discoverCompatibleModels(
            input.url,
            connections.discoveryKey(input),
          ),
        );
      }
      if (path === "/api/connections") {
        if (req.method === "GET") return json(res, connections.view());
        if (req.method === "POST")
          return json(
            res,
            await connections.save(
              parseRequest(connectionSchema, await body(req)),
            ),
            201,
          );
      }
      if (path === "/api/connections/default") {
        if (req.method === "GET")
          return json(res, connections.defaultSelection());
        if (req.method === "PUT")
          return json(
            res,
            await connections.setDefault(
              parseRequest(defaultConnectionSchema, await body(req)),
            ),
          );
      }
      const connection = path.match(
        /^\/api\/connections\/([^/]+)(?:\/(test))?$/,
      );
      if (connection) {
        const [, encodedId, action] = connection;
        const id = decodeURIComponent(encodedId);
        if (action === "test" && req.method === "POST") {
          const input = parseRequest(connectionTestSchema, await body(req));
          return json(res, await testConnection(connections, id, input));
        }
        if (!action && req.method === "PUT")
          return json(
            res,
            await connections.save(
              parseRequest(connectionSchema, await body(req)),
              id,
            ),
          );
        if (!action && req.method === "DELETE") {
          const used = product.db.bots
            .list()
            .some((b) => b.connectionId === id);
          if (used) fail("此模型連線仍有 Bot 使用。", 409);
          await connections.archive(id);
          return json(res, { ok: true });
        }
      }
      if (path === "/api/skills") {
        if (req.method === "GET")
          return json(
            res,
            store.skillState().skills.filter((s) => !s.agentId),
          );
        if (req.method === "POST") {
          const input = parseRequest(skillSchema, await body(req));
          const item: Skill = {
            id: randomUUID(),
            name: text(input.name, 100, "名稱"),
            content: text(input.content, 12000, "內容"),
            source: { kind: "manual" },
            createdAt: new Date().toISOString(),
          };
          const saved = store.skills.create(item);
          product.notify();
          return json(res, saved.skill, saved.created ? 201 : 200);
        }
      }
      fail("找不到此頁面。", 404);
    } catch (caught) {
      const error = asError(caught);
      if (req.url?.startsWith("/api/v2/work-locations/") && !error.status) {
        const fsErrors: Record<string, [number, string]> = {
          ENOENT: [404, "檔案不存在或已被移動。"],
          EEXIST: [409, "同名檔案或資料夾已存在。"],
          ENOTDIR: [400, "路徑不是資料夾。"],
          EISDIR: [400, "請選擇檔案。"],
          EACCES: [403, "無法存取此檔案。"],
          EPERM: [403, "檔案無法修改，可能正被其他程式使用。"],
        };
        const known = fsErrors[error.code || ""];
        if (known) {
          error.status = known[0];
          error.message = known[1];
        }
      }
      if (!res.headersSent)
        json(
          res,
          {
            error: error.status
              ? error.message
              : "伺服器處理失敗，請查看終端機。",
          },
          error.status || 500,
        );
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  let closePromise: Promise<void> | undefined;
  server.on("close", () => {
    if (!closePromise) void product.close().catch(console.error);
  });
  const close = (): Promise<void> => {
    if (!closePromise) {
      product.stop();
      closePromise = (async () => {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error && asError(error).code !== "ERR_SERVER_NOT_RUNNING")
              reject(error);
            else resolve();
          }),
        );
        await product.close();
      })();
    }
    return closePromise;
  };
  return {
    close,
    server,
    store,
    workspace,
    tasks,
    product,
    connections,
  };
}
