import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, lstat, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
  ConversationWorkspace,
  GitChange,
  GitOverview,
} from "../shared/coding.ts";
import { Workspace } from "./workspace.ts";

const exec = promisify(execFile);
const hostDirectory = fileURLToPath(new URL("../", import.meta.url));
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function defaultWorktreeRoot() {
  const home = homedir();
  const data =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || join(home, "AppData", "Local")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support")
        : process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(data, "Apsis", "worktrees");
}
async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await resolvedPath(parent), relative(parent, path));
  }
}
/** New tasks use a durable root outside the host; existing task paths stay valid. */
export async function taskWorktreeDirectory(
  directory: string,
  configuredRoot = process.env.APSIS_WORKTREE_ROOT,
) {
  const root = await resolvedPath(
    resolve(configuredRoot || defaultWorktreeRoot()),
  );
  const host = await realpath(hostDirectory);
  const rel = relative(host, root);
  if (
    !rel ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith("..\\") &&
      !rel.startsWith("../"))
  )
    fail(
      "工作樹儲存位置必須在 Apsis 程式目錄之外，請調整 APSIS_WORKTREE_ROOT。",
    );
  // A package boundary above a bare repository would change Node's module
  // interpretation. Refuse that configuration instead of modifying the repo.
  for (let parent = root; ; parent = dirname(parent)) {
    try {
      await lstat(join(parent, "package.json"));
      fail(
        "工作樹儲存位置不可位於其他 package.json 的範圍內，請選擇獨立資料目錄。",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(parent) === parent) break;
  }
  const canonical = await resolvedPath(resolve(directory));
  const namespace = createHash("sha256")
    .update(process.platform === "win32" ? canonical.toLowerCase() : canonical)
    .digest("hex")
    .slice(0, 20);
  return join(root, namespace);
}
export async function git(root: string, ...args: string[]) {
  try {
    return (
      await exec(
        "git",
        [
          "-c",
          "core.quotepath=false",
          "-c",
          "core.hooksPath=/dev/null",
          "-C",
          root,
          ...args,
        ],
        {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 30000,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
      )
    ).stdout;
  } catch (e) {
    throw Object.assign(
      new Error(
        `Git 操作失敗：${String((e as { stderr?: string }).stderr || (e as Error).message).slice(0, 1600)}`,
      ),
      { status: 400 },
    );
  }
}
function refName(value: string) {
  if (
    !value ||
    value.startsWith("-") ||
    /[\x00-\x20]/.test(value) ||
    value.length > 250
  )
    fail("無效分支名稱。");
  return value;
}
export async function repositoryInfo(root: string) {
  const top = (await git(root, "rev-parse", "--show-toplevel")).trim();
  if (relative(await realpath(root), await realpath(top)) !== "")
    fail("請選擇 Git repository 的根目錄。");
  const branch = (await git(root, "branch", "--show-current")).trim();
  const commit = (await git(root, "rev-parse", "HEAD")).trim();
  const branches = (
    await git(
      root,
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const dirty = !!(await git(root, "status", "--porcelain")).trim();
  return { branch, commit, branches, dirty };
}
export async function createTaskWorktree(
  directory: string,
  root: string,
  id: string,
  base?: string,
  dirty?: string,
  worktreeRoot?: string,
) {
  const info = await repositoryInfo(root);
  if (info.dirty && !dirty)
    fail("專案有未提交修改，請選擇接續目前修改或從最後提交開始。", 409);
  const start = refName(base || info.branch || info.commit);
  const commit = (
    await git(root, "rev-parse", "--verify", `${start}^{commit}`)
  ).trim();
  if (dirty === "include" && commit !== info.commit)
    fail("接續目前修改需使用目前 checkout 的版本。");
  const worktrees = await taskWorktreeDirectory(directory, worktreeRoot);
  const sourceRelative = relative(await realpath(root), worktrees);
  if (
    !sourceRelative ||
    (!isAbsolute(sourceRelative) &&
      sourceRelative !== ".." &&
      !sourceRelative.startsWith("..\\") &&
      !sourceRelative.startsWith("../"))
  )
    fail("工作樹儲存位置不可位於來源專案內，請選擇獨立資料目錄。");
  const path = join(worktrees, id);
  const branch = `apsis/${id.slice(0, 12)}`;
  // Capture before creating the worktree; never stash or mutate the source checkout.
  const patch =
    dirty === "include"
      ? await git(root, "diff", "--binary", "HEAD", "--")
      : "";
  const untracked =
    dirty === "include"
      ? (await git(root, "ls-files", "--others", "--exclude-standard", "-z"))
          .split("\0")
          .filter(Boolean)
      : [];
  const copies: { path: string; data: Buffer }[] = [];
  let total = 0;
  for (const file of untracked) {
    const source = await new Workspace(root).resolve(file);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink())
      fail("無法帶入符號連結或特殊檔案。");
    total += info.size;
    if (total > 20 * 1024 * 1024)
      fail("未追蹤檔案超過 20 MiB，請先提交或排除大型檔案。");
    copies.push({ path: file, data: await readFile(source) });
  }
  await mkdir(worktrees, { recursive: true });
  await git(root, "worktree", "add", "-b", branch, path, commit);
  try {
    if (patch) {
      const patchFile = join(worktrees, `${id}.patch`);
      await writeFile(patchFile, patch, { mode: 0o600 });
      await git(path, "apply", "--binary", "--", patchFile);
    }
    for (const file of copies)
      await writeFile(
        await new Workspace(path).resolve(file.path, true),
        file.data,
      );
  } catch (e) {
    throw Object.assign(
      new Error(`${(e as Error).message}；已保留工作目錄 ${path} 供復原。`),
      { status: 409 },
    );
  }
  return {
    path,
    git: {
      repository: root,
      base: start,
      baseCommit: commit,
      branch,
      target: start,
    },
  };
}
export async function gitOverview(
  task: ConversationWorkspace,
  selected?: string,
): Promise<GitOverview> {
  if (!task.git) fail("此任務沒有 Git 專案。");
  const root = task.location.path;
  const tokens = (
    await git(
      root,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      "--name-status",
      "-z",
      task.git.baseCommit,
      "--",
    )
  )
    .split("\0")
    .filter(Boolean);
  const tracked: GitChange[] = [];
  for (let i = 0; i < tokens.length; i += 2)
    tracked.push({ path: tokens[i + 1], status: tokens[i] });
  const untracked = (
    await git(root, "ls-files", "--others", "--exclude-standard", "-z")
  )
    .split("\0")
    .filter(Boolean);
  const files: GitChange[] = [
    ...tracked,
    ...untracked
      .filter((path) => !tracked.some((f) => f.path === path))
      .map((path) => ({ path, status: "A" })),
  ].filter((f) => f.path.split(/[\\/]/).every(Workspace.allowed));
  if (selected) {
    const item = files.find((f) => f.path === selected);
    if (!item) fail("找不到修改檔案。", 404);
    const resolved = resolve(root, selected),
      rel = relative(root, resolved);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(".."))
      fail("無效檔案路徑。");
    let before = "";
    if (item.status !== "A" && !untracked.includes(selected)) {
      const object = task.git.baseCommit + ":" + selected;
      const size = Number((await git(root, "cat-file", "-s", object)).trim());
      if (size > 1024 * 1024) item.truncated = true;
      else before = await git(root, "show", object);
    }
    let after: Buffer = Buffer.alloc(0);
    try {
      const safe = await new Workspace(root).resolve(selected);
      const st = await lstat(safe);
      if (st.size > 1024 * 1024) {
        item.truncated = true;
      } else after = await readFile(safe);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") item.status = "D";
      else throw e;
    }
    item.binary = before.includes("\0") || after.includes(0);
    item.truncated ||= Buffer.byteLength(before) > 1024 * 1024;
    if (!item.binary && !item.truncated) {
      item.before = before;
      item.after = after.toString("utf8");
    }
  }
  const commits = (
    await git(root, "log", "-40", "--format=%H%x09%P%x09%s%x09%D")
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, subject, refs] = line.split("\t");
      return {
        hash,
        parents: parents.split(" ").filter(Boolean),
        subject,
        refs,
      };
    });
  const graph = await git(
    root,
    "log",
    "--graph",
    "--all",
    "--oneline",
    "--decorate",
    "-40",
  );
  return {
    branch: (await git(root, "branch", "--show-current")).trim(),
    base: task.git.base,
    baseCommit: task.git.baseCommit,
    target: task.git.target,
    files,
    commits,
    graph,
  };
}
