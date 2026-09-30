import {
  parseRequest,
  approvalSchema,
  draftSchema,
  connectorSchema,
} from "../request-schema.ts";
import { randomUUID } from "node:crypto";

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
  | "routine"
  | "runRoutine"
  | "tasks"
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
    const artifact = path.match(/^\/artifacts\/([^/]+)$/);
    if (artifact && method === "GET") {
      const a =
        this.deps.db.artifacts.get(artifact[1]) || fail("找不到檔案。", 404);
      const data = await readFile(
        a.snapshotPath
          ? await new Workspace(
              join(this.deps.tasks.store.directory, "artifacts"),
            ).resolve(a.snapshotPath)
          : await this.deps.tasks.workspace.resolve(a.path),
      );
      res.writeHead(200, {
        "Content-Type": a.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      });
      res.end(data);
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
