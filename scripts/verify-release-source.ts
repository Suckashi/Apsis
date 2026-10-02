import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

// Exercise the exact committed source distribution, not this checkout's dist,
// installed dependencies, .env or real data. npm supplies its CLI path portably.
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this verifier with npm run test:release");
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "apsis-source-release-"));
const archive = join(temporary, "source.tar");
let server: ReturnType<typeof spawn> | undefined;
let exited: Promise<unknown> | undefined;
let serverOutput = "";

async function command(executable: string, args: string[], cwd: string) {
  const child = spawn(executable, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const deadline = setTimeout(() => child.kill(), 180000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${executable} ${args.join(" ")} failed:\n${output}`);
    return output;
  } finally {
    clearTimeout(deadline);
  }
}

try {
  await command(
    "git",
    ["archive", "--format=tar", `--output=${archive}`, "HEAD"],
    root,
  );
  await command("tar", ["-xf", archive, "-C", temporary], root);
  const entries = await readdir(temporary);
  for (const entry of entries) {
    assert.ok(
      !/^\.apsis(?:$|-)|^node_modules$|^dist$|^artifacts$|^\.env$/.test(entry),
      `Private/generated content in source distribution: ${entry}`,
    );
  }
  const expected = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const distributed = JSON.parse(
    await readFile(join(temporary, "package.json"), "utf8"),
  );
  assert.equal(
    distributed.version,
    expected.version,
    "Commit release changes before checking the source archive",
  );
  assert.equal(distributed.license, "Apache-2.0");
  await command(process.execPath, [npmCli, "ci"], temporary);
  await command(process.execPath, [npmCli, "run", "check:docs"], temporary);
  await command(process.execPath, [npmCli, "run", "build"], temporary);

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((done) => reservation.close(() => done()));
  const environment: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  delete environment.APSIS_DATA_DIR;
  delete environment.APSIS_BROWSER_BUILD;
  // Same server command used after the build in npm start; IPC permits graceful
  // Windows shutdown without leaving npm's shell or a server grandchild behind.
  server = spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "server/index.ts"],
    {
      cwd: temporary,
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  exited = once(server, "exit");
  server.stdout!.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr!.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  const startupDeadline = Date.now() + 15000;
  while (!serverOutput.includes(`http://localhost:${port}`)) {
    assert.ok(
      server.exitCode === null &&
        server.signalCode === null &&
        Date.now() < startupDeadline,
      serverOutput,
    );
    await new Promise((done) => setTimeout(done, 25));
  }
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("Apsis"));
  const boot = await fetch(`${base}/api/v2/bootstrap`, {
    method: "POST",
    headers: { "X-Apsis-Client": "1" },
  });
  assert.equal(boot.status, 200);
  const state = await (await fetch(`${base}/api/v2/state`)).json();
  assert.equal(state.bots.length, 1);
  assert.deepEqual(state.connections, []);
  if (process.platform === "win32") server.send({ type: "apsis:shutdown" });
  else server.kill("SIGTERM");
  await exited;
  assert.equal(server.exitCode, 0, serverOutput);
  const saved = JSON.parse(
    await readFile(join(temporary, ".apsis-v4", "state.json"), "utf8"),
  );
  assert.equal(saved.schemaVersion, 4);
  console.log(
    `Source release OK: ${distributed.version}; clean archive, npm ci, docs, build, local UI/API, fresh store and graceful shutdown.`,
  );
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    if (server.connected) server.send({ type: "apsis:shutdown" });
    else server.kill();
    await exited;
  }
  // The target is only the fresh mkdtemp directory created above.
  await rm(temporary, { recursive: true, force: true });
}
