import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Project, Session } from "../shared/types.ts";
import type { Store } from "./store.ts";
import { Workspace } from "./workspace.ts";

export class Projects {
  private store: Store;
  private fallback: Workspace;
  constructor(store: Store, fallback: Workspace) {
    this.store = store;
    this.fallback = fallback;
  }
  list(): Project[] {
    return [
      { id: "workspace", name: "預設工作區", path: this.fallback.root },
      ...(this.store.state.projects || []),
    ];
  }
  get(id = "workspace"): Project {
    const project = this.list().find((p) => p.id === id);
    if (!project)
      throw Object.assign(new Error("找不到專案。"), { status: 404 });
    return structuredClone(project);
  }
  async add(input: Record<string, unknown>) {
    if (
      typeof input.path !== "string" ||
      !path.isAbsolute(input.path) ||
      input.path.length > 4096 ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 100
    ) {
      throw Object.assign(
        new Error("請填入專案名稱與主機上的完整資料夾路徑。"),
        { status: 400 },
      );
    }
    let root: string;
    try {
      root = await realpath(input.path);
      if (!(await stat(root)).isDirectory()) throw new Error();
    } catch {
      throw Object.assign(
        new Error("資料夾不存在或無法存取；請先在執行 Apsis 的電腦上建立。"),
        { status: 400 },
      );
    }
    const project = { id: randomUUID(), name: input.name.trim(), path: root };
    // Check inside the serialized mutation too, so concurrent requests cannot duplicate roots.
    return this.store.mutate((s) => {
      const existing = this.list().find(
        (p) => path.relative(p.path, root) === "",
      );
      if (existing) return existing;
      (s.projects ||= []).push(project);
      return project;
    });
  }
  async workspace(session?: Pick<Session, "project">) {
    if (!session?.project) return this.fallback;
    const root = session.project.path;
    // A missing/replaced project must never silently create or redirect a workspace.
    try {
      if ((await realpath(root)) !== root || !(await stat(root)).isDirectory())
        throw new Error();
    } catch {
      throw Object.assign(
        new Error(
          "此對話的專案資料夾已移動或無法存取，請恢復原路徑或另開專案對話。",
        ),
        { status: 409 },
      );
    }
    return new Workspace(root);
  }
}
