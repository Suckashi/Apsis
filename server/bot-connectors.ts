import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Connector } from "../shared/product.ts";

export async function withConnector<T>(
  connector: Connector,
  fn: (client: Client) => Promise<T>,
) {
  const client = new Client({ name: "apsis", version: "0.2.0" });
  const headers = { ...connector.headers };
  const token = connector.bearerTokenEnvVar
    ? process.env[connector.bearerTokenEnvVar]
    : connector.token;
  if (connector.bearerTokenEnvVar && !token)
    throw Object.assign(
      new Error(`MCP 缺少環境變數：${connector.bearerTokenEnvVar}`),
      { status: 400 },
    );
  if (token) headers.Authorization = `Bearer ${token}`;
  const transport = new StreamableHTTPClientTransport(new URL(connector.url), {
    requestInit: { headers },
  });
  try {
    await client.connect(transport, {
      timeout: connector.startupTimeoutMs ?? 15000,
    });
    return await fn(client);
  } finally {
    await client.close();
  }
}
