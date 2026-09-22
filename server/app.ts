import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Environment, Session, Skill, RunEvent } from "../shared/types.ts";
import type { RunOptions } from "./agent.ts";
import { asError } from "../shared/errors.ts";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "./store.ts";
import { Settings } from "./settings.ts";
import { Workspace } from "./workspace.ts";
import { configuration, runAgent } from "./agent.ts";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/app.js.map": ["app.js.map", "application/json"],
  "/style.css": ["style.css", "text/css"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const modes = ["demo", "pi", "hybrid", "hermes"];
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function string(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(label + "需為 1–" + max + " 字。");
  return value.trim();
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    fail("需要 application/json。", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64000) fail("內容過大。", 413);
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("需要 JSON 物件。");
    return input;
  } catch {
    fail("JSON 格式錯誤。");
  }
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export interface AppOptions {
  dataDir?: string;
  workspaceDir?: string;
  env?: Environment;
  runner?: (
    options: RunOptions,
  ) => Promise<import("../shared/types.ts").RunResult>;
}
export async function createApp({
  dataDir = ".loom",
  workspaceDir = "workspace",
  env = process.env,
  runner = runAgent,
}: AppOptions = {}) {
  const store = await new Store(dataDir).init();
  const settings = await new Settings(dataDir, env).init();
  const workspace = await new Workspace(workspaceDir).init();
  const running = new Map<string, AbortController>();
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
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname;
      if (
        !["GET", "HEAD"].includes(req.method || "") &&
        req.headers["x-loom-client"] !== "1"
      )
        fail("缺少工作台請求標頭。", 403);
      if (req.method === "GET" && assets[path]) {
        const [file, type] = assets[path];
        const content = await readFile(
          path === "/app.js" || path === "/app.js.map"
            ? new URL("../dist/public/" + file, import.meta.url)
            : publicDir + file,
        );
        res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
        return res.end(content);
      }
      if (req.method === "GET" && path === "/api/status")
        return json(res, {
          ...configuration(settings.environment()),
          version: "0.1.0",
          workspace: "workspace/",
          running: running.size,
        });
      if (req.method === "GET" && path === "/api/settings")
        return json(res, settings.view());
      const settingsMatch = path.match(/^\/api\/settings\/(pi|hermes)$/);
      if (req.method === "POST" && settingsMatch)
        return json(
          res,
          await settings.update(settingsMatch[1], await body(req)),
        );
      if (req.method === "GET" && path === "/api/sessions")
        return json(
          res,
          store.state.sessions.map(({ piMessages, messages, ...session }) => ({
            ...session,
            count: messages.length,
            running: running.has(session.id),
          })),
        );
      if (req.method === "POST" && path === "/api/sessions") {
        const input = await body(req);
        const mode = input.mode || "demo";
        if (typeof mode !== "string" || !modes.includes(mode))
          fail("未知模式。");
        const session: Session = {
          id: randomUUID(),
          title: "新的工作階段",
          mode: mode as Session["mode"],
          createdAt: new Date().toISOString(),
          messages: [],
          piMessages: [],
        };
        await store.mutate((s) => s.sessions.unshift(session));
        return json(res, session, 201);
      }
      const match = path.match(
        /^\/api\/sessions\/([a-f0-9-]+)(?:\/(chat|stop))?$/,
      );
      if (match) {
        const [, id, action] = match;
        const session = store.state.sessions.find((s) => s.id === id);
        if (!session) fail("找不到工作階段。", 404);
        if (!action && req.method === "GET") {
          const { piMessages, ...safe } = session;
          return json(res, { ...safe, running: running.has(id) });
        }
        if (action === "stop" && req.method === "POST") {
          running.get(id)?.abort();
          return json(res, { ok: true });
        }
        if (action === "chat" && req.method === "POST") {
          if (running.has(id)) fail("此工作階段正在執行。", 409);
          const input = await body(req);
          const prompt = string(input.prompt, 16000, "訊息");
          if (typeof input.allowWrites !== "boolean")
            fail("allowWrites 必須為布林值。");
          if (running.has(id)) fail("此工作階段正在執行。", 409);
          const runEnv = settings.environment();
          const controller = new AbortController();
          running.set(id, controller);
          const timer = setTimeout(() => controller.abort(), 300000);
          const onClose = () => {
            if (!res.writableEnded) controller.abort();
          };
          res.on("close", onClose);
          let output = "";
          const activity: string[] = [];
          const userId = randomUUID();
          try {
            await store.mutate((s) => {
              const row = s.sessions.find((x) => x.id === id)!;
              row.title = row.messages.length ? row.title : prompt.slice(0, 44);
              row.messages.push({
                id: userId,
                role: "user",
                content: prompt,
                status: "pending",
              });
            });
            res.writeHead(200, {
              "Content-Type": "application/x-ndjson; charset=utf-8",
            });
            const emit = (event: RunEvent) => {
              if (event.type === "delta") output += event.text;
              if (event.type === "activity") activity.push(event.text);
              if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
            };
            const result = await runner({
              mode: session.mode,
              prompt,
              session: structuredClone(session),
              store,
              workspace,
              allowWrites: input.allowWrites,
              emit,
              signal: controller.signal,
              env: runEnv,
            });
            controller.signal.throwIfAborted();
            await store.mutate((s) => {
              const row = s.sessions.find((x) => x.id === id)!;
              row.messages.find((m) => m.id === userId)!.status = "complete";
              row.messages.push({
                id: randomUUID(),
                role: "assistant",
                content: result.text,
                status: "complete",
                activity,
              });
              if (result.piMessages) row.piMessages = result.piMessages;
            });
            emit({ type: "done" });
          } catch (caught) {
            const error = asError(caught);
            let message = controller.signal.aborted
              ? "已停止執行。"
              : String(error.message || "執行失敗。");
            for (const key of [
              runEnv.OPENAI_API_KEY,
              runEnv.ANTHROPIC_API_KEY,
              runEnv.HERMES_API_KEY,
            ].filter((key): key is string => Boolean(key)))
              message = message.replaceAll(key, "[redacted]");
            await store.mutate((s) => {
              const row = s.sessions.find((x) => x.id === id)!;
              const user = row.messages.find((m) => m.id === userId);
              if (user) user.status = "failed";
              row.messages.push({
                id: randomUUID(),
                role: "assistant",
                content: output ? output + "\n\n" + message : message,
                status: "error",
                activity,
              });
            });
            if (!res.destroyed) {
              if (!res.headersSent)
                res.writeHead(200, {
                  "Content-Type": "application/x-ndjson; charset=utf-8",
                });
              res.write(
                JSON.stringify({ type: "error", text: message }) + "\n",
              );
            }
          } finally {
            clearTimeout(timer);
            running.delete(id);
            res.off("close", onClose);
            res.end();
          }
          return;
        }
      }
      const collection = path.match(
        /^\/api\/(memories|skills)(?:\/([a-f0-9-]+|starter))?$/,
      );
      if (collection) {
        const [, rawName, id] = collection;
        const name = rawName as "memories" | "skills";
        if (!id && req.method === "GET") return json(res, store.state[name]);
        if (!id && req.method === "POST") {
          const input = await body(req);
          const item: Skill = {
            name: "",
            id: randomUUID(),
            content: string(
              input.content,
              name === "skills" ? 12000 : 4000,
              "內容",
            ),
            createdAt: new Date().toISOString(),
          };
          if (name === "skills") item.name = string(input.name, 100, "名稱");
          await store.mutate((s) => s[name].unshift(item));
          return json(res, item, 201);
        }
        if (id && req.method === "DELETE") {
          if (!store.state[name].some((x) => x.id === id))
            fail("項目不存在。", 404);
          await store.mutate((s) => {
            if (name === "skills")
              s.skills = s.skills.filter((x) => x.id !== id);
            else s.memories = s.memories.filter((x) => x.id !== id);
          });
          return json(res, { ok: true });
        }
      }
      if (path === "/api/files" && req.method === "GET")
        return json(res, await workspace.list());
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
    for (const controller of running.values()) controller.abort();
  });
  return { server, store, workspace };
}
