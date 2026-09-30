import { parseRequest, workLocationSchema } from "../request-schema.ts";
import { randomUUID, createHash } from "node:crypto";

import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { fileRevision } from "../file-manager.ts";

import { Workspace } from "../workspace.ts";

import type { WorkLocation } from "../../shared/types.ts";

import { repositoryInfo, createTaskWorktree } from "../git-workspaces.ts";
import { verificationStale } from "../coding-verification.ts";
import type { WebVerification } from "../../shared/coding-verification.ts";

import { fail, string, reply, hasStaticWebPage } from "../product-support.ts";

import type { RouteDependencies, BotRequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  "db" | "execution" | "files" | "notify" | "tasks" | "workspaces"
>;
export class BotWorkspaceRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: BotRequestContext): Promise<boolean> {
    const { req, res, url, path, method, body, id, action, bot } = context;
    if (action === "verification" && method === "GET") {
      const context = this.deps.tasks.store.conversations.context(
        bot.sessionId,
        url.searchParams.get("context") || undefined,
      );
      const location = this.deps.tasks.locations.ensure(
        bot.sessionId,
        context.id,
      );
      const receipt = this.deps.db
        .all<WebVerification>("web-verification")
        .filter((r) => r.workContextId === context.id)
        .at(-1);
      reply(res, {
        applicable: !!receipt || (await hasStaticWebPage(location.path)),
        receipt: receipt
          ? {
              ...receipt,
              stale: await verificationStale(location.path, receipt),
            }
          : null,
      });
      return true;
    }
    if (action === "changes" && method === "GET") {
      reply(
        res,
        await this.deps.workspaces.changes(
          id,
          url.searchParams.get("context") ||
            this.deps.tasks.store.conversations.activeId(bot.sessionId),
          url.searchParams.get("path") || undefined,
        ),
      );
      return true;
    }
    if (action === "work-location") {
      const history = this.deps.tasks.store.conversations;
      if (method === "GET") {
        this.deps.tasks.locations.ensure(bot.sessionId);
        reply(res, history.context(bot.sessionId));
        return true;
      }
      if (method === "PUT") {
        const input = parseRequest(workLocationSchema, await body(req));
        const context = history.context(bot.sessionId);
        if (input.contextId !== context.id)
          fail("目前話題已變更，請重新載入。", 409);
        if (
          context.locationLockedAt ||
          this.deps.execution.preparingLocations.has(context.id) ||
          [...this.deps.execution.incoming.keys()].some((key) =>
            key.startsWith(id + ":"),
          )
        )
          fail("工作位置已固定或正在設定，請完成後開啟新話題。", 409);
        this.deps.execution.preparingLocations.add(context.id);
        try {
          let location: WorkLocation =
            input.projectId !== undefined
              ? this.deps.tasks.locations.project(string(input.projectId, 100))
              : {
                  id: `folder-${randomUUID()}`,
                  name:
                    typeof input.name === "string" && input.name.trim()
                      ? string(input.name, 100)
                      : basename(string(input.path, 4096)),
                  path: await this.deps.tasks.projects.resolvePath(
                    string(input.path, 4096),
                  ),
                  kind: "folder",
                  memoryKey: `task:${context.id}`,
                };
          let gitContext: import("../../shared/coding.ts").ConversationWorkspace["git"];
          if (input.worktree === true) {
            const project = location.projectId
              ? this.deps.tasks.projects.get(location.projectId)
              : await this.deps.tasks.projects.add({
                  name: location.name,
                  path: location.path,
                });
            const work = await createTaskWorktree(
              this.deps.tasks.store.directory,
              location.path,
              createHash("sha256")
                .update(context.id)
                .digest("hex")
                .slice(0, 32),
              typeof input.branch === "string" && input.branch
                ? input.branch
                : undefined,
              typeof input.dirty === "string" ? input.dirty : undefined,
              this.deps.workspaces.worktreeRoot,
            );
            location = {
              ...location,
              id: "worktree-" + context.id,
              path: work.path,
              kind: "worktree",
              projectId: project.id,
              memoryKey: "project:" + project.id,
            };
            gitContext = work.git;
          } else {
            const info = await repositoryInfo(location.path).catch(
              () => undefined,
            );
            if (info)
              gitContext = {
                repository: location.path,
                base: info.branch,
                baseCommit: info.commit,
                branch: info.branch,
                target: info.branch,
              };
          }
          await this.deps.tasks.locations.workspace(location).ready();
          if (context.locationLockedAt)
            fail("話題已固定工作位置，請建立新話題。", 409);
          this.deps.tasks.locations.register(location);
          const attachments = this.deps.db.artifacts
            .list()
            .filter(
              (a) =>
                a.botId === bot.id &&
                a.workContextId === context.id &&
                a.kind === "attachment",
            );
          for (const a of attachments) {
            if (a.location?.id === location.id) continue;
            const source = a.snapshotPath
              ? await new Workspace(
                  join(this.deps.tasks.store.directory, "artifacts"),
                ).resolve(a.snapshotPath)
              : await this.deps.tasks.workspace.resolve(a.path);
            const data = await readFile(source);
            try {
              await this.deps.files.upload(location.id, a.path, data);
            } catch (e) {
              if (
                (e as { status?: number }).status !== 409 ||
                (await fileRevision(
                  await this.deps.files.download(location.id, a.path),
                )) !== createHash("sha256").update(data).digest("hex")
              )
                throw e;
            }
          }
          if (history.activeId(bot.sessionId) !== context.id)
            fail("目前話題已變更，請重新載入。", 409);
          const result = this.deps.tasks.locations.bind(
            bot.sessionId,
            context.id,
            location,
          );
          for (const a of attachments)
            this.deps.db.artifacts.put({ ...a, location });
          const updated = history.updateContext(bot.sessionId, context.id, {
            git: gitContext,
            pullRequest: undefined,
          });
          this.deps.notify(id);
          reply(res, updated);
          return true;
        } finally {
          this.deps.execution.preparingLocations.delete(context.id);
        }
      }
    }
    return false;
  }
}
