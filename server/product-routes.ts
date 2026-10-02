import { AssistantRoutes } from "./routes/assistant.ts";
import { CoreRoutes } from "./routes/core.ts";
import { ProjectRoutes } from "./routes/projects.ts";
import { FileRoutes } from "./routes/files.ts";
import { BotRoutes } from "./routes/bots.ts";
import { OperationRoutes } from "./routes/operations.ts";
import type { RouteDependencies, RequestContext } from "./routes/contracts.ts";
import { fail } from "./product-support.ts";

/** Dispatch only; product behavior lives in services and domain route modules. */
export class ProductRoutes {
  private readonly handlers: {
    handle(context: RequestContext): Promise<boolean>;
  }[];
  constructor(deps: RouteDependencies) {
    this.handlers = [
      new AssistantRoutes(deps),
      new CoreRoutes({
        bootstrap: deps.bootstrap,
        bot: deps.bot,
        db: deps.db,
        notify: deps.notify,
        policy: deps.policy,
        settings: deps.settings,
        snapshot: deps.snapshot,
        tasks: deps.tasks,
        template: deps.template,
      }),
      new ProjectRoutes({ notify: deps.notify, tasks: deps.tasks }),
      new FileRoutes({
        files: deps.files,
        htmlPreview: deps.htmlPreview,
        notify: deps.notify,
        readDocument: deps.readDocument,
        tasks: deps.tasks,
      }),
      new BotRoutes({
        bot: deps.bot,
        browser: deps.browser,
        create: deps.create,
        db: deps.db,
        detail: deps.detail,
        execution: deps.execution,
        files: deps.files,
        memoryScope: deps.memoryScope,
        newContext: deps.newContext,
        notify: deps.notify,
        publish: deps.publish,
        receiveMessage: deps.receiveMessage,
        remove: deps.remove,
        routine: deps.routine,
        runRecord: deps.runRecord,
        steerMessage: deps.steerMessage,
        subscribers: deps.subscribers,
        tasks: deps.tasks,
        update: deps.update,
        workLocation: deps.workLocation,
        workspaces: deps.workspaces,
      }),
      new OperationRoutes({
        htmlPreview: deps.htmlPreview,
        connector: deps.connector,
        connectors: deps.connectors,
        db: deps.db,
        decide: deps.decide,
        notify: deps.notify,
        policy: deps.policy,
        readDocument: deps.readDocument,
        routine: deps.routine,
        runRoutine: deps.runRoutine,
        tasks: deps.tasks,
        writableBot: deps.writableBot,
      }),
    ];
  }
  async handle(
    req: RequestContext["req"],
    res: RequestContext["res"],
    url: URL,
    body: RequestContext["body"],
  ) {
    const context = {
      req,
      res,
      url,
      body,
      path: url.pathname.replace(/^\/api\/v2/, ""),
      method: req.method,
    };
    for (const handler of this.handlers)
      if (await handler.handle(context)) return;
    fail("找不到這項操作。", 404);
  }
}
