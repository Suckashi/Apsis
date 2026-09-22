import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
const model = process.env.OLLAMA_MODEL || "qwen3.5:9b";
const ollama = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const dir = await mkdtemp(join(tmpdir(), "talaria-ollama-live-"));
await mkdir(join(dir, "workspace"));
const token = "TALARIA-" + Math.random().toString(36).slice(2, 10);
await writeFile(join(dir, "workspace", "probe.txt"), token);
const { server } = await createApp({
  dataDir: join(dir, "data"),
  workspaceDir: join(dir, "workspace"),
  env: {},
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
const post = (path: string, body: unknown) =>
  fetch(base + "/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
try {
  const saved = await post("settings/pi", {
    provider: "ollama",
    model,
    url: ollama,
  });
  assert.equal(saved.status, 200);
  const session = await (await post("sessions", { mode: "pi" })).json();
  const started = Date.now();
  const response = await post("sessions/" + session.id + "/chat", {
    prompt:
      "Use read_file to read probe.txt in the workspace. Reply only with its exact contents. Do not guess.",
    allowWrites: false,
  });
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const history = await (
    await fetch(base + "/api/sessions/" + session.id)
  ).json();
  console.log(
    JSON.stringify({
      step: "tool-call",
      seconds: (Date.now() - started) / 1000,
      tools: events.filter((e) => e.type === "activity"),
      deltas: events.filter((e) => e.type === "delta").length,
      answer: history.messages.at(-1)?.content,
    }),
  );
  assert.ok(
    events.some((e) => e.type === "activity" && e.tool === "read_file"),
  );
  assert.equal(events.at(-1).type, "done");
  assert.ok(history.messages.at(-1).content.includes(token));
  const follow = await post("sessions/" + session.id + "/chat", {
    prompt:
      "What was the exact token you just read? Reply only with that token, without using tools again.",
    allowWrites: false,
  });
  const followEvents = (await follow.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(followEvents.at(-1).type, "done");
  const followText = followEvents
    .filter((e) => e.type === "delta")
    .map((e) => e.text)
    .join("");
  assert.ok(followText.includes(token));
  console.log(
    JSON.stringify({
      step: "conversation-history",
      answer: followText,
      totalSeconds: (Date.now() - started) / 1000,
      passed: true,
    }),
  );
} finally {
  server.close();
  server.closeAllConnections();
}
