import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Settings } from "./settings.ts";
import type {
  Environment,
  ModelConnection,
  Provider,
} from "../shared/types.ts";
import { compatibleUrl } from "./compatible.ts";
import { ollamaUrl, ollamaModelName } from "./ollama.ts";
import { connectionsSchema } from "./storage-schema.ts";
type SavedConnection = Omit<ModelConnection, "credentialConfigured"> & {
  apiKey?: string;
};
function error(text: string): never {
  throw Object.assign(new Error(text), { status: 400 });
}
const keys = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "COMPATIBLE_API_KEY",
  ollama: "",
};
export class Connections {
  file: string;
  rows: SavedConnection[] = [];
  tail: Promise<unknown> = Promise.resolve();
  settings: Settings;
  constructor(directory: string, settings: Settings) {
    this.file = join(directory, "connections.json");
    this.settings = settings;
  }
  async init() {
    try {
      this.rows = JSON.parse(await readFile(this.file, "utf8"));
      if (!connectionsSchema.safeParse(this.rows).success)
        throw new Error("Invalid connections file");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return this;
  }
  view() {
    const settings = this.settings.view();
    const legacy: ModelConnection[] = (Object.keys(keys) as Provider[]).map(
      (provider) => ({
        id: "legacy-" + provider,
        name: "原有設定 · " + provider,
        provider,
        model:
          settings.pi.provider === provider
            ? settings.pi.model
            : settings.defaults[provider],
        credentialConfigured:
          provider === "ollama" || settings.pi.credentials[provider].configured,
        url:
          provider === "ollama"
            ? settings.pi.ollamaUrl
            : provider === "openai-compatible"
              ? settings.pi.compatibleUrl
              : undefined,
      }),
    );
    return [
      ...legacy,
      ...this.rows
        .filter((r) => !r.archived)
        .map(({ apiKey, ...row }) => ({
          ...row,
          credentialConfigured: !!apiKey || row.provider === "ollama",
        })),
    ];
  }
  environment(id: string, model?: string): Environment {
    const publicRow = this.view().find((r) => r.id === id);
    if (!publicRow) error("找不到可用的模型連線。");
    if (id.startsWith("legacy-"))
      return {
        ...this.settings.environment(),
        PI_PROVIDER: publicRow.provider,
        PI_MODEL: model || publicRow.model,
      };
    const row = this.rows.find((r) => r.id === id)!;
    return {
      PI_PROVIDER: row.provider,
      PI_MODEL: model || row.model,
      [keys[row.provider] || "UNUSED"]: row.apiKey,
      ...(row.provider === "ollama"
        ? { OLLAMA_URL: row.url }
        : row.provider === "openai-compatible"
          ? { COMPATIBLE_BASE_URL: row.url }
          : {}),
    };
  }
  async mutate(fn: (rows: SavedConnection[]) => void) {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.rows);
      fn(next);
      const temporary = this.file + "." + randomUUID() + ".tmp";
      await writeFile(temporary, JSON.stringify(next, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, this.file);
      this.rows = next;
    });
    this.tail = operation.catch(() => {});
    await operation;
  }
  async save(input: Record<string, unknown>, id?: string) {
    const previous = id
      ? this.rows.find((r) => r.id === id && !r.archived)
      : undefined;
    if (id && !previous) error("找不到連線，原有設定請至舊版模型設定修改。");
    const text = (key: string, max: number) => {
      const value = input[key];
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > max ||
        /[\u0000-\u001f]/u.test(value)
      )
        error(key + "格式錯誤。");
      return value.trim();
    };
    const provider = input.provider as Provider;
    if (!Object.hasOwn(keys, provider)) error("未知供應商。");
    const model = text("model", 200);
    if (provider === "ollama") ollamaModelName(model);
    const url =
      provider === "ollama"
        ? ollamaUrl(input.url)
        : provider === "openai-compatible"
          ? compatibleUrl(input.url)
          : undefined;
    if (
      input.apiKey !== undefined &&
      input.apiKey !== null &&
      (typeof input.apiKey !== "string" ||
        (input.apiKey && !/^[\x21-\x7e]{1,4096}$/.test(input.apiKey)))
    )
      error("API key 格式錯誤。");
    const apiKey =
      provider === "ollama"
        ? undefined
        : input.apiKey === null
          ? undefined
          : input.apiKey
            ? (input.apiKey as string)
            : previous?.url === url && previous?.provider === provider
              ? previous?.apiKey
              : undefined;
    const row: SavedConnection = {
      id: previous?.id || randomUUID(),
      name: text("name", 100),
      provider,
      model,
      url,
      apiKey,
    };
    await this.mutate((rows) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index < 0) rows.push(row);
      else rows[index] = row;
    });
    return this.view().find((r) => r.id === row.id)!;
  }
  async archive(id: string) {
    if (!this.rows.some((r) => r.id === id))
      error("原有連線請至舊版設定管理。");
    await this.mutate((rows) => {
      rows.find((r) => r.id === id)!.archived = true;
    });
  }
  fingerprint(id: string) {
    return JSON.stringify(this.environment(id));
  }
  async verified(
    id: string,
    verification: NonNullable<ModelConnection["verification"]>,
    fingerprint?: string,
  ) {
    if (!id.startsWith("legacy-"))
      await this.mutate((rows) => {
        const row = rows.find((r) => r.id === id);
        if (
          row &&
          !row.archived &&
          (!fingerprint || this.fingerprint(id) === fingerprint)
        )
          row.verification = verification;
      });
    return verification;
  }
}
