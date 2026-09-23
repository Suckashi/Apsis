import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "../server/settings.ts";
import { Connections } from "../server/connections.ts";
import { createApp } from "../server/app.ts";

test("imported connections retain IDs, isolate keys, support edits and survive restart without reimporting archived services", async () => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-migration-"));
  const settings = await new Settings(directory, {
    PI_PROVIDER: "openai",
    OPENAI_API_KEY: "old-key",
    ANTHROPIC_API_KEY: "anthropic-key",
  }).init();
  const connections = await new Connections(directory, settings).init();
  assert.deepEqual(
    connections.view().map((row) => row.id),
    ["legacy-openai", "legacy-anthropic"],
  );
  assert.ok(!JSON.stringify(connections.view()).includes("old-key"));
  assert.equal(
    connections.environment("legacy-openai").ANTHROPIC_API_KEY,
    undefined,
  );
  await connections.setDefault({ connectionId: "legacy-openai" });
  await connections.save(
    {
      name: "My OpenAI",
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "new-key",
    },
    "legacy-openai",
  );
  await connections.archive("legacy-anthropic");
  const reopened = await new Connections(directory, settings).init();
  assert.equal(reopened.view().length, 1);
  assert.equal(reopened.environment("legacy-openai").OPENAI_API_KEY, "new-key");
  assert.equal(reopened.defaultSelection()?.connectionId, "legacy-openai");
  await reopened.save(
    {
      name: "My OpenAI",
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: null,
    },
    "legacy-openai",
  );
  const cleared = await new Connections(directory, settings).init();
  assert.equal(cleared.environment("legacy-openai").OPENAI_API_KEY, undefined);
});

test("pre-connection conversations and agents migrate and run with credentials from the unified manager", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-snapshot-migration-"));
  const dataDir = join(directory, "data");
  await mkdir(dataDir);
  const agent = {
    id: "old-agent",
    name: "Reader",
    instructions: "Read",
    engine: "pi",
    provider: "openai",
    model: "gpt-4.1-mini",
    memoryScope: "private",
    tools: [],
    skillIds: [],
  };
  await writeFile(
    join(dataDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      sessions: [
        {
          id: "old-chat",
          title: "Existing work",
          mode: "pi",
          source: "web",
          createdAt: new Date().toISOString(),
          messages: [],
          piMessages: [],
        },
        {
          id: "old-agent-chat",
          title: "Agent work",
          mode: "pi",
          source: "web",
          agent,
          createdAt: new Date().toISOString(),
          messages: [],
          piMessages: [],
        },
      ],
      agents: [agent],
      memories: [],
      skills: [],
    }),
  );
  const keys: (string | undefined)[] = [];
  const app = await createApp({
    dataDir,
    workspaceDir: join(directory, "work"),
    env: { OPENAI_API_KEY: "original-key" },
    runner: async ({ env, emit }) => {
      keys.push(env?.OPENAI_API_KEY);
      emit({ type: "delta", text: "continued" });
      return { text: "continued" };
    },
  });
  t.after(() => {
    app.tasks.stopAll();
  });
  const migrated = JSON.parse(
    await readFile(join(dataDir, "state.json"), "utf8"),
  );
  assert.equal(migrated.agents[0].connectionId, "legacy-openai");
  assert.equal(migrated.sessions[0].connectionId, "legacy-openai");
  assert.equal(migrated.sessions[1].agent.connectionId, "legacy-openai");
  await app.tasks.connections!.save(
    {
      name: "OpenAI",
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "rotated-key",
    },
    "legacy-openai",
  );
  await app.tasks.run("old-chat", "continue", false);
  await app.tasks.run("old-agent-chat", "continue", false);
  assert.deepEqual(keys, ["rotated-key", "rotated-key"]);
});
