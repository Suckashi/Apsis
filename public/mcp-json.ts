export interface McpConnectorInput {
  name: string;
  url: string;
  token?: string;
}

type JsonObject = Record<string, unknown>;

const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function connector(value: unknown, fallbackName?: string): McpConnectorInput {
  if (!object(value)) throw new Error("每個 MCP 服務都必須是 JSON 物件。");
  const name =
    typeof value.name === "string" && value.name.trim()
      ? value.name.trim()
      : fallbackName?.trim();
  if (!name || name.length > 100)
    throw new Error("每個 MCP 服務都需要名稱（最多 100 字）。");
  if (value.command !== undefined || value.args !== undefined)
    throw new Error(
      `${name} 使用 command/stdio，目前只支援 HTTP MCP endpoint。`,
    );
  const transport = value.type ?? value.transport;
  if (
    transport !== undefined &&
    !["http", "streamable-http", "streamableHttp"].includes(String(transport))
  )
    throw new Error(`${name} 的傳輸方式不支援；目前只支援 Streamable HTTP。`);
  if (typeof value.url !== "string" || value.url.length > 2000)
    throw new Error(`${name} 缺少有效的 HTTP MCP endpoint。`);
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error(`${name} 的 endpoint 網址格式錯誤。`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(`${name} 需要不含帳密的 HTTP MCP endpoint。`);

  let token = value.token;
  if (value.headers !== undefined) {
    if (!object(value.headers))
      throw new Error(`${name} 的 headers 格式錯誤。`);
    const headers = Object.entries(value.headers);
    const unsupported = headers.find(
      ([key]) => key.toLowerCase() !== "authorization",
    );
    if (unsupported)
      throw new Error(`${name} 的 ${unsupported[0]} header 尚不支援。`);
    const authorization = headers.find(
      ([key]) => key.toLowerCase() === "authorization",
    )?.[1];
    if (authorization !== undefined) {
      if (typeof authorization !== "string")
        throw new Error(`${name} 的 Authorization header 格式錯誤。`);
      const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
      if (!match)
        throw new Error(`${name} 的 Authorization 需使用 Bearer token。`);
      if (token !== undefined && token !== match[1])
        throw new Error(`${name} 的 token 與 Authorization header 不一致。`);
      token = match[1];
    }
  }
  if (
    token !== undefined &&
    (typeof token !== "string" ||
      !token.trim() ||
      token.length > 4096 ||
      /\s|\$\{|\{\{/u.test(token))
  )
    throw new Error(`${name} 的 token 格式錯誤，請填入實際的 Bearer token。`);
  return { name, url: url.href, ...(token ? { token } : {}) };
}

export function parseMcpConnectorJson(text: string): McpConnectorInput[] {
  if (!text.trim()) throw new Error("請貼上 MCP 連接器 JSON。");
  if (text.length > 100_000) throw new Error("JSON 內容過長。");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON 語法錯誤，請檢查逗號與引號。");
  }
  let entries: [string | undefined, unknown][];
  if (Array.isArray(parsed)) {
    entries = parsed.map((value) => [undefined, value]);
  } else if (object(parsed)) {
    const collection = parsed.mcpServers ?? parsed.servers;
    if (collection !== undefined) {
      if (!object(collection))
        throw new Error("mcpServers／servers 必須是以服務名稱為鍵的物件。");
      entries = Object.entries(collection);
    } else if ("url" in parsed || "command" in parsed) {
      entries = [[undefined, parsed]];
    } else {
      entries = Object.entries(parsed);
    }
  } else {
    throw new Error("JSON 必須是 MCP 服務物件或清單。");
  }
  if (!entries.length) throw new Error("JSON 中找不到 MCP 服務。");
  if (entries.length > 20) throw new Error("一次最多加入 20 個 MCP 服務。");
  return entries.map(([name, value]) => connector(value, name));
}
