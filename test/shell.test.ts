import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashPath, findBash } from "../server/shell.ts";
import { codingTools } from "../server/coding-tools.ts";
import { Workspace } from "../server/workspace.ts";
import { Store } from "../server/store.ts";
import { createTools } from "../server/tools.ts";
import type { ToolOperation } from "../shared/types.ts";
import { ToolExecutionError } from "../server/evidence.ts";

async function shellFixture(t: TestContext) {
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
  return { dir, options, shell };
}

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
  const { dir, options, shell } = await shellFixture(t);
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

test("recorded shell outcomes distinguish known nonzero completion from interruption without hiding partial effects", async (t) => {
  const { options } = await shellFixture(t);
  const operations = new Map<string, ToolOperation>();
  const shell = createTools({
    ...options,
    recordOperation: async (operation) => {
      operations.set(operation.id, structuredClone(operation));
    },
  }).find((tool) => tool.name === "shell")!;
  await assert.rejects(
    shell.execute("nonzero", {
      command: "printf 'retained' > partial.txt; printf 'check failed'; exit 7",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolExecutionError);
      assert.equal(error.outcome, "failed");
      return true;
    },
  );
  assert.equal(
    await readFile(join(options.workspace.root, "partial.txt"), "utf8"),
    "retained",
    "failure does not imply rollback",
  );
  const [failed] = [...operations.values()];
  assert.equal(failed.status, "failed");
  assert.equal(failed.evidence?.exitCode, 7);
  assert.equal(failed.evidence?.output, "check failed");
  await assert.rejects(
    shell.execute("timeout", {
      command: "printf 'started'; sleep 30 & wait",
      timeout: 1,
    }),
    /逾時/,
  );
  const timedOut = [...operations.values()].at(-1)!;
  assert.equal(timedOut.status, "unknown");
  assert.equal(timedOut.evidence?.output, "started");
  const controller = new AbortController();
  const cancelled = shell.execute(
    "cancel",
    { command: "sleep 30 & wait" },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(cancelled, /停止/);
  assert.equal([...operations.values()].at(-1)!.status, "unknown");
});

test("real Bash executes complete commands beyond Windows argv limits", async (t) => {
  const { shell } = await shellFixture(t);
  const command = `printf 'START\\n'\n#${"x".repeat(40_000)}\nprintf 'END\\n'\n`;
  const result = await shell.execute("long-command", { command });
  assert.equal(
    result.content[0].type === "text" && result.content[0].text,
    "START\nEND\n",
  );
});

test("real Bash writes a complete long Unicode heredoc without expansion", async (t) => {
  const { options, shell } = await shellFixture(t);
  const content =
    Array.from(
      { length: 600 },
      (_, i) => `第 ${i} 行：分帳 🧾，quote ' \" $HOME $(printf unexpected) \\`,
    ).join("\n") + "\n";
  const result = await shell.execute("long-heredoc", {
    command: `cat > '中文 file.txt' <<'APSIS_HEREDOC'\n${content}APSIS_HEREDOC\nprintf 'written'\n`,
  });
  assert.equal(
    await readFile(join(options.workspace.root, "中文 file.txt"), "utf8"),
    content,
  );
  assert.equal(
    result.content[0].type === "text" && result.content[0].text,
    "written",
  );
});

test("real Bash keeps stdin at EOF and preserves a long script's exit code", async (t) => {
  const { shell } = await shellFixture(t);
  await assert.rejects(
    shell.execute("stdin-eof", {
      command: `#${"x".repeat(20_000)}\ncat\nif read -r answer; then exit 91; fi\nprintf 'after EOF'\nexit 17\n`,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolExecutionError);
      assert.equal(error.evidence.exitCode, 17);
      assert.equal(error.evidence.output, "after EOF");
      return true;
    },
  );
});

test("real Bash times out long scripts and retains earlier output", async (t) => {
  const { shell } = await shellFixture(t);
  const started = Date.now();
  await assert.rejects(
    shell.execute("timeout", {
      command: `#${"x".repeat(20_000)}\nprintf 'before timeout'\nsleep 30 & wait\nprintf 'unreachable'\n`,
      timeout: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ToolExecutionError);
      assert.match(error.message, /逾時/);
      assert.equal(error.evidence.output, "before timeout");
      return true;
    },
  );
  assert.ok(Date.now() - started < 8000);
});

test("shell tolerates stdin EPIPE when an executable exits before consuming source", async (t) => {
  const { shell } = await shellFixture(t);
  const original = process.env.APSIS_SHELL_PATH;
  try {
    // Node rejects Bash flags immediately, while the source still exceeds the
    // pipe buffer. This exercises the real early-exit/EPIPE path, without mocks.
    process.env.APSIS_SHELL_PATH = process.execPath;
    await assert.rejects(
      shell.execute("early-exit", { command: `#${"x".repeat(2_000_000)}` }),
      (error: unknown) => {
        assert.ok(error instanceof ToolExecutionError);
        assert.notEqual(error.evidence.exitCode, 0);
        return true;
      },
    );
  } finally {
    if (original === undefined) delete process.env.APSIS_SHELL_PATH;
    else process.env.APSIS_SHELL_PATH = original;
  }
});
