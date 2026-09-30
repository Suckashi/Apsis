import { join } from "node:path";
import { z } from "zod";
import type { Connector } from "../shared/product.ts";
import { ConfigFile, configError } from "./config-file.ts";

const timeout = z.number().int().min(1).max(2147483647).optional();
const schema = z.strictObject({
  mcpServers: z.record(
    z.string().min(1),
    z.strictObject({
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      bearerTokenEnvVar: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
        .optional(),
      enabled: z.boolean().optional(),
      startupTimeoutMs: timeout,
      toolTimeoutMs: timeout,
    }),
  ),
  "x-apsis": z
    .strictObject({
      version: z.literal(1),
      serverNames: z.record(z.string(), z.string().min(1).max(100)).optional(),
    })
    .optional(),
});
type McpDocument = z.infer<typeof schema>;

function decode(text: string): McpDocument {
  let input: unknown;
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    configError("mcp.json JSON 格式錯誤。");
  }
  const result = schema.safeParse(input);
  if (!result.success)
    configError(
      `mcp.json 欄位錯誤或尚未支援：${result.error.issues[0].path.join(".") || "root"}。目前只支援 HTTP MCP。`,
    );
  for (const [id, server] of Object.entries(result.data.mcpServers)) {
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      configError(`mcp.json ${id}.url 格式錯誤。`);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      configError(`mcp.json ${id}.url 必須是無內嵌帳密的 HTTP(S) 網址。`);
    const names = new Set<string>();
    for (const [key, value] of Object.entries(server.headers || {})) {
      const name = key.toLowerCase();
      if (
        names.has(name) ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
        /[\r\n\0]/.test(value)
      )
        configError(`mcp.json ${id}.headers 格式錯誤。`);
      names.add(name);
    }
    if (server.bearerTokenEnvVar && names.has("authorization"))
      configError(
        `mcp.json ${id} 不可同時設定 Authorization 與 bearerTokenEnvVar。`,
      );
  }
  return result.data;
}

function put(doc: McpDocument, connector: Connector) {
  doc.mcpServers[connector.id] = {
    url: connector.url,
    enabled: connector.enabled,
    headers: connector.token
      ? { ...connector.headers, Authorization: `Bearer ${connector.token}` }
      : connector.headers,
    bearerTokenEnvVar: connector.bearerTokenEnvVar,
    startupTimeoutMs: connector.startupTimeoutMs,
    toolTimeoutMs: connector.toolTimeoutMs,
  };
  doc["x-apsis"] ??= { version: 1 };
  doc["x-apsis"].serverNames ??= {};
  doc["x-apsis"].serverNames[connector.id] = connector.name;
}

export class McpConfig {
  readonly storage: ConfigFile<McpDocument>;
  constructor(directory: string) {
    this.storage = new ConfigFile(join(directory, "mcp.json"), decode);
  }
  init() {
    this.storage.init(() => {
      const doc: McpDocument = {
        mcpServers: {},
        "x-apsis": { version: 1, serverNames: {} },
      };
      return JSON.stringify(doc, null, 2) + "\n";
    });
    return this;
  }
  all(): Connector[] {
    const doc = this.storage.read().value;
    return Object.entries(doc.mcpServers).map(([id, server]) => ({
      ...server,
      id,
      name: doc["x-apsis"]?.serverNames?.[id] || id,
      enabled: server.enabled ?? true,
    }));
  }
  get(id: string) {
    return this.all().find((c) => c.id === id);
  }
  view() {
    return this.all().map(
      ({ id, name, url, enabled, headers, bearerTokenEnvVar }) => ({
        id,
        name,
        url,
        enabled,
        credentialConfigured: !!(bearerTokenEnvVar
          ? process.env[bearerTokenEnvVar]
          : Object.keys(headers || {}).length),
      }),
    );
  }
  put(connector: Connector, expectedRevision = this.storage.read().revision) {
    const snapshot = this.storage.read();
    put(snapshot.value, connector);
    this.storage.write(
      JSON.stringify(snapshot.value, null, 2) + "\n",
      expectedRevision,
    );
    return connector;
  }
  remove(id: string) {
    const snapshot = this.storage.read();
    delete snapshot.value.mcpServers[id];
    if (snapshot.value["x-apsis"]?.serverNames)
      delete snapshot.value["x-apsis"].serverNames[id];
    this.storage.write(
      JSON.stringify(snapshot.value, null, 2) + "\n",
      snapshot.revision,
    );
  }
}
