import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { Workspace } from "../server/workspace.ts";
import { createTools } from "../server/tools.ts";
import type { ToolOperation } from "../shared/types.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "apsis-coding-"));
  const store = await new Store(join(dir, "data")).init();
  const workspace = await new Workspace(join(dir, "work")).init();
  return { store, workspace, allowWrites: true };
}

test("coding edits require writes, preserve unmatched text and reject ambiguous or escaped paths", async () => {
  const options = await fixture();
  await options.workspace.write("hello.txt", "before\r\nunique\r\nafter\r\n");
  const args = {
    path: "hello.txt",
    edits: [{ oldText: "unique", newText: "changed" }],
  };
  const denied = createTools({ ...options, allowWrites: false }).find(
    (t) => t.name === "edit_file",
  )!;
  await assert.rejects(denied.execute("a", args), /尚未/);
  const edit = createTools(options).find((t) => t.name === "edit_file")!;
  await edit.execute("a", args);
  assert.equal(
    await options.workspace.read("hello.txt"),
    "before\r\nchanged\r\nafter\r\n",
  );
  for (const path of [
    "../escape.txt",
    ".env",
    join(options.workspace.root, "hello.txt"),
  ]) {
    await assert.rejects(edit.execute("a", { ...args, path }));
  }
  await options.workspace.write("repeat.txt", "duplicate duplicate");
  await assert.rejects(
    edit.execute("a", {
      path: "repeat.txt",
      edits: [{ oldText: "duplicate", newText: "one" }],
    }),
  );
  assert.equal(
    await options.workspace.read("repeat.txt"),
    "duplicate duplicate",
  );
});

test("shell is opt-in, runs in the workspace, journals effects and excludes inherited secrets", async () => {
  const options = await fixture();
  for (const permissions of [
    undefined,
    { files: true, memory: false, skills: false },
    { files: false, shell: true, memory: false, skills: false },
  ]) {
    assert.ok(
      !createTools({ ...options, permissions }).some((t) => t.name === "shell"),
    );
  }
  const operations: ToolOperation[] = [];
  const shell = createTools({
    ...options,
    permissions: { files: true, shell: true, memory: false, skills: false },
    recordOperation: async (op) => {
      operations.push(op);
    },
  }).find((t) => t.name === "shell")!;
  process.env.APSIS_TEST_SECRET = "must-not-inherit";
  try {
    const command =
      process.platform === "win32"
        ? "[IO.File]::WriteAllText((Join-Path (Get-Location) 'shell.txt'), 'shell-ok'); Write-Output ('secret=' + $env:APSIS_TEST_SECRET)"
        : "printf shell-ok > shell.txt; printf 'secret=%s' \"$APSIS_TEST_SECRET\"";
    const output = await shell.execute("a", { command });
    assert.equal(await options.workspace.read("shell.txt"), "shell-ok");
    assert.ok(!JSON.stringify(output).includes("must-not-inherit"));
    assert.equal(operations.at(-1)?.status, "succeeded");
    assert.equal(operations.at(-1)?.mutating, true);
    await assert.rejects(shell.execute("b", { command: "exit 7" }));
    assert.equal(operations.at(-1)?.status, "unknown");
  } finally {
    delete process.env.APSIS_TEST_SECRET;
  }
});

test("shell timeout and cancellation terminate running commands", async () => {
  const options = await fixture();
  const shell = createTools({
    ...options,
    permissions: { files: true, shell: true, memory: false, skills: false },
  }).find((t) => t.name === "shell")!;
  const command =
    process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
  const start = Date.now();
  await assert.rejects(
    shell.execute("timeout", { command, timeout: 1 }),
    /timeout|timed out/i,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    await assert.rejects(
      shell.execute("cancel", { command }, controller.signal),
      /abort/i,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.ok(Date.now() - start < 15000);
});
