import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseDocument, stringify } from "yaml";
import type { Skill } from "../shared/types.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function writeNew(file: string, content: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    // Publish only complete files, and never replace user-created files.
    linkSync(temporary, file);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** File-backed shared skills. Discovery never writes to the user's global folder. */
export class SkillCatalog {
  local: string;
  global: string;
  diagnostics: { path: string; message: string }[] = [];
  constructor(
    directory: string,
    global = join(homedir(), ".agents", "skills"),
  ) {
    this.local = resolve(directory, "skills");
    this.global = resolve(global);
  }

  migrate(skills: Skill[]) {
    const marker = join(this.local, ".migrated-v1.json");
    if (existsSync(marker)) {
      if (JSON.parse(readFileSync(marker, "utf8")).version !== 1)
        fail("技能遷移標記格式錯誤。");
      return;
    }
    mkdirSync(this.local, { recursive: true });
    const backup = join(this.local, ".legacy-backup.json");
    if (!existsSync(backup)) writeNew(backup, JSON.stringify(skills, null, 2));
    // Resume from the original backup after interruption, never from a partial migration.
    const original: Skill[] = JSON.parse(readFileSync(backup, "utf8"));
    for (const skill of original.filter(
      (s) => !s.agentId && s.enabled !== false && !s.mergedInto,
    )) {
      const folder = join(
        this.local,
        `migrated-${digest(skill.id).slice(0, 24)}`,
      );
      const file = join(folder, "SKILL.md");
      if (!existsSync(file)) this.write(skill, folder);
      else if (this.parse(file, true).id !== skill.id)
        fail(`技能遷移遇到既有檔案：${file}`);
    }
    writeNew(marker, JSON.stringify({ version: 1 }));
  }

  private text(file: string) {
    if (!statSync(file).isFile() || statSync(file).size > 1024 * 1024)
      fail("技能檔案需為 1 MiB 以內的文字檔。");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      readFileSync(file),
    );
    if (value.includes("\0")) fail("技能檔案不能包含二進位內容。");
    return value.replace(/^\uFEFF/, "");
  }

  private parse(file: string, local: boolean): Skill {
    let content = this.text(file);
    let meta: Record<string, unknown> = {};
    if (/^---\r?\n/.test(content)) {
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) fail("SKILL.md 的 frontmatter 未結束。");
      const document = parseDocument(match[1]);
      if (document.errors.length) fail("SKILL.md 的 YAML 格式錯誤。");
      const value = document.toJS({ maxAliasCount: 0 });
      if (value !== null && (typeof value !== "object" || Array.isArray(value)))
        fail("技能 frontmatter 必須是物件。");
      meta = value || {};
      content = content.slice(match[0].length);
    }
    if (!content.trim()) fail("技能內容不可為空。");
    for (const key of ["name", "description", "x-apsis-id"])
      if (
        meta[key] !== undefined &&
        (typeof meta[key] !== "string" || !String(meta[key]).trim())
      )
        fail(`技能 ${key} 必須是非空文字。`);
    const folder = resolve(file, "..");
    const name =
      typeof meta.name === "string"
        ? meta.name.trim()
        : folder.split(sep).at(-1)!;
    return {
      id:
        local && typeof meta["x-apsis-id"] === "string"
          ? meta["x-apsis-id"]
          : `file-${digest(file).slice(0, 32)}`,
      name,
      content,
      description:
        typeof meta.description === "string"
          ? meta.description
          : content.trim().slice(0, 120),
      skillDirectory: folder,
    };
  }

  list(): Skill[] {
    this.diagnostics = [];
    const names = new Map<string, Skill>();
    const ids = new Set<string>();
    for (const [root, local] of [
      [this.local, true],
      [this.global, false],
    ] as const) {
      if (!existsSync(root)) continue;
      try {
        const actualRoot = realpathSync(root);
        for (const entry of readdirSync(root, { withFileTypes: true }).sort(
          (a, b) => a.name.localeCompare(b.name),
        )) {
          if (entry.name.startsWith(".")) continue;
          const file = join(root, entry.name, "SKILL.md");
          if (!existsSync(file)) continue;
          try {
            if (!within(actualRoot, realpathSync(file)))
              fail("技能連結不可指向來源目錄以外。");
            const skill = this.parse(file, local);
            if (names.has(skill.name)) continue;
            if (ids.has(skill.id)) fail("技能識別碼重複。");
            names.set(skill.name, skill);
            ids.add(skill.id);
          } catch (error) {
            this.diagnostics.push({
              path: file,
              message: (error as Error).message,
            });
          }
        }
      } catch (error) {
        this.diagnostics.push({
          path: root,
          message: (error as Error).message,
        });
      }
    }
    return [...names.values()];
  }

  read(id: string, path?: string): Skill | { path: string; content: string } {
    const skill = this.list().find((s) => s.id === id);
    if (!skill) return fail("找不到技能。", 404);
    if (path === undefined) return skill;
    if (
      typeof path !== "string" ||
      !path ||
      isAbsolute(path) ||
      /^[a-z]:/i.test(path) ||
      path.includes(":")
    )
      fail("技能資源需為相對路徑。");
    const root = realpathSync(skill.skillDirectory!);
    const file = resolve(root, path.replaceAll("\\", "/"));
    if (!within(root, file)) fail("技能資源不可超出技能目錄。", 403);
    let actual: string;
    try {
      actual = realpathSync(file);
    } catch {
      return fail("找不到技能資源。", 404);
    }
    if (!within(root, actual)) fail("技能資源連結不可超出技能目錄。", 403);
    return { path, content: this.text(actual) };
  }

  create(skill: Skill): { skill: Skill; created: boolean } {
    const existing = this.list().find((s) => s.name === skill.name);
    if (existing) {
      if (existing.content.trim() === skill.content.trim())
        return { skill: existing, created: false };
      return fail("同名技能已存在，請修改技能檔案或使用其他名稱。", 409);
    }
    this.write(skill, join(this.local, `skill-${randomUUID()}`));
    return {
      skill: this.list().find((s) => s.id === skill.id)!,
      created: true,
    };
  }

  private write(skill: Skill, folder: string) {
    mkdirSync(folder, { recursive: true });
    if (!within(realpathSync(this.local), realpathSync(folder)))
      fail("技能寫入目錄不可超出 Apsis 技能目錄。", 403);
    writeNew(
      join(folder, "SKILL.md"),
      `---\n${stringify({ name: skill.name, "x-apsis-id": skill.id })}---\n${skill.content}`,
    );
  }
}
