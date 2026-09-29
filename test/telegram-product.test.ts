import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.ts";

test("removed Telegram routes cannot activate a channel and leave legacy data intact", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-no-telegram-"));
  const file = join(directory, "telegram.json");
  // Deliberately invalid: startup must not even parse the retired config.
  await writeFile(file, "retired channel config");
  const app = await createApp({
    dataDir: directory,
    workspaceDir: join(directory, "work"),
    globalSkillsDirectory: join(directory, "global"),
  });
  t.after(async () => {
    await app.product.close();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  });
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  for (const [path, method] of [
    ["", "GET"],
    ["", "POST"],
    ["/pairing", "POST"],
    ["/unpair", "POST"],
    ["/test", "POST"],
  ]) {
    const response = await fetch(`${base}/api/channels/telegram${path}`, {
      method,
      headers: { "X-Apsis-Client": "1", "Content-Type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  assert.equal("telegram" in app, false);
  assert.equal("telegram" in app.product, false);
  assert.equal(await readFile(file, "utf8"), "retired channel config");
});
