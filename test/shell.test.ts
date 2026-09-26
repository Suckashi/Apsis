import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashPath, findBash } from "../server/shell.ts";
import { codingTools } from "../server/coding-tools.ts";
import { Workspace } from "../server/workspace.ts";
import { Store } from "../server/store.ts";

test("Bash discovery on both platforms and Windows path translation", () => {
  const windows = {
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd" },
    exists: (p: string) => p.endsWith("bash.exe"),
  };
  assert.equal(findBash(windows), "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
  assert.equal(
    findBash({
      ...windows,
      env: { APSIS_SHELL_PATH: "C:\\Windows\\System32\\bash.exe" },
    }),
    undefined,
  );
  assert.equal(
    findBash({ platform: "linux", env: {}, exists: (p) => p === "/bin/bash" }),
    "/bin/bash",
  );
  assert.equal(
    findBash({
      platform: "linux",
      env: { PATH: "/custom/bin" },
      exists: (p) => p === "/custom/bin/bash",
    }),
    "/custom/bin/bash",
  );
  assert.equal(
    findBash({
      platform: "linux",
      env: { APSIS_SHELL_PATH: "/missing" },
      exists: (p) => p === "/bin/bash",
    }),
    undefined,
  );
  assert.equal(bashPath("D:\\專案 空白\\src", "win32"), "/d/專案 空白/src");
  assert.equal(bashPath("/tmp/project", "linux"), "/tmp/project");
});

test("real Bash handles unicode paths, quoting, failure, and cancellation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis Bash 中文 "));
  const options = {
    store: await new Store(join(dir, "data")).init(),
    workspace: await new Workspace(join(dir, "work space")).init(),
    allowWrites: true,
    permissions: { files: true, shell: true, memory: false, skills: false },
  };
  t.after(async () => {
    options.store.conversations.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const shell = codingTools(options).find((tool) => tool.name === "shell")!;
  assert.ok(shell, "CI must install Bash");
  const result = await shell.execute("run", {
    command: "printf '%s' '中文 a b' > 'file name.txt'; cat 'file name.txt'",
  });
  assert.equal(
    result.content[0].type === "text" && result.content[0].text,
    "中文 a b",
  );
  await assert.rejects(shell.execute("failure", { command: "exit 7" }), /7/);
  const controller = new AbortController();
  const execution = shell.execute(
    "cancel",
    { command: "sleep 30 & wait" },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 150);
  const started = Date.now();
  await assert.rejects(execution, /停止/);
  assert.ok(Date.now() - started < 8000);
  const original = process.env.APSIS_SHELL_PATH;
  try {
    process.env.APSIS_SHELL_PATH = join(dir, "missing-bash");
    const tools = codingTools(options);
    assert.equal(
      tools.some((tool) => tool.name === "shell"),
      false,
    );
    assert.ok(tools.some((tool) => tool.name === "write_file"));
  } finally {
    if (original === undefined) delete process.env.APSIS_SHELL_PATH;
    else process.env.APSIS_SHELL_PATH = original;
  }
});
