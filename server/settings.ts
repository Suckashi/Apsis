import type {
  Environment,
  SettingsView,
  CredentialState,
  Provider,
} from "../shared/types.ts";
import { asError } from "../shared/errors.ts";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createModels } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { configuration } from "./agent.ts";
import { hermesEndpoint } from "./hermes.ts";

const keyFields = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  hermes: "HERMES_API_KEY",
};
const allowedFields = [
  "PI_PROVIDER",
  "PI_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "HERMES_URL",
  "HERMES_API_KEY",
  "HERMES_MODEL",
];
const defaults = { openai: "gpt-4.1-mini", anthropic: "claude-sonnet-4-6" };
const models = createModels();
models.setProvider(openaiProvider());
models.setProvider(anthropicProvider());
const catalog = Object.fromEntries(
  Object.keys(defaults).map((provider) => [
    provider,
    models.getModels(provider).map(({ id, name }) => ({ id, name })),
  ]),
);
function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}
function text(value: unknown, label: string, max = 256) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid(label + "格式不正確。");
  return value.trim();
}
function validateInput(section: string, value: unknown): Environment {
  const input = value as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid("設定必須為 JSON 物件。");
  const allowed =
    section === "pi"
      ? ["provider", "model", "apiKey"]
      : ["url", "model", "apiKey"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    invalid("設定包含不支援的欄位。");
  const patch: Environment = {};
  if (section === "pi") {
    if (input.provider !== "openai" && input.provider !== "anthropic")
      invalid("請選擇 OpenAI 或 Anthropic。");
    const model = text(input.model, "模型");
    if (!catalog[input.provider].some((item) => item.id === model))
      invalid("此模型不在目前 Pi SDK 的支援清單，請從建議模型中選擇。");
    patch.PI_PROVIDER = input.provider;
    patch.PI_MODEL = model;
  } else {
    const url = text(input.url, "Hermes 網址", 2048);
    try {
      hermesEndpoint(url);
    } catch {
      invalid("請輸入不含帳密或查詢參數的 HTTP(S) gateway 網址。");
    }
    patch.HERMES_URL = url.replace(/\/$/, "");
    patch.HERMES_MODEL = text(input.model, "Hermes 模型");
  }
  if (Object.hasOwn(input, "apiKey")) {
    const field =
      keyFields[section === "pi" ? (input.provider as Provider) : "hermes"];
    if (input.apiKey === null)
      patch[field] = ""; // Explicitly disable, including an environment fallback.
    else if (input.apiKey !== "") {
      if (
        typeof input.apiKey !== "string" ||
        !/^[\x21-\x7e]{1,4096}$/.test(input.apiKey)
      )
        invalid("API key 不可包含空白或控制字元。");
      patch[field] = input.apiKey;
    }
  }
  return patch;
}

export class Settings {
  directory: string;
  base: Environment;
  saved: Environment;
  file!: string;
  tail: Promise<unknown>;
  constructor(directory: string, env: Environment = process.env) {
    this.directory = directory;
    this.base = Object.fromEntries(
      allowedFields
        .filter((key) => typeof env[key] === "string")
        .map((key) => [key, env[key]]),
    );
    this.saved = {};
    this.tail = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    this.file = join(this.directory, "settings.json");
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.entries(data).some(
          ([key, value]) =>
            !allowedFields.includes(key) || typeof value !== "string",
        )
      )
        throw new Error("Local settings file is invalid.");
      this.saved = data;
    } catch (caught) {
      const error = asError(caught);
      if (error.code !== "ENOENT") throw error;
    }
    return this;
  }
  environment() {
    return { ...this.base, ...this.saved };
  }
  view(): SettingsView {
    const env = this.environment();
    const config = configuration(env);
    const credential = (provider: Provider | "hermes"): CredentialState => {
      const field = keyFields[provider];
      return {
        configured: Boolean(env[field]),
        source: !env[field]
          ? "none"
          : Object.hasOwn(this.saved, field)
            ? "local"
            : "environment",
      };
    };
    return {
      pi: {
        provider: config.provider,
        model: config.model,
        credentials: {
          openai: credential("openai"),
          anthropic: credential("anthropic"),
        },
      },
      hermes: {
        url: env.HERMES_URL || "http://127.0.0.1:8642",
        model: env.HERMES_MODEL || "hermes-agent",
        credential: credential("hermes"),
      },
      models: catalog,
      defaults,
    };
  }
  async update(section: string, input: unknown) {
    if (!["pi", "hermes"].includes(section)) invalid("不支援的設定區段。");
    const patch = validateInput(section, input);
    const operation = this.tail.then(async () => {
      const next = { ...this.saved, ...patch };
      const temp = join(this.directory, "settings-" + randomUUID() + ".tmp");
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temp, this.file);
      } catch (caught) {
        const error = asError(caught);
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      this.saved = next;
      return this.view();
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
