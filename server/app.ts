import { discoverOllama } from "./ollama.ts";
import { exportConversation } from "../shared/export.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Environment, Session, Skill } from "../shared/types.ts";
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
import { TaskService } from "./tasks.ts";
import { parseAgent } from "./agents.ts";
import { Connections } from "./connections.ts";
import { revise, normalizeFact } from "./knowledge.ts";
import { testConnection } from "./probe.ts";
import { TelegramChannel, type TelegramCall } from "./telegram.ts";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/app.js.map": ["app.js.map", "application/json"],
  "/style.css": ["style.css", "text/css"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const modes = ["demo", "pi"];
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
  telegramCall?: TelegramCall;
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
  telegramCall,
}: AppOptions = {}) {
  const store = await new Store(dataDir).init();
  const settings = await new Settings(dataDir, env).init();
  const workspace = await new Workspace(workspaceDir).init();
  const tasks = new TaskService(store, workspace, settings, runner);
  await tasks.runs.init();
  for (const run of tasks.runs.records.values()) {
    if (
      run.status === "interrupted" &&
      store.state.sessions.some(
        (s) =>
          s.id === run.sessionId &&
          s.messages.some(
            (m) =>
              m.runId === run.id &&
              m.role === "assistant" &&
              m.status === "complete",
          ),
      )
    ) {
      run.status = "completed";
      delete run.error;
      await tasks.runs.save(run);
    }
  }
  const connections = await new Connections(dataDir, settings).init();
  tasks.connections = connections;
  const running = tasks.running;
  const telegram = await new TelegramChannel(
    dataDir,
    tasks,
    telegramCall,
  ).init();
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
      if (req.method === "POST" && path === "/api/ollama/models") {
        const input = await body(req);
        return json(res, await discoverOllama(input.url));
      }
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
      if (req.method === "GET" && path === "/api/storage/backup") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="apsis-backup.json"',
        );
        return json(res, store.state);
      }
      if (path === "/api/connections") {
        if (req.method === "GET") return json(res, connections.view());
        if (req.method === "POST")
          return json(res, await connections.save(await body(req)), 201);
      }
      const connectionMatch = path.match(
        /^\/api\/connections\/([a-z0-9-]+)(?:\/(test))?$/,
      );
      if (connectionMatch) {
        const [, id, action] = connectionMatch;
        if (action === "test" && req.method === "POST")
          return json(
            res,
            await testConnection(connections, id, await body(req)),
          );
        if (!action && req.method === "PUT")
          return json(res, await connections.save(await body(req), id));
        if (!action && req.method === "DELETE") {
          if (
            store.state.agents?.some(
              (a) => a.connectionId === id && !a.archived,
            )
          )
            fail("此連線仍有 agent 使用，請先切換該 agent 的連線。", 409);
          if (store.state.sessions.some((s) => s.agent?.connectionId === id))
            fail("既有對話仍使用此連線，請保留連線以便續聊。", 409);
          await connections.archive(id);
          return json(res, { ok: true });
        }
      }
      if (path === "/api/runs" && req.method === "GET") {
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const all = tasks.runs.list(
          url.searchParams.get("sessionId") || undefined,
        );
        return json(res, {
          items: all.slice(offset, offset + 50),
          total: all.length,
          nextOffset: offset + 50 < all.length ? offset + 50 : null,
        });
      }
      const runMatch = path.match(/^\/api\/runs\/([a-f0-9-]+)(?:\/(stop))?$/);
      if (runMatch) {
        const run = tasks.runs.records.get(runMatch[1]);
        if (!run) fail("找不到任務。", 404);
        if (req.method === "GET") return json(res, run);
        if (req.method === "POST" && runMatch[2] === "stop") {
          if (run.status === "running") tasks.stop(run.sessionId);
          return json(res, { ok: true });
        }
      }
      if (path === "/api/channels/telegram") {
        if (req.method === "GET") return json(res, telegram.view());
        if (req.method === "POST")
          return json(res, await telegram.update(await body(req)));
      }
      if (req.method === "POST" && path.startsWith("/api/channels/telegram/")) {
        await body(req);
        if (path.endsWith("/pairing"))
          return json(res, telegram.createPairing());
        if (path.endsWith("/unpair")) return json(res, await telegram.unpair());
        if (path.endsWith("/test")) {
          try {
            return json(res, await telegram.testConnection());
          } catch (error) {
            fail(asError(error).message);
          }
        }
      }
      const settingsMatch = path.match(/^\/api\/settings\/(pi)$/);
      if (req.method === "POST" && settingsMatch)
        return json(
          res,
          await settings.update(settingsMatch[1], await body(req)),
        );
      if (path === "/api/agents") {
        if (req.method === "GET")
          return json(
            res,
            (store.state.agents || []).filter((a) => !a.archived),
          );
        if (req.method === "POST") {
          const agent = parseAgent(await body(req), store.state);
          if (
            agent.connectionId &&
            !connections
              .view()
              .some(
                (c) =>
                  c.id === agent.connectionId && c.provider === agent.provider,
              )
          )
            fail("模型連線與供應商不符。");
          await store.mutate((s) => (s.agents ||= []).push(agent));
          return json(res, agent, 201);
        }
      }
      const agentMatch = path.match(/^\/api\/agents\/([a-f0-9-]+)$/);
      if (agentMatch) {
        const previous = store.state.agents?.find(
          (a) => a.id === agentMatch[1] && !a.archived,
        );
        if (!previous) fail("找不到 agent。", 404);
        if (req.method === "PUT") {
          const agent = parseAgent(await body(req), store.state, previous);
          if (
            agent.connectionId &&
            !connections
              .view()
              .some(
                (c) =>
                  c.id === agent.connectionId && c.provider === agent.provider,
              )
          )
            fail("模型連線與供應商不符。");
          await store.mutate((s) => {
            s.agents![s.agents!.findIndex((a) => a.id === agent.id)] = agent;
          });
          return json(res, agent);
        }
        if (req.method === "DELETE") {
          await store.mutate((s) => {
            s.agents!.find((a) => a.id === previous.id)!.archived = true;
          });
          return json(res, { ok: true });
        }
      }
      if (req.method === "GET" && path === "/api/sessions")
        return json(
          res,
          store.state.sessions.map(
            ({
              piMessages,
              engineState,
              runtimeState,
              messages,
              ...session
            }) => ({
              ...session,
              count: messages.length,
              running: running.has(session.id),
            }),
          ),
        );
      if (req.method === "POST" && path === "/api/sessions") {
        const input = await body(req);
        const mode = input.mode || "demo";
        if (typeof mode !== "string" || !modes.includes(mode))
          fail("未知模式。");
        const agent = input.agentId
          ? store.state.agents?.find(
              (a) => a.id === input.agentId && !a.archived,
            )
          : undefined;
        if (input.agentId && !agent) fail("找不到 agent。", 404);
        if (agent && mode !== "pi") fail("自建 agent 必須使用真實回覆模式。");
        const session = await tasks.create(
          mode as Session["mode"],
          "web",
          agent,
        );
        return json(res, session, 201);
      }
      const match = path.match(
        /^\/api\/sessions\/([a-f0-9-]+)(?:\/(chat|stop|export|runs))?$/,
      );
      if (match) {
        const [, id, action] = match;
        const session = store.state.sessions.find((s) => s.id === id);
        if (!session) fail("找不到工作階段。", 404);
        if (!action && req.method === "GET") {
          return json(res, tasks.view(id));
        }
        if (action === "export" && req.method === "GET") {
          if (running.has(id)) fail("請等待任務完成後再匯出。", 409);
          res.writeHead(200, {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": 'attachment; filename="apsis-' + id + '.md"',
          });
          return res.end(exportConversation(session));
        }
        if (action === "stop" && req.method === "POST") {
          tasks.stop(id);
          return json(res, { ok: true });
        }
        if (action === "runs" && req.method === "POST") {
          const input = await body(req);
          const permissions =
            input.permissions as import("../shared/types.ts").RunPermissions;
          if (
            !permissions ||
            ["files", "memory", "skills"].some(
              (k) =>
                typeof (permissions as unknown as Record<string, unknown>)[
                  k
                ] !== "boolean",
            )
          )
            fail("請提供檔案、記憶與技能權限。");
          return json(
            res,
            await tasks.start(
              id,
              string(input.prompt, 16000, "訊息"),
              permissions,
            ),
            202,
          );
        }
        if (action === "chat" && req.method === "POST") {
          if (running.has(id)) fail("此工作階段正在執行。", 409);
          const input = await body(req);
          const prompt = string(input.prompt, 16000, "訊息");
          if (typeof input.allowWrites !== "boolean")
            fail("allowWrites 必須為布林值。");
          if (running.has(id)) fail("此工作階段正在執行。", 409);
          let emittedError = false;
          try {
            await tasks.run(id, prompt, input.allowWrites, (event) => {
              if (event.type === "error") emittedError = true;
              if (res.destroyed) return;
              if (!res.headersSent)
                res.writeHead(200, {
                  "Content-Type": "application/x-ndjson; charset=utf-8",
                });
              res.write(JSON.stringify(event) + "\n");
            });
          } catch (error) {
            if (!emittedError) throw error;
          } finally {
            if (res.headersSent) res.end();
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
        if (id && req.method === "PUT") {
          const input = await body(req);
          await store.mutate((s) => {
            const item = s[name].find((m) => m.id === id);
            if (!item) fail("項目不存在。", 404);
            if (input.content !== undefined)
              revise(
                item,
                string(input.content, name === "skills" ? 12000 : 4000, "內容"),
              );
            if (input.enabled !== undefined) {
              if (typeof input.enabled !== "boolean")
                fail("enabled 必須為布林值。");
              item.enabled = input.enabled;
            }
            if (input.mergeId !== undefined) {
              const other = s[name].find((m) => m.id === input.mergeId);
              if (
                !other ||
                other.id === id ||
                other.agentId !== item.agentId ||
                other.mergedInto
              )
                fail("只能合併同範圍且未合併的項目。");
              if (item.mergedInto) fail("此項目已合併。");
              revise(
                item,
                string(
                  item.content + "\n" + other.content,
                  name === "skills" ? 12000 : 4000,
                  "合併內容",
                ),
              );
              other.enabled = false;
              other.mergedInto = item.id;
            }
          });
          return json(
            res,
            store.state[name].find((m) => m.id === id),
          );
        }
        if (!id && req.method === "GET") return json(res, store.state[name]);
        if (!id && req.method === "POST") {
          const input = await body(req);
          const item: Skill = {
            source: { kind: "manual" },
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
          const saved = await store.mutate((s) => {
            const duplicate = s[name].find(
              (m) =>
                !m.agentId &&
                !m.mergedInto &&
                m.enabled !== false &&
                normalizeFact(m.content) === normalizeFact(item.content) &&
                (name !== "skills" || (m as Skill).name === item.name),
            );
            if (duplicate) return duplicate;
            s[name].unshift(item);
            return item;
          });
          return json(res, saved, saved.id === item.id ? 201 : 200);
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
    tasks.stopAll();
    void telegram.stop();
  });
  server.once("listening", () => telegram.start());
  return { server, store, workspace, tasks, telegram };
}
