import { DEFAULT_SETTINGS, SETTINGS_BOUNDS } from "../shared/settings.ts";
import type {
  PermissionRule,
  Settings,
  SettingsValues,
} from "../shared/settings.ts";
import type { ProductDB } from "./product-db.ts";
import { normalizePolicyPath } from "./policy.ts";

export class SettingsValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export class SettingsRevisionError extends Error {
  readonly status = 409;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Settings revision conflict: expected ${expectedRevision}, actual ${actualRevision}`,
    );
    this.name = "SettingsRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new SettingsValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new SettingsValidationError(`${label} must be a nonempty identifier`);
  return value;
}

export function validatePermissionRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value))
    throw new SettingsValidationError("permissionRules must be an array");
  const ids = new Set<string>();
  return Array.from(value, (entry) => {
    const rule = object(entry, "Permission rule");
    for (const key of Object.keys(rule))
      if (
        ![
          "id",
          "scope",
          "botId",
          "tool",
          "path",
          "targetBotId",
          "effect",
          "commandPattern",
        ].includes(key)
      )
        throw new SettingsValidationError(
          `Unknown permission rule field: ${key}`,
        );
    const id = identifier(rule.id, "Rule id");
    if (ids.has(id))
      throw new SettingsValidationError(`Duplicate rule id: ${id}`);
    ids.add(id);
    if (rule.scope !== "global" && rule.scope !== "bot")
      throw new SettingsValidationError("Rule scope must be global or bot");
    if (
      typeof rule.effect !== "string" ||
      !["allow", "ask", "deny"].includes(rule.effect)
    )
      throw new SettingsValidationError(
        "Rule effect must be allow, ask, or deny",
      );
    const tool = identifier(rule.tool, "Rule tool");
    if (tool !== "*" && /[*?\s]/.test(tool))
      throw new SettingsValidationError("Rule tool must be exact or '*'");
    const result: PermissionRule = {
      id,
      scope: rule.scope,
      tool,
      effect: rule.effect as PermissionRule["effect"],
    };
    if ("commandPattern" in rule) {
      if (
        tool !== "shell" ||
        typeof rule.commandPattern !== "string" ||
        !rule.commandPattern.length ||
        rule.commandPattern.length > 16000 ||
        rule.commandPattern.includes("\0")
      )
        throw new SettingsValidationError(
          "commandPattern requires shell and a nonempty glob (max 16000 characters)",
        );
      result.commandPattern = rule.commandPattern;
    }
    if (rule.scope === "bot")
      result.botId = identifier(rule.botId, "Rule botId");
    else if ("botId" in rule)
      throw new SettingsValidationError("Global rules cannot have botId");
    if ("targetBotId" in rule)
      result.targetBotId = identifier(rule.targetBotId, "Rule targetBotId");
    if ("path" in rule) {
      if (typeof rule.path !== "string")
        throw new SettingsValidationError("Rule path must be a string");
      try {
        result.path = normalizePolicyPath(rule.path);
      } catch (error) {
        throw new SettingsValidationError((error as Error).message);
      }
    }
    return result;
  });
}

export const validateRules = validatePermissionRules;

/** Validates a partial update and returns a fresh, complete value. Unknown fields are rejected. */
export function validateSettings(
  patch: unknown,
  current: SettingsValues = DEFAULT_SETTINGS,
): SettingsValues {
  const input = object(patch, "Settings patch");
  for (const key of Object.keys(input))
    if (!Object.hasOwn(DEFAULT_SETTINGS, key))
      throw new SettingsValidationError(`Unknown settings field: ${key}`);
  const merged = { ...current, ...input };
  if (!["manual", "yolo", "auto"].includes(merged.approvalMode))
    throw new SettingsValidationError(
      "approvalMode must be manual, yolo, or auto",
    );
  if (typeof merged.dangerousCommandGuard !== "boolean")
    throw new SettingsValidationError("dangerousCommandGuard must be boolean");
  for (const [key, [min, max]] of Object.entries(SETTINGS_BOUNDS)) {
    const value = merged[key as keyof typeof SETTINGS_BOUNDS];
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new SettingsValidationError(
        `${key} must be an integer between ${min} and ${max}`,
      );
  }
  if (merged.locale !== "zh-Hant" && merged.locale !== "en")
    throw new SettingsValidationError("locale must be zh-Hant or en");
  return {
    ...merged,
    permissionRules: validatePermissionRules(merged.permissionRules),
  } as SettingsValues;
}

/** One SQLite record, kind=settings/id=global. Updates are synchronous and transactional. */
export class SettingsService {
  private readonly db: ProductDB;
  constructor(db: ProductDB) {
    this.db = db;
  }

  read(): Settings {
    const record = this.db.get<Settings & { id: string }>("settings", "global");
    if (!record) return { ...validateSettings({}), revision: 0 };
    const { id: _id, revision, ...values } = record;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new SettingsValidationError("Invalid stored settings revision");
    return { ...validateSettings(values), revision };
  }

  /** Input is { revision, ...patch }; permissionRules replaces the entire array. */
  update(input: unknown): Settings;
  update(patch: unknown, expectedRevision: number): Settings;
  update(input: unknown, revisionArgument?: number): Settings {
    const envelope = object(input, "Settings update");
    const { revision, ...fields } = envelope;
    const expectedRevision =
      arguments.length === 2 ? revisionArgument : revision;
    const patch = arguments.length === 2 ? envelope : fields;
    if (
      typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    )
      throw new SettingsValidationError(
        "expectedRevision must be a nonnegative integer",
      );
    this.db.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.read();
      if (current.revision !== expectedRevision)
        throw new SettingsRevisionError(expectedRevision, current.revision);
      if (current.revision === Number.MAX_SAFE_INTEGER)
        throw new SettingsValidationError("Settings revision exhausted");
      const { revision: _revision, ...values } = current;
      const next = {
        ...validateSettings(patch, values),
        revision: current.revision + 1,
      };
      this.db.put("settings", { id: "global", ...next });
      this.db.db.exec("COMMIT");
      return next;
    } catch (error) {
      this.db.db.exec("ROLLBACK");
      throw error;
    }
  }
}
