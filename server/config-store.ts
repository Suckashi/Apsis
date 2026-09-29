import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { initSync, parse, stringify, edit } from "@rainbowatcher/toml-edit-js";
import { z } from "zod";
import type { ConnectionSelection, ModelConnection } from "../shared/types.ts";
import type { SettingsValues } from "../shared/settings.ts";
import { validateSettings } from "./settings-validation.ts";
import { connectionsSchema } from "./storage-schema.ts";
import { ConfigFile, configError } from "./config-file.ts";
import { compatibleUrl } from "./compatible.ts";
import { ollamaModelName, ollamaUrl } from "./ollama.ts";

initSync();

export type SavedConnection = Omit<ModelConnection, "credentialConfigured"> & {
  apiKey?: string;
  apiKeyEnv?: string;
};

const identifier = z
  .string()
  .min(1)
  .refine((s) => s.trim() === s && !/[\x00-\x1f\x7f]/.test(s));
const providerSchema = z.strictObject({
  name: z.string().min(1).max(100),
  type: z.enum(["openai", "anthropic", "ollama", "openai-compatible", "codex"]),
  vendor: z
    .enum([
      "ollama",
      "openai",
      "anthropic",
      "kimi",
      "deepseek",
      "openrouter",
      "qwen",
      "custom",
    ])
    .optional(),
  baseUrl: z.string().optional(),
  defaultModel: identifier,
  apiKey: z.string().optional(),
  apiKeyEnv: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .optional(),
  archived: z.boolean().optional(),
});
const modelSchema = z.strictObject({
  provider: identifier,
  model: identifier,
  displayName: z.string().trim().min(1).max(100).optional(),
  maxOutputTokens: z.number().int().min(1).max(1000000).optional(),
  contextWindowTokens: z.number().int().min(2048).max(10000000).optional(),
});
const documentSchema = z.strictObject({
  version: z.literal(1),
  ui: z
    .strictObject({ locale: z.enum(["zh-Hant", "en"]).optional() })
    .default({}),
  runtime: z.record(z.string(), z.unknown()).default({}),
  permissions: z
    .strictObject({
      approvalMode: z.enum(["manual", "yolo", "auto"]).optional(),
      dangerousCommandGuard: z.boolean().optional(),
      rules: z.array(z.unknown()).optional(),
    })
    .default({}),
  defaults: z.strictObject({ model: z.string().optional() }).default({}),
  providers: z.record(identifier, providerSchema).default({}),
  models: z.record(identifier, modelSchema).default({}),
});
export type SettingsDocument = z.infer<typeof documentSchema>;
export interface ConfigValues {
  document: SettingsDocument;
  settings: SettingsValues;
  connections: SavedConnection[];
  defaultSelection: ConnectionSelection | null;
}

const runtimeKeys = new Set([
  "maxTurns",
  "taskTimeoutMs",
  "shellTimeoutSeconds",
  "outputLimit",
  "maxDelegationDepth",
  "maxDelegatedJobs",
  "maxConcurrent",
]);

