import { randomUUID } from "node:crypto";
import { realpath, stat, mkdir } from "node:fs/promises";
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
    if (input.path === undefined || input.path === "") {
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 100
      )
        throw new Error("請填入專案名稱。");
      const root = path.resolve(
        this.store.directory,
        "projects",
        randomUUID(),
        "workspace",
      );
      await mkdir(root, { recursive: true });
      input = { ...input, path: root };
    }
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
    const root = await this.resolvePath(input.path);
    const project = {
      id: randomUUID(),
      name: input.name.trim(),
      path: root,
      description:
        typeof input.description === "string"
          ? input.description.slice(0, 4000)
          : "",
    };
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
  async resolvePath(inputPath: string) {
    if (
      typeof inputPath !== "string" ||
      !path.isAbsolute(inputPath) ||
      inputPath.length > 4096
    )
      throw Object.assign(new Error("請輸入主機上的完整資料夾路徑。"), {
        status: 400,
      });
    let root: string;
    try {
      root = await realpath(inputPath);
      if (!(await stat(root)).isDirectory()) throw new Error();
    } catch {
      throw Object.assign(
        new Error("資料夾不存在或無法存取；請先在執行 Apsis 的電腦上建立。"),
        { status: 400 },
      );
    }
    const registeredRoots = [
      this.fallback.root,
      ...(this.store.state.projects || []).map((p) => p.path),
    ];
    const managed = path
      .relative(path.join(this.store.directory, "projects"), root)
      .split(path.sep);
    const isManaged =
      managed.length === 2 &&
      /^[0-9a-f-]{36}$/i.test(managed[0]) &&
      managed[1] === "workspace";
    if (
      root.split(/[\\/]/).some((part) => part.toLowerCase() === ".git") ||
      (Workspace.contains(this.store.directory, root) &&
        !isManaged &&
        !registeredRoots.some(
          (base) =>
            path.relative(this.store.directory, base) !== "" &&
            Workspace.contains(this.store.directory, base) &&
            Workspace.contains(base, root),
        ))
    )
      throw Object.assign(
        new Error("不能將 Apsis 系統資料或 Git 內部資料設為工作資料夾。"),
        { status: 403 },
      );
    await new Workspace(root).ready();
    return root;
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
