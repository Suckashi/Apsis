import {
  parseRequest,
  permissionPreviewSchema,
  settingsSchema,
  drawSchema,
} from "../request-schema.ts";
import { repositoryInfo } from "../git-workspaces.ts";

import { fail, string, reply } from "../product-support.ts";

import type { RouteDependencies, RequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  | "avatarCollection"
  | "bootstrap"
  | "bot"
  | "db"
  | "notify"
  | "policy"
  | "settings"
  | "snapshot"
  | "tasks"
  | "template"
>;
export class CoreRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: RequestContext): Promise<boolean> {
    const { req, res, url, path, method, body } = context;
    if (path === "/bootstrap" && req.method === "POST") {
      await this.deps.bootstrap();
      reply(res, { ok: true });
      return true;
    }
    const repoMatch = path.match(/^\/projects\/([^/]+)\/git$/);
    if (repoMatch && req.method === "GET") {
      reply(
        res,
        await repositoryInfo(this.deps.tasks.projects.get(repoMatch[1]).path),
      );
      return true;
    }
    if (path === "/permissions/preview" && method === "POST") {
      const input = parseRequest(permissionPreviewSchema, await body(req));
      const botId = string(input.botId, 100);
      this.deps.bot(botId);
      const tool = string(input.tool, 200);
      if (
        !input.args ||
        typeof input.args !== "object" ||
        Array.isArray(input.args)
      )
        fail("工具參數需為物件。");
      const runId = typeof input.runId === "string" ? input.runId : "";
      reply(res, this.deps.policy(botId, runId, tool, input.args));
      return true;
    }
    if (path === "/settings") {
      if (method === "GET") {
        reply(res, this.deps.settings.read());
        return true;
      }
      if (method === "PATCH") {
        const saved = this.deps.settings.update(
          parseRequest(settingsSchema, await body(req)),
        );
        this.deps.notify();
        reply(res, saved);
        return true;
      }
    }
    if (path === "/templates") {
      if (method === "GET") {
        reply(res, this.deps.db.templates.list());
        return true;
      }
      if (method === "POST") {
        reply(res, this.deps.template(await body(req)), 201);
        return true;
      }
    }
    const templateMatch = path.match(/^\/templates\/([^/]+)$/);
    if (templateMatch) {
      if (!this.deps.db.get("template", templateMatch[1]))
        fail("找不到 Bot 範本。", 404);
      if (method === "PUT") {
        reply(res, this.deps.template(await body(req), templateMatch[1]));
        return true;
      }
      if (method === "DELETE") {
        this.deps.db.templates.remove(templateMatch[1]);
        this.deps.notify();
        reply(res, { ok: true });
        return true;
      }
    }
    if (path === "/avatar-collection/draw" && method === "POST") {
      const input = parseRequest(drawSchema, await body(req));
      const result = this.deps.avatarCollection.draw(input.requestId);
      this.deps.notify();
      reply(res, result);
      return true;
    }
    if (path === "/state" && method === "GET") {
      reply(res, this.deps.snapshot());
      return true;
    }
    return false;
  }
}
