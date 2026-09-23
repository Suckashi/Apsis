import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import type {
  RunEvent,
  AgentDefinition,
  SessionView,
} from "../shared/types.ts";

const model = process.env.OLLAMA_MODEL || "qwen3.5:9b";
const dir = await mkdtemp(join(tmpdir(), "apsis-engine-live-"));
const work = join(dir, "workspace");
await mkdir(work);
const token = "PROOF-" + Math.random().toString(36).slice(2, 10);
await writeFile(join(work, "probe.txt"), token);
const app = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: work,
  env: {
    PI_PROVIDER: "ollama",
    PI_MODEL: model,
    OLLAMA_URL: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  },
});
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
const post = async (path: string, input: unknown) => {
  const response = await fetch(base + "/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(300000),
  });
  assert.ok(
    response.ok,
    await (response.ok ? Promise.resolve("") : response.text()),
  );
  return response;
};
try {
  const failures: string[] = [];
  for (const engine of ["pi", "deepagents", "openai-agents"]) {
    try {
      const agent: AgentDefinition = await (
        await post("agents", {
          name: "Test " + engine,
          description: "Isolated smoke test",
          instructions:
            "Always use the real workspace read tool when asked to read files. Reply concisely.",
          engine,
          provider: "ollama",
          model,
          memoryScope: "private",
          tools: ["read_file"],
          skillIds: [],
        })
      ).json();
      const session: SessionView = await (
        await post("sessions", { mode: "pi", agentId: agent.id })
      ).json();
      const started = Date.now();
      const readTool =
        engine === "deepagents" ? "workspace_read_file" : "read_file";
      for (const [index, prompt] of [
        `Use ${readTool} to read probe.txt in the workspace. Reply only with its exact contents. Do not guess.`,
        "What was the exact token you just read? Reply only with that token, without using tools again.",
      ].entries()) {
        const events: RunEvent[] = (
          await (
            await post("sessions/" + session.id + "/chat", {
              prompt,
              allowWrites: false,
            })
          ).text()
        )
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        assert.equal(events.at(-1)?.type, "done", JSON.stringify(events));
        const text = events
          .filter((e) => e.type === "delta")
          .map((e) => ("text" in e ? e.text : ""))
          .join("");
        assert.ok(text.includes(token), text);
        if (!index)
          assert.ok(
            events.some((e) => e.type === "activity" && e.tool === "read_file"),
          );
        console.log(
          JSON.stringify({
            engine,
            step: index ? "persisted-history" : "real-tool-call",
            passed: true,
            seconds: Math.round((Date.now() - started) / 1000),
          }),
        );
      }
    } catch (error) {
      failures.push(engine);
      console.error(
        JSON.stringify({
          engine,
          passed: false,
          error: (error as Error).message,
        }),
      );
    }
  }
  assert.deepEqual(
    failures,
    [],
    "Some engines failed the real-model smoke test",
  );
} finally {
  app.server.closeAllConnections();
  app.server.close();
}
