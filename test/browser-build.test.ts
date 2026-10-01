import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { build } from "esbuild";
import { browserBuildOptions } from "../scripts/browser-build.ts";
import { createApp } from "../server/app.ts";

test("a development rebuild cannot replace the production browser served by fixtures", async () => {
  await build(browserBuildOptions(true));
  const production = await readFile("dist/production-public/bot.js");
  await build(browserBuildOptions());
  const development = await readFile("dist/public/bot.js");
  assert.ok(development.length > production.length * 2);
  assert.deepEqual(await readFile("dist/production-public/bot.js"), production);
  for (const mode of [undefined, "development"] as const) {
    const directory = await mkdtemp(join(tmpdir(), "apsis-build-mode-"));
    const app = await createApp({
      dataDir: join(directory, "data"),
      workspaceDir: join(directory, "work"),
      browserBuild: mode,
    });
    try {
      app.server.listen(0, "127.0.0.1");
      await once(app.server, "listening");
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const response = await fetch(`${base}/bot.js`);
      assert.equal(response.status, 200);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        mode === "development" ? development : production,
      );
      const map = await fetch(`${base}/bot.js.map`);
      assert.equal(map.status, 200);
      const body = (await map.json()) as { sourcesContent: string[] };
      assert.ok(
        body.sourcesContent.some((source) => source.includes("createRoot")),
      );
    } finally {
      await app.close();
    }
  }
});
