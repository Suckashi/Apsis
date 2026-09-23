import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Connector } from "../shared/product.ts";

export async function withConnector<T>(
  connector: Connector,
  fn: (client: Client) => Promise<T>,
) {
  const client = new Client({ name: "apsis", version: "0.2.0" });
  const transport = new StreamableHTTPClientTransport(new URL(connector.url), {
    requestInit: connector.token
      ? { headers: { Authorization: `Bearer ${connector.token}` } }
      : undefined,
  });
  try {
    await client.connect(transport, { timeout: 15000 });
    return await fn(client);
  } finally {
    await client.close();
  }
}
