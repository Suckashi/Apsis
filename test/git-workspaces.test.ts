import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createTaskWorktree,
  git,
  taskWorktreeDirectory,
} from "../server/git-workspaces.ts";

const exec = promisify(execFile);

test("new worktrees escape the host package scope and preserve clean and dirty Unicode repositories", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-isolation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = join(directory, "宿主 Apsis");
  const source = join(host, "來源 專案");
  const data = join(host, ".apsis");
  const storage = join(directory, "獨立 工作樹");
  await mkdir(source, { recursive: true });
  await mkdir(data);
  await writeFile(
    join(host, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await git(source, "init");
  await git(source, "config", "core.autocrlf", "false");
  await git(source, "config", "user.name", "Fixture");
  await git(source, "config", "user.email", "test@example.invalid");
  await writeFile(
    join(source, "module.js"),
    "module.exports = { value: '完整中文 🧾' };\n",
  );
  await writeFile(
    join(source, "read.cjs"),
    "console.log(require('./module.js').value);\n",
  );
  await git(source, "add", ".");
  await git(source, "commit", "-m", "initial");
  const branch = (await git(source, "branch", "--show-current")).trim();
  const commit = (await git(source, "rev-parse", "HEAD")).trim();
  await assert.rejects(
    createTaskWorktree(
      data,
      source,
      "nested-task",
      undefined,
      undefined,
      join(source, "worktrees"),
    ),
    /來源專案內|package.json/,
  );
  // Reproduce the real parent-package failure before verifying the new location.
  await assert.rejects(
    exec(process.execPath, ["read.cjs"], { cwd: source, windowsHide: true }),
  );
  const clean = await createTaskWorktree(
    data,
    source,
    "clean-task",
    undefined,
    undefined,
    storage,
  );
  assert.ok(relative(host, clean.path).startsWith(".."));
  assert.ok(clean.path.startsWith(await taskWorktreeDirectory(data, storage)));
  const result = await exec(process.execPath, ["read.cjs"], {
    cwd: clean.path,
    windowsHide: true,
  });
  assert.equal(result.stdout.trim(), "完整中文 🧾");
  await assert.rejects(access(join(clean.path, "package.json")));
  assert.equal((await git(clean.path, "status", "--porcelain")).trim(), "");

  await writeFile(
    join(source, "module.js"),
    "module.exports = { value: 'dirty' };\n",
  );
  await writeFile(join(source, "新增.txt"), "保留未提交內容\n");
  const beforeStatus = await git(source, "status", "--porcelain");
  await assert.rejects(
    createTaskWorktree(
      data,
      source,
      "must-choose",
      undefined,
      undefined,
      storage,
    ),
    /未提交修改/,
  );
  const dirty = await createTaskWorktree(
    data,
    source,
    "dirty-task",
    undefined,
    "include",
    storage,
  );
  const excluded = await createTaskWorktree(
    data,
    source,
    "exclude-task",
    undefined,
    "exclude",
    storage,
  );
  assert.equal(
    await readFile(join(dirty.path, "新增.txt"), "utf8"),
    "保留未提交內容\n",
  );
  assert.equal(
    await readFile(join(dirty.path, "module.js"), "utf8"),
    "module.exports = { value: 'dirty' };\n",
  );
  assert.equal(
    await readFile(join(excluded.path, "module.js"), "utf8"),
    "module.exports = { value: '完整中文 🧾' };\n",
  );
  await assert.rejects(access(join(excluded.path, "新增.txt")));
  assert.equal(await git(source, "status", "--porcelain"), beforeStatus);
  assert.equal((await git(source, "branch", "--show-current")).trim(), branch);
  assert.equal((await git(source, "rev-parse", "HEAD")).trim(), commit);
  assert.match(
    await git(source, "worktree", "list", "--porcelain"),
    /branch refs\/heads\/apsis\/dirty-task/,
  );
});

test("worktree roots are persistent, data-directory scoped, configurable and outside package scopes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-worktree-roots-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = join(directory, "data");
  const storage = join(directory, "external");
  await mkdir(data);
  const first = await taskWorktreeDirectory(data, storage);
  assert.equal(first, await taskWorktreeDirectory(join(data, "."), storage));
  assert.notEqual(
    first,
    await taskWorktreeDirectory(join(directory, "another-data"), storage),
  );
  await assert.rejects(
    taskWorktreeDirectory(data, resolve(".apsis", "worktrees")),
    /Apsis 程式目錄之外/,
  );
  const packageRoot = join(directory, "package-root");
  await mkdir(packageRoot);
  await writeFile(join(packageRoot, "package.json"), '{"type":"module"}');
  await assert.rejects(
    taskWorktreeDirectory(data, join(packageRoot, "worktrees")),
    /package.json/,
  );
  const previous = process.env.APSIS_WORKTREE_ROOT;
  try {
    process.env.APSIS_WORKTREE_ROOT = storage;
    assert.equal(await taskWorktreeDirectory(data), first);
  } finally {
    if (previous === undefined) delete process.env.APSIS_WORKTREE_ROOT;
    else process.env.APSIS_WORKTREE_ROOT = previous;
  }
});
