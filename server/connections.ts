import { DEFAULT_CONTEXT_WINDOW_TOKENS } from "./context-budget.ts";
import { createHash } from "node:crypto";
import type {
  ConnectionSelection,
  Environment,
  ModelConnection,
  Provider,
} from "../shared/types.ts";
import { compatibleUrl } from "./compatible.ts";
import { ollamaUrl, ollamaModelName } from "./ollama.ts";
import {
  ConfigStore,
  connectionId,
  setConnections,
  type SavedConnection,
} from "./config-store.ts";
import { ConfigConflictError } from "./config-file.ts";
import type { ProductDB } from "./product-db.ts";
type Verification = NonNullable<ModelConnection["verification"]>;
type VerificationRecord = {
  id: string;
  fingerprint: string;
  verification: Verification;
};
function error(text: string): never {
  throw Object.assign(new Error(text), { status: 400 });
}
const vendors = new Set([
  "ollama",
  "openai",
  "anthropic",
  "kimi",
  "deepseek",
  "openrouter",
  "qwen",
  "custom",
]);
const keys = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "openai-compatible": "COMPATIBLE_API_KEY",
  ollama: "",
};
export class Connections {
  readonly config: ConfigStore;
  readonly directory: string;
  private db?: ProductDB;
  private verifications = new Map<string, VerificationRecord>();
  tail: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    this.directory = directory;
    this.config = new ConfigStore(directory);
  }
  async init() {
    this.config.init();
    return this;
  }
  attachDB(db: ProductDB) {
    this.db = db;
  }
  get rows(): SavedConnection[] {
    return this.config.read().value.connections.map((row) => {
      const record =
        this.db?.get<VerificationRecord>("connection-verification", row.id) ||
        this.verifications.get(row.id);
      return {
        ...row,
        ...(record?.fingerprint === this.rowFingerprint(row)
          ? { verification: record.verification }
          : {}),
      };
    });
  }
  get savedDefault() {
    return this.config.read().value.defaultSelection;
  }
  private rowFingerprint(row: SavedConnection) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          provider: row.provider,
          url: row.url,
          model: row.model,
          models: row.models || [row.model],
          modelSettings: row.modelSettings || {},
          apiKey: row.apiKeyEnv ? process.env[row.apiKeyEnv] : row.apiKey,
        }),
      )
      .digest("hex");
  }
  private credential(row: SavedConnection) {
    if (!row.apiKeyEnv) return row.apiKey;
    const value = process.env[row.apiKeyEnv];
    if (!value) error(`模型連線缺少環境變數：${row.apiKeyEnv}`);
    return value;
  }
  view() {
    const configRevision = this.config.read().revision;
    return this.rows
      .filter((row) => !row.archived)
      .map(({ apiKey, apiKeyEnv, ...row }) => ({
        ...row,
        configRevision,
        models: row.models?.length ? [...row.models] : [row.model],
        contextProfiles: Object.fromEntries(
          (row.models?.length ? row.models : [row.model]).map((model) => {
            const manual = row.modelSettings?.[model]?.contextWindowTokens;
            const tokens = manual ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
            return [
              model,
              {
                tokens,
                source:
                  manual !== undefined
                    ? ("manual" as const)
                    : ("default" as const),
              },
            ];
          }),
        ),
        credentialConfigured:
          !!(apiKeyEnv ? process.env[apiKeyEnv] : apiKey) ||
          row.provider === "ollama",
      }));
  }
  selection(connectionId: unknown, model?: unknown): ConnectionSelection {
    if (typeof connectionId !== "string") error("請選擇模型連線。");
    const connection = this.view().find((row) => row.id === connectionId);
    if (!connection) error("找不到可用的模型連線。");
    const selectedModel = model === undefined ? connection.model : model;
    if (
      typeof selectedModel !== "string" ||
      !(connection.models || [connection.model]).includes(selectedModel)
    )
      error("此模型不在所選連線的模型清單中。");
    return { connectionId, model: selectedModel };
  }
  defaultSelection(): ConnectionSelection | null {
    const visible = this.view();
    const saved = this.savedDefault;
    if (saved) {
      const connection = visible.find((row) => row.id === saved.connectionId);
      if (connection)
        return {
          connectionId: connection.id,
          model: (connection.models || [connection.model]).includes(saved.model)
            ? saved.model
            : connection.model,
        };
    }
    const ready = (row: ModelConnection) =>
      row.provider === "ollama" ||
      (row.provider === "openai-compatible"
        ? Boolean(row.url)
        : row.credentialConfigured);
    const preferred = visible.find((row) => ready(row));
    return preferred
      ? { connectionId: preferred.id, model: preferred.model }
      : null;
  }
  async setDefault(input: Record<string, unknown>) {
    const selection = this.selection(input.connectionId, input.model);
    const revision = this.config.read().revision;
    const operation = this.tail.then(() => {
      // Recheck after any queued connection edits before persisting the pointer.
      const current = this.selection(selection.connectionId, selection.model);
      this.config.update(
        (doc) => setConnections(doc, this.rows, current),
        revision,
      );
      return current;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  environment(id: string, model?: string): Environment {
    const publicRow = this.view().find((r) => r.id === id);
    if (!publicRow) error("找不到可用的模型連線。");
    const row = this.rows.find((r) => r.id === id)!;
    return {
      MODEL_PROVIDER: row.provider,
      MODEL_ID: model || row.model,
      [keys[row.provider] || "UNUSED"]: this.credential(row),
      ...(row.provider === "ollama"
        ? { OLLAMA_URL: row.url }
        : row.provider === "openai-compatible"
          ? { COMPATIBLE_BASE_URL: row.url }
          : row.provider === "anthropic"
            ? { ANTHROPIC_BASE_URL: row.url }
            : { OPENAI_BASE_URL: row.url }),
    };
  }
  discoveryKey(input: Record<string, unknown>) {
    if (input.apiKey) return input.apiKey;
    if (!input.connectionId) return input.apiKey;
    const row = this.rows.find(
      (r) => r.id === input.connectionId && !r.archived,
    );
    if (!row) error("找不到可用的模型連線。");
    // Never send a stored credential to a different endpoint or protocol.
    if (
      row.provider !== "openai-compatible" ||
      compatibleUrl(input.url) !== row.url
    )
      error("網址已變更，請重新輸入 API key，或先儲存新網址後再取得模型。");
    return this.credential(row);
  }
  async mutate(fn: (rows: SavedConnection[]) => void) {
    const revision = this.config.read().revision;
    const operation = this.tail.then(() => {
      const next = structuredClone(this.rows);
      fn(next);
      let selection = this.savedDefault;
      if (selection) {
        const row = next.find((r) => r.id === selection!.connectionId);
        if (row && !(row.models || [row.model]).includes(selection.model))
          selection = { connectionId: row.id, model: row.model };
      }
      this.config.update(
        (doc) => setConnections(doc, next, selection),
        revision,
      );
    });
    this.tail = operation.catch(() => {});
    await operation;
  }
  async save(input: Record<string, unknown>, id?: string) {
    if (
      input.configRevision !== undefined &&
      input.configRevision !== this.config.read().revision
    )
      throw new ConfigConflictError(this.config.storage.file);
    const previous = id
      ? this.rows.find((r) => r.id === id && !r.archived)
      : undefined;
    if (id && !previous) error("找不到可用的模型連線。");
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
    const suppliedModels = input.models;
    if (
      suppliedModels !== undefined &&
      (!Array.isArray(suppliedModels) ||
        !suppliedModels.length ||
        suppliedModels.length > 1000)
    )
      error("模型清單需包含 1–1000 個模型。");
    const models =
      suppliedModels === undefined
        ? [
            ...(previous?.provider === provider
              ? previous.models || [model]
              : [model]),
          ]
        : (suppliedModels as unknown[]).map((value) => {
            if (
              typeof value !== "string" ||
              !value.trim() ||
              value.length > 200 ||
              /[\u0000-\u001f]/u.test(value)
            )
              error("模型清單格式錯誤。");
            const modelName = value.trim();
            if (provider === "ollama") ollamaModelName(modelName);
            return modelName;
          });
    if (suppliedModels === undefined && !models.includes(model))
      models.push(model);
    if (provider === "ollama") for (const name of models) ollamaModelName(name);
    if (new Set(models).size !== models.length) error("模型清單不能重複。");
    if (!models.includes(model)) error("預設模型必須在模型清單中。");
    const vendor = input.vendor === undefined ? previous?.vendor : input.vendor;
    if (
      vendor !== undefined &&
      (typeof vendor !== "string" || !vendors.has(vendor))
    )
      error("未知平台。");
    const url =
      provider === "ollama"
        ? ollamaUrl(input.url)
        : provider === "openai-compatible"
          ? compatibleUrl(input.url)
          : input.url === undefined && previous?.provider === provider
            ? previous?.url
            : input.url === undefined || input.url === ""
              ? undefined
              : compatibleUrl(input.url);
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
    const modelSettings =
      input.modelSettings === undefined
        ? previous?.provider === provider && previous.modelSettings
          ? Object.fromEntries(
              Object.entries(previous.modelSettings).filter(([id]) =>
                models.includes(id),
              ),
            )
          : undefined
        : input.modelSettings;
    if (modelSettings !== undefined) {
      if (
        !modelSettings ||
        typeof modelSettings !== "object" ||
        Array.isArray(modelSettings)
      )
        error("模型參數格式錯誤。");
      for (const [modelId, value] of Object.entries(modelSettings)) {
        if (
          !models.includes(modelId) ||
          !value ||
          typeof value !== "object" ||
          Array.isArray(value)
        )
          error("模型參數必須屬於此連線的模型。");
        const entry = value as Record<string, unknown>;
        if (
          Object.keys(entry).some(
            (key) =>
              ![
                "displayName",
                "maxOutputTokens",
                "contextWindowTokens",
              ].includes(key),
          )
        )
          error("不支援的模型參數。");
        if (
          entry.displayName !== undefined &&
          (typeof entry.displayName !== "string" ||
            !entry.displayName.trim() ||
            entry.displayName.length > 100)
        )
          error("模型顯示名稱需為 1–100 字。");
        if (
          entry.contextWindowTokens !== undefined &&
          (!Number.isSafeInteger(entry.contextWindowTokens) ||
            Number(entry.contextWindowTokens) < 2048 ||
            Number(entry.contextWindowTokens) > 10000000)
        )
          error("Context 上限需為 2048–10000000 的整數。");
        if (
          entry.maxOutputTokens !== undefined &&
          (!Number.isSafeInteger(entry.maxOutputTokens) ||
            Number(entry.maxOutputTokens) < 1 ||
            Number(entry.maxOutputTokens) > 1000000)
        )
          error("模型輸出上限需為 1–1000000 的整數。");
      }
    }
    const row: SavedConnection = {
      id:
        previous?.id ||
        connectionId(
          text("name", 100),
          vendor || provider,
          this.rows.map((r) => r.id),
        ),
      name: text("name", 100),
      provider,
      model,
      models,
      vendor,
      url,
      apiKey,
      apiKeyEnv:
        provider !== "ollama" &&
        !input.apiKey &&
        input.apiKey !== null &&
        previous?.url === url &&
        previous?.provider === provider
          ? previous.apiKeyEnv
          : undefined,
      modelSettings: modelSettings as ModelConnection["modelSettings"],
    };
    await this.mutate((rows) => {
      const index = rows.findIndex((r) => r.id === row.id);
      if (index < 0) rows.push(row);
      else rows[index] = row;
    });
    return this.view().find((r) => r.id === row.id)!;
  }
  async archive(id: string) {
    if (!this.rows.some((r) => r.id === id)) error("找不到模型連線。");
    await this.mutate((rows) => {
      if (this.savedDefault?.connectionId === id)
        throw Object.assign(new Error("此連線是預設模型，請先切換預設模型。"), {
          status: 409,
        });
      rows.find((r) => r.id === id)!.archived = true;
    });
  }
  fingerprint(id: string) {
    return JSON.stringify({
      environment: this.environment(id),
      modelSettings: this.rows.find((row) => row.id === id)?.modelSettings,
    });
  }
  async verified(
    id: string,
    verification: NonNullable<ModelConnection["verification"]>,
    fingerprint?: string,
  ) {
    const row = this.rows.find((r) => r.id === id);
    if (
      row &&
      !row.archived &&
      (!fingerprint || this.fingerprint(id) === fingerprint)
    ) {
      const record = {
        id,
        verification,
        fingerprint: this.rowFingerprint(row),
      };
      if (this.db) this.db.put("connection-verification", record);
      else this.verifications.set(id, record);
    }
    return verification;
  }
}
