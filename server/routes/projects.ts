import {
  parseRequest,
  projectSchema,
  memorySchema,
  projectPatchSchema,
} from "../request-schema.ts";
import { changeMemory } from "../memory.ts";

import { fail, string, reply } from "../product-support.ts";

import type { RouteDependencies, RequestContext } from "./contracts.ts";

type Dependencies = Pick<RouteDependencies, "notify" | "tasks">;
export class ProjectRoutes {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async handle(context: RequestContext): Promise<boolean> {
    const { req, res, url, path, method, body } = context;
    if (path === "/projects") {
      if (method === "GET") {
        reply(res, this.deps.tasks.projects.list());
        return true;
      }
      if (method === "POST") {
        const project = await this.deps.tasks.projects.add(
          parseRequest(projectSchema, await body(req)),
        );
        this.deps.notify();
        reply(res, project, 201);
        return true;
      }
    }
    const projectMemory = path.match(/^\/projects\/([^/]+)\/memories$/);
    if (projectMemory) {
      const project = this.deps.tasks.projects.get(projectMemory[1]);
      const scopeKey = `project:${project.id}`;
      if (method === "GET") {
        reply(
          res,
          this.deps.tasks.store.state.memories.filter(
            (m) => m.scopeKey === scopeKey && !m.mergedInto,
          ),
        );
        return true;
      }
      if (method === "POST") {
        const input = parseRequest(memorySchema, await body(req));
        const memory = await this.deps.tasks.store.mutate((state) =>
          changeMemory(state, undefined, input, { kind: "manual" }, scopeKey),
        );
        this.deps.notify();
        reply(res, memory);
        return true;
      }
    }
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    if (projectMatch && method === "PATCH") {
      const input = parseRequest(projectPatchSchema, await body(req));
      const project = await this.deps.tasks.store.mutate((state) => {
        const p =
          state.projects?.find((p) => p.id === projectMatch[1]) ||
          fail("找不到專案。", 404);
        if (input.name !== undefined) p.name = string(input.name, 100);
        if (input.description !== undefined) {
          if (
            typeof input.description !== "string" ||
            input.description.length > 4000
          )
            fail("專案說明過長。");
          p.description = input.description as string;
        }
        return p;
      });
      this.deps.notify();
      reply(res, project);
      return true;
    }
    return false;
  }
}
