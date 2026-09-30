import {
  parseRequest,
  takeoverSchema,
  artifactReferenceSchema,
} from "../request-schema.ts";
import { randomUUID, createHash } from "node:crypto";

import { readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { Workspace } from "../workspace.ts";

import { fail, string, reply } from "../product-support.ts";

import type { RouteDependencies, BotRequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  "browser" | "db" | "files" | "notify" | "publish" | "routine" | "tasks"
>;
export class BotAssetRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: BotRequestContext): Promise<boolean> {
    const { req, res, url, path, method, body, id, action, bot } = context;
    if (action === "routines" && method === "POST") {
      reply(res, await this.deps.routine(id, await body(req)), 201);
      return true;
    }
    if (action === "screenshot" && method === "GET") {
      const image = await this.deps.browser.screenshot(id);
      if (!image) {
        res.writeHead(204);
        res.end();
        return true;
      }
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(image);
      return true;
    }
    if (action === "takeover" && method === "POST") {
      if (this.deps.tasks.running.size)
        fail("請先停止執行中的任務再接管共用瀏覽器。", 409);
      await this.deps.browser.takeover(
        id,
        parseRequest(takeoverSchema, await body(req)).take,
      );
      this.deps.notify(id);
      reply(res, { ok: true });
      return true;
    }
    if (action === "artifact-reference" && method === "POST") {
      const input = parseRequest(artifactReferenceSchema, await body(req));
      const contextId = this.deps.tasks.store.conversations.activeId(
        bot.sessionId,
      );
      if (input.contextId !== contextId)
        fail("目前話題已變更，請重新載入。", 409);
      const artifact =
        this.deps.db.artifacts.get(string(input.artifactId, 100)) ||
        fail("找不到成果。", 404);
      if (artifact.botId !== bot.id) fail("找不到成果。", 404);
      const source = artifact.snapshotPath
        ? await new Workspace(
            join(this.deps.tasks.store.directory, "artifacts"),
          ).resolve(artifact.snapshotPath)
        : await this.deps.tasks.workspace.resolve(artifact.path);
      const data = await readFile(source);
      if (
        this.deps.tasks.store.conversations.activeId(bot.sessionId) !==
        contextId
      )
        fail("目前話題已變更，請重新載入。", 409);
      const location = this.deps.tasks.locations.ensure(
        bot.sessionId,
        contextId,
      );
      const path = `references/${randomUUID()}/${basename(artifact.path)}`;
      await this.deps.files.upload(location.id, path, data);
      this.deps.notify(bot.id);
      reply(res, {
        locationId: location.id,
        path,
        revision: createHash("sha256").update(data).digest("hex"),
      });
      return true;
    }
    if (action === "attachments" && method === "POST") {
      const uploadContextId = this.deps.tasks.store.conversations.activeId(
        bot.sessionId,
      );
      if (
        url.searchParams.has("contextId") &&
        url.searchParams.get("contextId") !== uploadContextId
      )
        fail("目前話題已變更，請重新載入。", 409);
      const name = string(
        decodeURIComponent(String(req.headers["x-file-name"] || "")),
        200,
      );
      const ext = extname(name).toLowerCase();
      if (
        ![
          ".txt",
          ".md",
          ".csv",
          ".pdf",
          ".docx",
          ".xlsx",
          ".png",
          ".jpg",
          ".jpeg",
        ].includes(ext)
      )
        fail("不支援這個附件格式。");
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) fail("附件超過 20 MB。", 413);
        chunks.push(chunk);
      }
      const path = `attachments/${randomUUID()}/${basename(name)}`;
      if (
        uploadContextId !==
        this.deps.tasks.store.conversations.activeId(bot.sessionId)
      )
        fail("目前話題已變更，請重新載入。", 409);
      const location = this.deps.tasks.locations.ensure(
        bot.sessionId,
        uploadContextId,
      );
      await this.deps.files.upload(location.id, path, Buffer.concat(chunks));
      if (
        this.deps.tasks.store.conversations.activeId(bot.sessionId) !==
          uploadContextId ||
        this.deps.tasks.locations.ensure(bot.sessionId, uploadContextId).id !==
          location.id
      )
        fail("目前話題已變更，請重新上傳附件。", 409);
      reply(
        res,
        await this.deps.publish(
          bot,
          undefined,
          path,
          name,
          "attachment",
          undefined,
          location,
        ),
        201,
      );
      return true;
    }
    return false;
  }
}
