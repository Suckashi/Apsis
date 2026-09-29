import { createHash } from "node:crypto";
import { join } from "node:path";
import type { WorkLocation } from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { Projects } from "./projects.ts";
import { Workspace } from "./workspace.ts";

/** A location belongs to a work context, never to a selected UI tab. */
export class WorkLocations {
  private store: Store;
  private projects: Projects;
  private fallback: Workspace;
  constructor(store: Store, projects: Projects, fallback: Workspace) {
    this.store = store;
    this.projects = projects;
    this.fallback = fallback;
  }
  ensure(
    sessionId: string,
    contextId = this.store.conversations.activeId(sessionId),
  ): WorkLocation {
    const context = this.store.conversations.context(sessionId, contextId);
    if (context.location) return context.location;
    const id = createHash("sha256")
      .update(sessionId + ":" + contextId)
      .digest("hex")
      .slice(0, 24);
    const location: WorkLocation = {
      id: `task-${id}`,
      name: "聊天資料夾",
      kind: "task",
      path: join(this.fallback.root, "tasks", id),
      memoryKey: `task:${contextId}`,
    };
    this.register(location);
    this.store.conversations.updateContext(sessionId, contextId, { location });
    return location;
  }
  bind(sessionId: string, contextId: string, location: WorkLocation) {
    const context = this.store.conversations.context(sessionId, contextId);
    if (context.locationLockedAt)
      throw Object.assign(new Error("任務已固定工作位置，請建立新話題。"), {
        status: 409,
      });
    if (context.location) this.register(context.location);
    this.register(location);
    return this.store.conversations.updateContext(sessionId, contextId, {
      location: structuredClone(location),
    });
  }
  lock(sessionId: string, contextId: string) {
    const location = this.ensure(sessionId, contextId);
    if (
      !this.store.conversations.context(sessionId, contextId).locationLockedAt
    )
      this.store.conversations.updateContext(sessionId, contextId, {
        locationLockedAt: new Date().toISOString(),
      });
    return structuredClone(location);
  }
  project(id: string): WorkLocation {
    const p = this.projects.get(id);
    return {
      id: `project-${p.id}`,
      name: p.name,
      path: p.path,
      projectId: p.id,
      kind: "project",
      memoryKey: `project:${p.id}`,
    };
  }
  register(location: WorkLocation) {
    this.store.conversations.db
      .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)")
      .run(`work-location:${location.id}`, JSON.stringify(location));
  }
  list(): WorkLocation[] {
    const locations = new Map<string, WorkLocation>();
    for (const row of this.store.conversations.db
      .prepare("SELECT value FROM meta WHERE key LIKE 'work-location:%'")
      .all()) {
      const location = JSON.parse(String(row.value)) as WorkLocation;
      locations.set(location.id, location);
    }
    for (const row of this.store.conversations.db
      .prepare("SELECT value FROM contexts")
      .all()) {
      const location = JSON.parse(String(row.value)).location as
        | WorkLocation
        | undefined;
      if (location) locations.set(location.id, location);
    }
    for (const p of this.projects.list())
      locations.set(`project-${p.id}`, this.project(p.id));
    return [...locations.values()];
  }
  get(id: string) {
    const location = this.list().find((l) => l.id === id);
    if (!location)
      throw Object.assign(new Error("找不到工作資料夾。"), { status: 404 });
    return location;
  }
  workspace(location: WorkLocation) {
    return new Workspace(
      location.path,
      location.kind === "task",
      Workspace.contains(this.store.directory, location.path)
        ? []
        : [this.store.directory],
    );
  }
}
