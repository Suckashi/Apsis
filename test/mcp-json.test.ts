import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpConnectorJson } from "../public/mcp-json.ts";

test("reads common MCP JSON collections and Bearer headers", () => {
  assert.deepEqual(
    parseMcpConnectorJson(
      JSON.stringify({
        mcpServers: {
          notes: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer secret" },
          },
        },
      }),
    ),
    [{ name: "notes", url: "https://example.com/mcp", token: "secret" }],
  );
  assert.deepEqual(
    parseMcpConnectorJson(
      JSON.stringify({
        servers: { local: { type: "http", url: "http://localhost:3101/mcp" } },
      }),
    ),
    [{ name: "local", url: "http://localhost:3101/mcp" }],
  );
});

test("reads a single MCP server and rejects incompatible settings", () => {
  assert.deepEqual(
    parseMcpConnectorJson('{"name":"Notes","url":"https://example.com/mcp"}'),
    [{ name: "Notes", url: "https://example.com/mcp" }],
  );
  assert.throws(
    () =>
      parseMcpConnectorJson(
        '{"mcpServers":{"local":{"command":"npx","args":[]}}}',
      ),
    /command\/stdio/,
  );
  assert.throws(
    () =>
      parseMcpConnectorJson(
        '{"name":"Notes","url":"https://example.com/mcp","headers":{"X-API-Key":"secret"}}',
      ),
    /header 尚不支援/,
  );
  assert.throws(
    () =>
      parseMcpConnectorJson(
        '{"name":"Notes","url":"https://example.com/mcp","token":"${TOKEN}"}',
      ),
    /實際的 Bearer token/,
  );
  assert.throws(() => parseMcpConnectorJson("{invalid"), /JSON 語法錯誤/);
});
