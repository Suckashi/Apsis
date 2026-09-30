import { BotWorkspaceRoutes } from "./bot-workspaces.ts";
import { BotConversationRoutes } from "./bot-conversations.ts";
import { BotAssetRoutes } from "./bot-assets.ts";

import { string, reply } from "../product-support.ts";

import type { RouteDependencies, RequestContext } from "./contracts.ts";

type Dependencies = Pick<
  RouteDependencies,
  | "bot"
  | "browser"
  | "create"
  | "db"
  | "detail"
  | "execution"
  | "files"
  | "memoryScope"
  | "newContext"
  | "notify"
  | "publish"
  | "receiveMessage"
  | "remove"
  | "routine"
  | "runRecord"
  | "steerMessage"
  | "subscribers"
  | "tasks"
  | "update"
  | "workLocation"
  | "workspaces"
>;
export class BotRoutes {
  private readonly deps: Dependencies;
  private readonly actions: {
    handle(
      context: import("./contracts.ts").BotRequestContext,
    ): Promise<boolean>;
  }[];
  constructor(deps: Dependencies) {
    this.deps = deps;
    this.actions = [
      new BotWorkspaceRoutes({
        db: deps.db,
        execution: deps.execution,
        files: deps.files,
        notify: deps.notify,
        tasks: deps.tasks,
        workspaces: deps.workspaces,
      }),
      new BotConversationRoutes({
        db: deps.db,
        detail: deps.detail,
        execution: deps.execution,
        memoryScope: deps.memoryScope,
        newContext: deps.newContext,
        notify: deps.notify,
        receiveMessage: deps.receiveMessage,
        remove: deps.remove,
        runRecord: deps.runRecord,
        steerMessage: deps.steerMessage,
        tasks: deps.tasks,
        update: deps.update,
        workLocation: deps.workLocation,
      }),
      new BotAssetRoutes({
        browser: deps.browser,
        db: deps.db,
        files: deps.files,
        notify: deps.notify,
        publish: deps.publish,
        routine: deps.routine,
        tasks: deps.tasks,
      }),
    ];
  }
  async handle(context: RequestContext): Promise<boolean> {
    const { req, res, url, path, method, body } = context;
    if (path === "/events" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const after = Number(req.headers["last-event-id"] || 0);
      for (const event of this.deps.db.events(
        Number.isSafeInteger(after) ? after : 0,
      ))
        res.write(`id: ${event.id}\ndata: ${event.value}\n\n`);
      res.write("data: {}\n\n");
      this.deps.subscribers.add(res);
      res.on("close", () => this.deps.subscribers.delete(res));
      return true;
    }
    if (path === "/bots" && method === "POST") {
      const input = await body(req);
      reply(
        res,
        await this.deps.create(
          input.name === undefined ? undefined : string(input.name, 80),
          input,
        ),
        201,
      );
      return true;
    }
    const match = path.match(/^\/bots\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const id = match[1],
        action = match[2] || "";
      const bot = this.deps.bot(id);
      for (const handler of this.actions)
        if (await handler.handle({ ...context, id, action, bot })) return true;
    }
    return false;
  }
}
