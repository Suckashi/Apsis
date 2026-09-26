export function compatibleUrl(value: unknown): string {
  try {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\u0000-\u0020\u007f]/u.test(value)
    )
      throw new Error();
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    url.pathname = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw Object.assign(
      new Error(
        "Base URL 請使用不含帳密、查詢參數的 HTTP(S) 網址，例如 https://api.example.com/v1。",
      ),
      { status: 400 },
    );
  }
}

export async function discoverCompatibleModels(
  value: unknown,
  apiKey?: unknown,
) {
  const baseUrl = compatibleUrl(value);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof apiKey === "string" && apiKey)
    headers.Authorization = `Bearer ${apiKey}`;
  let response: Response;
  try {
    response = await fetch(new URL("models", baseUrl + "/"), {
      headers,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    throw Object.assign(
      new Error("無法取得模型清單，請確認 API 網址、API key 與網路連線。"),
      { status: 502 },
    );
  }
  if (!response.ok)
    throw Object.assign(new Error("服務未能回傳模型清單。"), { status: 502 });
  const data = (await response.json().catch(() => null)) as {
    data?: { id?: unknown; name?: unknown; supported_endpoints?: unknown }[];
  } | null;
  if (!Array.isArray(data?.data))
    throw Object.assign(
      new Error("模型清單格式不正確，預期 OpenAI 相容的 data 陣列。"),
      { status: 502 },
    );
  const models = data.data.flatMap((item) => {
    if (
      Array.isArray(item?.supported_endpoints) &&
      !item.supported_endpoints.some(
        (endpoint) =>
          typeof endpoint === "string" &&
          endpoint.endsWith("/chat/completions"),
      )
    )
      return [];
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id || id.length > 200 || /[\u0000-\u001f]/u.test(id)) return [];
    const name =
      typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    return [{ id, name: name.slice(0, 200) }];
  });
  if (!models.length)
    throw Object.assign(new Error("服務回傳的模型清單是空的。"), {
      status: 502,
    });
  return [...new Map(models.map((model) => [model.id, model])).values()];
}