function decode(text: string): ConfigValues {
  let raw: unknown;
  try {
    raw = parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    // Parser excerpts may contain credentials. Only expose the location.
    const location = String(error).match(/line \d+(?:, column \d+)?/i)?.[0];
    configError(`settings.toml 格式錯誤${location ? ` (${location})` : ""}。`);
  }
  const result = documentSchema.safeParse(raw);
  if (!result.success)
    configError(
      `settings.toml 欄位錯誤：${result.error.issues[0].path.join(".") || "root"}。`,
    );
  const doc = result.data;
  for (const key of Object.keys(doc.runtime))
    if (!runtimeKeys.has(key))
      configError(`settings.toml 未知欄位：runtime.${key}`);
  const settings = validateSettings({
    ...doc.ui,
    ...doc.runtime,
    ...(doc.permissions.approvalMode === undefined
      ? {}
      : { approvalMode: doc.permissions.approvalMode }),
    ...(doc.permissions.dangerousCommandGuard === undefined
      ? {}
      : { dangerousCommandGuard: doc.permissions.dangerousCommandGuard }),
    ...(doc.permissions.rules === undefined
      ? {}
      : { permissionRules: doc.permissions.rules }),
  });
  const connections: SavedConnection[] = [];
  for (const [alias, provider] of Object.entries(doc.providers)) {
    const id = alias;
    if (provider.apiKey !== undefined && provider.apiKeyEnv !== undefined)
      configError(
        `settings.toml providers.${id}：apiKey 與 apiKeyEnv 不可同時設定。`,
      );
    const entries = Object.entries(doc.models).filter(
      ([, model]) => model.provider === alias,
    );
    const selected = doc.models[provider.defaultModel];
    if (!selected || selected.provider !== alias)
      configError(
        `settings.toml providers.${id}.defaultModel 找不到對應模型。`,
      );
    if (new Set(entries.map(([, m]) => m.model)).size !== entries.length)
      configError(`settings.toml providers.${id} 有重複模型。`);
    let url = provider.baseUrl;
    if (provider.type === "ollama") {
      url = ollamaUrl(url);
      for (const [, m] of entries) ollamaModelName(m.model);
    } else if (provider.type === "openai-compatible") url = compatibleUrl(url);
    else if (url !== undefined && provider.type !== "codex")
      configError(
        `settings.toml providers.${id}.baseUrl：自訂網址請使用 openai-compatible。`,
      );
    connections.push({
      id,
      name: provider.name,
      provider: provider.type,
      url,
      vendor: provider.vendor,
      apiKey: provider.apiKey,
      apiKeyEnv: provider.apiKeyEnv,
      archived: provider.archived,
      model: selected.model,
      models: entries.map(([, m]) => m.model),
      modelSettings: Object.fromEntries(
        entries.flatMap(([, m]) => {
          const { provider: _p, model, ...options } = m;
          return Object.keys(options).length ? [[model, options]] : [];
        }),
      ),
    });
  }
  for (const [alias, model] of Object.entries(doc.models))
    if (!Object.hasOwn(doc.providers, model.provider))
      configError(`settings.toml models.${alias}.provider 找不到連線。`);
  const defaultModel = doc.defaults.model
    ? doc.models[doc.defaults.model]
    : undefined;
  if (
    doc.defaults.model &&
    (!defaultModel || doc.providers[defaultModel.provider].archived)
  )
    configError("settings.toml defaults.model 找不到可用的模型連線。");
  return {
    document: doc,
    settings,
    connections,
    defaultSelection: defaultModel
      ? {
          connectionId: defaultModel.provider,
          model: defaultModel.model,
        }
      : null,
  };
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export function modelAlias(id: string, model: string) {
  // Keep ordinary model IDs readable; escape only characters ambiguous to edit paths.
  return `${id}/${model.replace(/[%"\\]/g, encodeURIComponent)}`;
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function readableName(name: string, fallback: string) {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug && !uuid.test(slug) ? slug : fallback;
}
function uniqueAlias(base: string, used: Set<string>) {
  let name = base;
  for (
    let suffix = 2;
    used.has(name) ||
    ["default", "__proto__", "constructor", "prototype"].includes(name);
    suffix++
  )
    name = `${base}-${suffix}`;
  used.add(name);
  return name;
}

/** The readable provider key is the connection identity. */
export function connectionId(
  name: string,
  fallback: string,
  used: Iterable<string>,
) {
  return uniqueAlias(readableName(name, fallback), new Set(used));
}

export function setSettings(doc: SettingsDocument, values: SettingsValues) {
  const {
    locale,
    approvalMode,
    dangerousCommandGuard,
    permissionRules,
    ...runtime
  } = values;
  doc.ui = { locale };
  doc.runtime = runtime;
  doc.permissions = {
    approvalMode,
    dangerousCommandGuard,
    rules: [...permissionRules],
  };
}

export function setConnections(
  doc: SettingsDocument,
  rows: SavedConnection[],
  selection: ConnectionSelection | null,
) {
  const aliases = new Map(
    Object.entries(doc.models).map(([alias, m]) => [
      JSON.stringify([m.provider, m.model]),
      alias,
    ]),
  );
  const usedModels = new Set(Object.keys(doc.models));
  const aliasFor = (id: string, model: string) => {
    const key = JSON.stringify([id, model]);
    if (!aliases.has(key))
      aliases.set(key, uniqueAlias(modelAlias(id, model), usedModels));
    return aliases.get(key)!;
  };
  const providers: SettingsDocument["providers"] = {};
  const models: SettingsDocument["models"] = {};
  for (const row of rows) {
    const provider = row.id;
    if (Object.hasOwn(providers, provider)) configError("模型連線名稱重複。");
    providers[provider] = providerSchema.parse(
      clean({
        name: row.name,
        type: row.provider,
        vendor: row.vendor,
        baseUrl: row.url,
        defaultModel: aliasFor(row.id, row.model),
        apiKey: row.apiKey,
        apiKeyEnv: row.apiKeyEnv,
        archived: row.archived,
      }),
    );
    for (const model of row.models?.length ? row.models : [row.model]) {
      const alias = aliasFor(row.id, model);
      if (Object.hasOwn(models, alias))
        configError("模型別名衝突，請先重新命名。 ");
      models[alias] = clean({
        provider,
        model,
        ...row.modelSettings?.[model],
      });
    }
  }
  doc.providers = providers;
  doc.models = models;
  doc.defaults.model = selection
    ? aliasFor(selection.connectionId, selection.model)
    : "";
}

/** Read only the records being migrated, including committed WAL data. */
export function legacyRecords<T>(directory: string, kind: string): T[] {
  const file = join(directory, "product.sqlite");
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='records'",
        )
        .get()
    )
      return [];
    return db
      .prepare("SELECT value FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((row) => JSON.parse(String(row.value)) as T);
  } finally {
    db.close();
  }
}

