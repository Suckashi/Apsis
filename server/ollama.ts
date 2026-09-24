export const defaultOllamaUrl = "http://127.0.0.1:11434";
export function ollamaUrl(value: unknown): string {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["/", "/v1", "/v1/"].includes(url.pathname)
    )
      throw new Error();
    return url.origin;
  } catch {
    throw Object.assign(
      new Error("Ollama 請使用本機 HTTP 網址，例如 http://127.0.0.1:11434。"),
      { status: 400 },
    );
  }
}
export function ollamaModelName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value) ||
    value.endsWith(":cloud") ||
    value.endsWith("-cloud")
  )
    throw Object.assign(
      new Error(
        "請輸入已安裝的本機模型名稱，例如 qwen3.5:9b；此連線不使用 cloud 模型。",
      ),
      { status: 400 },
    );
  return value;
}
export async function discoverOllama(value: unknown) {
  const url = ollamaUrl(value);
  let response: Response;
  try {
    response = await fetch(url + "/api/tags", {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
  } catch {
    throw Object.assign(
      new Error("無法連接 Ollama，請先啟動 Ollama 並確認網址。"),
      { status: 502 },
    );
  }
  if (!response.ok)
    throw Object.assign(new Error("Ollama 未能回傳模型清單。"), {
      status: 502,
    });
  const data = (await response.json().catch(() => null)) as {
    models?: { name?: unknown; remote_host?: unknown }[];
  } | null;
  if (!Array.isArray(data?.models))
    throw Object.assign(new Error("Ollama 模型清單格式不正確。"), {
      status: 502,
    });
  return data.models.flatMap((item) => {
    if (!item || item.remote_host) return [];
    try {
      const id = ollamaModelName(item.name);
      return [{ id, name: id }];
    } catch {
      return [];
    }
  });
}
