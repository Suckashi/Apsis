export interface HermesOptions {
  url?: string;
  key?: string;
  model?: string;
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  fetchImpl?: (
    url: URL,
    options: RequestInit & { headers: Record<string, string>; body: string },
  ) => Promise<Response>;
}
export function hermesEndpoint(base: string) {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "HERMES_URL 必須為 HTTP(S) 網址，且不可包含帳密或查詢參數。",
    );
  url.pathname =
    url.pathname.replace(/\/$/, "").replace(/\/v1$/, "") +
    "/v1/chat/completions";
  return url;
}

export async function askHermes({
  url,
  key,
  model = "hermes-agent",
  messages,
  signal,
  fetchImpl = fetch,
}: HermesOptions): Promise<string> {
  if (!key || !url)
    throw new Error("請先前往「連線設定」儲存 Hermes gateway 網址與 API key。");
  const response = await fetchImpl(hermesEndpoint(url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
      : AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(
      `Hermes 回傳 HTTP ${response.status}，請檢查 gateway 與 API key。`,
    );
  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("Hermes 未回傳文字結果。");
  return text;
}
