import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../server/app.ts";
import { createTools } from "../server/tools.ts";

test(
  "a stopped complete backup restores conversations, config, journals and published files without replay",
  { timeout: 20000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "apsis-backup-"));
    const dataDir = join(dir, "data");
    const backup = join(dir, "backup");
    let invocations = 0;
    const app = await createApp({
      dataDir,
      globalSkillsDirectory: join(dir, "global-skills"),
      runner: async (options) => {
        invocations++;
        const tools = createTools(options);
        await tools
          .find((tool) => tool.name === "write_file")!
          .execute(
            randomUUID(),
            {
              path: "hello.md",
              content: "# Backup fixture\n\nSaved result: 42.\n",
            },
            options.signal,
          );
        await tools
          .find((tool) => tool.name === "publish_file")!
          .execute(
            randomUUID(),
            { path: "hello.md", name: "hello.md" },
            options.signal,
          );
        return { text: "Saved result: 42." };
      },
    });
    let restored: Awaited<ReturnType<typeof createApp>> | undefined;
    t.after(async () => {
      await restored?.close();
      await app.close();
      await rm(dir, { recursive: true, force: true });
    });
    const connection = await app.connections.save({
      name: "Backup fixture",
      provider: "openai-compatible",
      model: "fixture",
      url: "http://127.0.0.1:1/v1",
      apiKey: "synthetic-backup-test-key",
    });
    await app.connections.setDefault({
      connectionId: connection.id,
      model: "fixture",
    });
    const bot = await app.product.bots.create("Restore fixture");
    app.product.settings.update(
      { locale: "en" },
      app.product.settings.read().revision,
    );
    const routine = await app.product.routines.routine(bot.id, {
      name: "Paused fixture",
      prompt: "Do not run during restore",
      cron: "0 9 * * *",
      timezone: "Asia/Taipei",
      enabled: false,
    });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const job = await app.product.jobs.submit(bot.id, {
      requestId: randomUUID(),
      prompt: "Create a fixture result",
    });
    const deadline = Date.now() + 10000;
    while (app.product.db.jobs.get(job.id)?.status !== "completed") {
      assert.ok(Date.now() < deadline, "Fixture task should complete");
      await new Promise((done) => setTimeout(done, 10));
    }
    const completed = app.product.db.jobs.get(job.id)!;
    const artifact = app.product.db.artifacts.list({ botId: bot.id })[0];
    assert.ok(artifact?.snapshotPath);
    const transcript = app.store.conversations.page(bot.sessionId).messages;
    assert.ok(
      transcript.some((message) =>
        message.content.includes("Saved result: 42."),
      ),
    );
    const run = app.tasks.runs.records.get(completed.runId!)!;
    assert.equal(run.status, "completed");
    assert.equal(invocations, 1);

    // Keep recorded absolute working-folder paths valid by restoring at the same
    // location, retaining the original directory separately. Never copy live DBs.
    await app.close();
    const settings = await readFile(join(dataDir, "settings.toml"), "utf8");
    await cp(dataDir, backup, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rename(dataDir, join(dir, "original-retained"));
    await cp(backup, dataDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    restored = await createApp({
      dataDir,
      globalSkillsDirectory: join(dir, "global-skills"),
      runner: async () => {
        invocations++;
        throw new Error("Restore must not replay a completed task");
      },
    });
    assert.equal(restored.product.bots.bot(bot.id).name, bot.name);
    assert.equal(restored.product.settings.read().locale, "en");
    assert.equal(restored.product.db.routines.get(routine.id)?.enabled, false);
    assert.equal(restored.product.db.jobs.get(job.id)?.status, "completed");
    assert.deepEqual(
      restored.store.conversations.page(bot.sessionId).messages,
      transcript,
    );
    assert.deepEqual(
      restored.tasks.runs.records.get(completed.runId!),
      JSON.parse(JSON.stringify(run)),
    );
    assert.equal(
      await readFile(join(dataDir, "settings.toml"), "utf8"),
      settings,
    );
    assert.equal(
      await readFile(join(dataDir, "artifacts", artifact.snapshotPath), "utf8"),
      "# Backup fixture\n\nSaved result: 42.\n",
    );
    assert.equal(
      await readFile(join(artifact.location!.path, "hello.md"), "utf8"),
      "# Backup fixture\n\nSaved result: 42.\n",
    );

    restored.server.listen(0, "127.0.0.1");
    await once(restored.server, "listening");
    const base = `http://127.0.0.1:${(restored.server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/api/v2/bots/${bot.id}`);
    assert.equal(response.status, 200);
    const publicView = await response.text();
    assert.ok(publicView.includes("Restore fixture"));
    assert.ok(!publicView.includes("synthetic-backup-test-key"));
    assert.equal(invocations, 1);
  },
);
