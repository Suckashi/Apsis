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
import { Connections } from "./connections.ts";
import { CodexRuntime } from "./codex.ts";
import { normalizeFact } from "./knowledge.ts";
import { discoverOllama } from "./ollama.ts";
import { testConnection } from "./probe.ts";
import { ProductService } from "./product.ts";
import type { RunOptions } from "./runtime.ts";
import { Store } from "./store.ts";
import { TaskService } from "./tasks.ts";
import { TelegramChannel, type TelegramCall } from "./telegram.ts";
import { Workspace } from "./workspace.ts";

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
    if (size > 64000) fail("內容過大。", 413);
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

export interface AppOptions {
  telegramCall?: TelegramCall;
  dataDir?: string;
  workspaceDir?: string;
  runner?: (options: RunOptions) => Promise<RunResult>;
}
export async function createApp({
  dataDir = ".apsis",
  workspaceDir = ".apsis/workspace",
  runner = runAgent,
  telegramCall,
}: AppOptions = {}) {
  const store = await new Store(dataDir).init();
  const workspace = await new Workspace(workspaceDir).init();
  const tasks = new TaskService(store, workspace, runner);
  await tasks.runs.init();
  const connections = await new Connections(dataDir).init();
  tasks.connections = connections;
  const codex = new CodexRuntime(
    () => (server.address() as AddressInfo | null)?.port,
  );
  tasks.codex = codex;
  const telegram = await new TelegramChannel(dataDir, telegramCall).init();
  const product = await new ProductService(tasks, connections).init();
  telegram.productMessage = (message) => product.telegram(message);
  product.notifyOwner = (message) => telegram.notifyOwner(message);

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = (server.address() as AddressInfo | null)?.port;
      if (
        !["localhost:" + port, "127.0.0.1:" + port].includes(
          req.headers.host || "",
        )
      )
        fail("不允許的 Host。", 403);
      if (
        req.headers.origin &&
        !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(
          req.headers.origin,
        )
      )
        fail("不允許跨來源請求。", 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail("不允許跨網站請求。", 403);
      const path = new URL(req.url || "/", "http://localhost").pathname;
      const mcp = path.match(/^\/api\/codex\/mcp\/([a-f0-9-]+)$/);
      if (
        !["GET", "HEAD"].includes(req.method || "") &&
        req.headers["x-apsis-client"] !== "1" &&
        !mcp
      )
        fail("缺少工作台請求標頭。", 403);
      if (mcp) return await codex.handleMcp(req, res, mcp[1]);

      if (path.startsWith("/api/v2/"))
        return await product.handle(
          req,
          res,
          new URL(req.url || "/", "http://localhost"),
          body,
        );
      if (
        req.method === "GET" &&
        ["/", "/bot.js", "/bot.js.map", "/bot.css", "/favicon.svg"].includes(
          path,
        )
      ) {
        const file =
          path === "/"
            ? new URL("../public/bot.html", import.meta.url)
            : path === "/bot.css" || path === "/favicon.svg"
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
        return res.end(await readFile(file));
      }
      if (path === "/api/status" && req.method === "GET")
        return json(res, {
          runtimes: ["deepagents", "codex"],
          version: "0.2.0",
          workspace: workspaceDir,
          running: tasks.running.size,
        });
      if (path === "/api/storage/backup" && req.method === "GET") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="apsis-backup.json"',
        );
        return json(res, store.state);
      }
      if (path === "/api/ollama/models" && req.method === "POST")
        return json(res, await discoverOllama((await body(req)).url));
      if (path === "/api/codex/status" && req.method === "GET")
        return json(res, await codex.inspect());
      if (path === "/api/codex/login" && req.method === "POST") {
        await body(req);
        return json(res, await codex.beginLogin());
      }
      if (path === "/api/connections") {
        if (req.method === "GET") return json(res, connections.view());
        if (req.method === "POST")
          return json(res, await connections.save(await body(req)), 201);
      }
      if (path === "/api/connections/default") {
        if (req.method === "GET")
          return json(res, connections.defaultSelection());
        if (req.method === "PUT")
          return json(res, await connections.setDefault(await body(req)));
      }
      const connection = path.match(
        /^\/api\/connections\/([a-f0-9-]+)(?:\/(test))?$/,
      );
      if (connection) {
        const [, id, action] = connection;
        if (action === "test" && req.method === "POST") {
          const input = await body(req);
          if (
            connections.view().find((c) => c.id === id)?.provider === "codex"
          ) {
            const status = await codex.inspect();
            const selected = connections.selection(id, input.model);
            const ok =
              status.connected &&
              status.models.some(
                (m: { id: string }) => m.id === selected.model,
              );
            return json(
              res,
              await connections.verified(id, {
                engine: "codex",
                model: selected.model,
                at: new Date().toISOString(),
                ok,
                streaming: false,
                tools: false,
                message: ok
                  ? "ChatGPT 已登入；模型可用。派工工具需以任務測試驗證。"
                  : "請登入 ChatGPT，並選擇可用的 Codex 模型。",
              }),
            );
          }
          return json(res, await testConnection(connections, id, input));
        }
        if (!action && req.method === "PUT")
          return json(res, await connections.save(await body(req), id));
        if (!action && req.method === "DELETE") {
          const used = product.db
            .all<{ connectionId?: string }>("bot")
            .some((b) => b.connectionId === id);
          if (used) fail("此模型連線仍有 Bot 使用。", 409);
          await connections.archive(id);
          return json(res, { ok: true });
        }
      }
      if (path === "/api/channels/telegram") {
        if (req.method === "GET") return json(res, telegram.view());
        if (req.method === "POST")
          return json(res, await telegram.update(await body(req)));
      }
      if (path.startsWith("/api/channels/telegram/") && req.method === "POST") {
        await body(req);
        if (path.endsWith("/pairing"))
          return json(res, telegram.createPairing());
        if (path.endsWith("/unpair")) return json(res, await telegram.unpair());
        if (path.endsWith("/test"))
          return json(res, await telegram.testConnection());
      }
      if (path === "/api/skills") {
        if (req.method === "GET") return json(res, store.state.skills);
        if (req.method === "POST") {
          const input = await body(req);
          const item: Skill = {
            id: randomUUID(),
            name: text(input.name, 100, "名稱"),
            content: text(input.content, 12000, "內容"),
            source: { kind: "manual" },
            createdAt: new Date().toISOString(),
          };
          const saved = await store.mutate((s) => {
            const duplicate = s.skills.find(
              (skill) =>
                !skill.agentId &&
                !skill.mergedInto &&
                skill.enabled !== false &&
                skill.name === item.name &&
                normalizeFact(skill.content) === normalizeFact(item.content),
            );
            if (duplicate) return duplicate;
            s.skills.unshift(item);
            return item;
          });
          return json(res, saved, saved.id === item.id ? 201 : 200);
        }
      }
      fail("找不到此頁面。", 404);
    } catch (caught) {
      const error = asError(caught);
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
  server.on("close", () => {
    codex.close();
    void product.close();
    tasks.stopAll();
    void telegram.stop();
  });
  server.once("listening", () => telegram.start());
  return {
    server,
    store,
    workspace,
    tasks,
    telegram,
    product,
    connections,
    codex,
  };
}
