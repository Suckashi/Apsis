import type { Environment, Status } from "../shared/types.ts";

export function configuration(env: Environment = process.env): Status {
  const provider = env.PI_PROVIDER || "openai";
  const model =
    env.PI_MODEL ||
    (provider === "ollama"
      ? "qwen3.5:9b"
      : provider === "anthropic"
        ? "claude-sonnet-4-6"
        : provider === "openai-compatible"
          ? ""
          : "gpt-4.1-mini");
  return {
    provider,
    model,
    piReady: Boolean(
      provider === "ollama"
        ? true
        : provider === "openai-compatible"
          ? env.COMPATIBLE_BASE_URL && env.PI_MODEL
          : provider === "anthropic"
            ? env.ANTHROPIC_API_KEY
            : provider === "openai" && env.OPENAI_API_KEY,
    ),
  };
}