function initialText(directory: string) {
  const legacy = legacyRecords<
    SettingsValues & { id: string; revision: unknown }
  >(directory, "settings").find((s) => s.id === "global");
  const { id: _id, revision: _revision, ...values } = legacy || {};
  const doc: SettingsDocument = {
    version: 1,
    ui: {},
    runtime: {},
    permissions: {},
    defaults: {},
    providers: {},
    models: {},
  };
  setSettings(doc, validateSettings(values));
  const file = join(directory, "connections.json");
  let rows: SavedConnection[] = [];
  if (existsSync(file)) {
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      configError("connections.json 格式錯誤，已停止遷移。");
    }
    if (!connectionsSchema.safeParse(input).success)
      configError("connections.json 資料格式錯誤，已停止遷移。");
    rows = input as SavedConnection[];
  }
  let selection: ConnectionSelection | null = null;
  const defaultFile = join(directory, "connection-default.json");
  if (existsSync(defaultFile)) {
    try {
      selection = z
        .object({ connectionId: z.string(), model: z.string() })
        .parse(JSON.parse(readFileSync(defaultFile, "utf8")));
    } catch {
      configError("connection-default.json 格式錯誤，已停止遷移。");
    }
    const row = rows.find(
      (r) => r.id === selection!.connectionId && !r.archived,
    );
    selection = row
      ? {
          connectionId: row.id,
          model: (row.models || [row.model]).includes(selection.model)
            ? selection.model
            : row.model,
        }
      : null;
  }
  if (!selection) {
    // Keep legacy Codex defaults visible for the existing Bot compatibility migration.
    const row = rows.find(
      (r) =>
        !r.archived &&
        (r.provider === "codex" ||
          r.provider === "ollama" ||
          (r.provider === "openai-compatible" ? !!r.url : !!r.apiKey)),
    );
    if (row) selection = { connectionId: row.id, model: row.model };
  }
  setConnections(doc, rows, selection);
  return (
    "# Apsis 設定：可加註解；儲存後重新整理設定頁或重新啟動。\n# MCP 伺服器請放在同目錄的 mcp.json。\n" +
    stringify(doc)
  );
}

/** Apply only changed leaves, retaining unrelated TOML comments and formatting. */
function updateToml(
  text: string,
  before: unknown,
  after: unknown,
  path: string[] = [],
): string {
  if (isDeepStrictEqual(before, after)) return text;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
      text = updateToml(text, a[key], b[key], [...path, key]);
    return text;
  }
  return edit(
    text.replace(/^\uFEFF/, ""),
    path.map((key) => JSON.stringify(key)).join("."),
    after ?? null,
    { inline: false },
  );
}

export class ConfigStore {
  readonly storage: ConfigFile<ConfigValues>;
  constructor(directory: string) {
    this.storage = new ConfigFile(join(directory, "settings.toml"), decode);
  }
  init(directory: string) {
    this.storage.init(() => initialText(directory));
    return this;
  }
  read() {
    return this.storage.read();
  }
  update(
    fn: (doc: SettingsDocument) => void,
    expectedRevision = this.read().revision,
  ) {
    const previous = this.read();
    const next = structuredClone(previous.value.document);
    fn(next);
    const text = updateToml(
      previous.text,
      previous.value.document,
      clean(next),
    );
    return this.storage.write(text, expectedRevision);
  }
}
