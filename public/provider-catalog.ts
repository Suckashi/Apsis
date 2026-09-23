import type { ModelConnection, Provider } from "../shared/types.ts";

export type ProviderPreset = {
  id: string;
  name: string;
  description: string;
  provider: Provider;
  url?: string;
  examples: string[];
};

export const providerPresets: ProviderPreset[] = [
  {
    id: "ollama",
    name: "Ollama",
    description: "使用這台電腦上的本機模型，無需 API key。",
    provider: "ollama",
    url: "http://127.0.0.1:11434",
    examples: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "使用 OpenAI 官方 API。",
    provider: "openai",
    examples: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "使用 Anthropic 官方 API。",
    provider: "anthropic",
    examples: [],
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "透過 Moonshot AI 的 OpenAI 相容 API。",
    provider: "openai-compatible",
    url: "https://api.moonshot.ai/v1",
    examples: ["kimi-k3", "kimi-k2.6"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "透過 DeepSeek 的 OpenAI 相容 API。",
    provider: "openai-compatible",
    url: "https://api.deepseek.com",
    examples: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "一個金鑰連接 OpenRouter 上的多個模型。",
    provider: "openai-compatible",
    url: "https://openrouter.ai/api/v1",
    examples: [],
  },
  {
    id: "qwen",
    name: "Qwen · Model Studio",
    description: "阿里雲 Model Studio；請確認 API key 所屬區域。",
    provider: "openai-compatible",
    url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    examples: ["qwen3.8-max"],
  },
  {
    id: "custom",
    name: "自訂服務",
    description: "其他提供 OpenAI Chat Completions 的端點。",
    provider: "openai-compatible",
    examples: [],
  },
];

export const connectionModels = (connection: ModelConnection): string[] => [
  ...new Set([connection.model, ...(connection.models || [])].filter(Boolean)),
];

export const providerName = (connection: ModelConnection): string =>
  providerPresets.find((preset) => preset.id === connection.vendor)?.name ||
  providerPresets.find((preset) => preset.id === connection.provider)?.name ||
  connection.provider;
