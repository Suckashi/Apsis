import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { appDirectories } from "../server/app-directories.ts";
import { createApp } from "../server/app.ts";
import { Workspace } from "../server/workspace.ts";

const index = fileURLToPath(new URL("../server/index.ts", import.meta.url));

test("startup directories share one default and custom data implies a matching workspace", () => {
  assert.deepEqual(appDirectories({}, {}), {
    dataDir: resolve(".apsis-v4"),
    workspaceDir: resolve(".apsis-v4/workspace"),
  });
  assert.deepEqual(appDirectories({}, { APSIS_DATA_DIR: "custom-data" }), {
    dataDir: resolve("custom-data"),
    workspaceDir: resolve("custom-data/workspace"),
  });
  assert.deepEqual(
    appDirectories(
      { dataDir: "explicit-data", workspaceDir: "explicit-work" },
      { APSIS_DATA_DIR: "environment-data" },
    ),
    {
      dataDir: resolve("explicit-data"),
      workspaceDir: resolve("explicit-work"),
    },
  );
  assert.equal(Workspace.allowed(".apsis-v4"), false);
});

test("createApp with only dataDir keeps workspace and status in that directory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "apsis-directory-"));
  const app = await createApp({
    dataDir: dir,
    globalSkillsDirectory: join(dir, "global-skills"),
  });
  t.after(async () => {
    await app.product.close();
    app.server.closeAllConnections();
    await new Promise<void>((done) => app.server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(app.workspace.root, join(app.store.directory, "workspace"));
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const { port } = app.server.address() as { port: number };
  const response = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.dataDir, app.store.directory);
  assert.equal(status.workspace, app.workspace.root);
});

test(
  "real CLI starts beside schema 3 data without migration, overrides or rewriting old files",
  { timeout: 15000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "apsis-cli-"));
    const oldDirectory = join(dir, ".apsis");
    await mkdir(oldDirectory);
    const original = JSON.stringify({
      schemaVersion: 3,
      agents: [],
      memories: [],
      skills: [],
    });
    const oldSettings = "old settings must never be read or changed";
    await writeFile(join(oldDirectory, "state.json"), original);
    await writeFile(join(oldDirectory, "settings.toml"), oldSettings);
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const { port } = reservation.address() as { port: number };
    await new Promise<void>((done) => reservation.close(() => done()));
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
    };
    delete environment.APSIS_DATA_DIR;
    const child = spawn(process.execPath, [index], {
      cwd: dir,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const exited = once(child, "exit");
    let output = "";
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await exited;
      await rm(dir, { recursive: true, force: true });
    });
    const deadline = Date.now() + 10000;
    while (!output.includes("http://localhost:")) {
      if (
        child.exitCode !== null ||
        child.signalCode !== null ||
        Date.now() > deadline
      )
        assert.fail("CLI did not start: " + output);
      await new Promise((done) => setTimeout(done, 25));
    }
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base + "/api/status");
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(
      await realpath(status.dataDir),
      await realpath(join(dir, ".apsis-v4")),
    );
    assert.equal(
      await realpath(status.workspace),
      await realpath(join(dir, ".apsis-v4", "workspace")),
    );
    const bootstrap = await fetch(base + "/api/v2/bootstrap", {
      method: "POST",
      headers: { "X-Apsis-Client": "1" },
    });
    assert.equal(bootstrap.status, 200);
    const state = await (await fetch(base + "/api/v2/state")).json();
    assert.equal(state.bots.length, 1);
    assert.deepEqual(state.connections, []);
    assert.equal(
      JSON.parse(await readFile(join(dir, ".apsis-v4", "state.json"), "utf8"))
        .schemaVersion,
      4,
    );
    assert.equal(
      await readFile(join(oldDirectory, "state.json"), "utf8"),
      original,
    );
    assert.equal(
      await readFile(join(oldDirectory, "settings.toml"), "utf8"),
      oldSettings,
    );
    if (process.platform === "win32") child.send({ type: "apsis:shutdown" });
    else child.kill("SIGTERM");
    await exited;
    assert.equal(child.exitCode, 0, output);
    assert.equal(child.signalCode, null);
  },
);
