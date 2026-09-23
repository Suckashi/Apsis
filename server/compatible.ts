import { createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

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

export function compatibleProvider(id: string, url: string, apiKey?: string) {
  const model: Model<"openai-completions"> = {
    id,
    name: id,
    provider: "openai-compatible",
    api: "openai-completions",
    baseUrl: compatibleUrl(url),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    },
  };
  return createProvider({
    id: "openai-compatible",
    name: "OpenAI Compatible",
    models: [model],
    auth: {
      apiKey: {
        name: "Compatible API",
        resolve: async () => ({
          auth: { apiKey: apiKey || "not-required" },
          source: "local",
        }),
      },
    },
    api: openAICompletionsApi(),
  });
}
