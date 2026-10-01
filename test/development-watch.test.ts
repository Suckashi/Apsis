import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchDevelopmentSources } from "../scripts/development-watch.ts";

test(
  "development watch waits for a stable rewrite before restarting",
  { timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "apsis-development-rewrite-"));
    for (const folder of ["server", "shared"]) await mkdir(join(root, folder));
    const source = join(root, "server", "index.ts");
    await writeFile(source, "original");
    let changes = 0;
    const stop = await watchDevelopmentSources(
      root,
      () => {
        changes++;
      },
      400,
    );
    t.after(async () => {
      stop();
      await rm(root, { recursive: true, force: true });
    });
    await writeFile(source, "");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      changes,
      0,
      "A single incomplete-write observation does not restart the service",
    );
    await writeFile(source, "completed rewrite");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(
      changes,
      1,
      "Only the completed stable rewrite triggers a restart",
    );
  },
);

test(
  "development watch ignores generated files and unchanged bytes, detects source edits and additions",
  { timeout: 10000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "apsis-development-watch-"));
    for (const folder of ["server", "shared", "work"])
      await mkdir(join(root, folder));
    const source = join(root, "server", "index.ts");
    await writeFile(source, "original");
    let changes = 0;
    const stop = await watchDevelopmentSources(
      root,
      () => {
        changes++;
      },
      30,
    );
    t.after(async () => {
      stop();
      await rm(root, { recursive: true, force: true });
    });
    const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(join(root, "work", "index.html"), "generated");
    await writeFile(join(root, "work", "app.js"), "generated");
    await writeFile(source, "original");
    await utimes(source, new Date(), new Date());
    await pause();
    assert.equal(changes, 0);
    await writeFile(source, "edited");
    await pause();
    assert.equal(changes, 1);
    await writeFile(join(root, "shared", "new.ts"), "added");
    await pause();
    assert.equal(changes, 2);
    stop();
    await writeFile(source, "after cleanup");
    await pause();
    assert.equal(changes, 2);
  },
);
