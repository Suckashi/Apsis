import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { discoverCompatibleModels } from "../server/compatible.ts";

test("discovers models from an OpenAI-compatible /models endpoint", async (t) => {
  const server = createServer((req, res) => {
    assert.equal(req.url, "/provider/v1/models");
    assert.equal(req.headers.authorization, "Bearer test-key");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
          { id: "gpt-5.5" },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const address = server.address();
  assert(address && typeof address === "object");
  const models = await discoverCompatibleModels(
    `http://127.0.0.1:${address.port}/provider/v1/`,
    "test-key",
  );
  assert.deepEqual(models, [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "gpt-5.5", name: "gpt-5.5" },
  ]);
});

test("rejects an empty OpenAI-compatible model list", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  await assert.rejects(
    discoverCompatibleModels(`http://127.0.0.1:${address.port}/v1`),
    /模型清單是空的/,
  );
  server.closeAllConnections();
  server.close();
});
