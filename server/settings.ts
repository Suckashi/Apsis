import { ConfigStore, setSettings } from "./config-store.ts";
import {
  validateSettings,
  SettingsValidationError,
} from "./settings-validation.ts";
import type { Settings, SettingsValues } from "../shared/settings.ts";
export {
  validateSettings,
  validateRules,
  validatePermissionRules,
  SettingsValidationError,
} from "./settings-validation.ts";

export class SettingsRevisionError extends Error {
  readonly status = 409;
  readonly expectedRevision: string;
  readonly actualRevision: string;
  constructor(expectedRevision: string, actualRevision: string) {
    super("設定已變更，請重新載入後再儲存。");
    this.name = "SettingsRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class SettingsService {
  private readonly config: ConfigStore;
  constructor(config: ConfigStore) {
    this.config = config;
  }
  read(): Settings {
    const { revision, value } = this.config.read();
    return { ...value.settings, revision };
  }
  update(input: unknown): Settings;
  update(patch: unknown, expectedRevision: string): Settings;
  update(input: unknown, revisionArgument?: string): Settings {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new SettingsValidationError("Settings update must be an object");
    const { revision, ...fields } = input as Record<string, unknown>;
    const expected = arguments.length === 2 ? revisionArgument : revision;
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      throw new SettingsValidationError(
        "revision must be the version returned by GET settings",
      );
    const current = this.read();
    if (expected !== current.revision)
      throw new SettingsRevisionError(expected, current.revision);
    const { revision: _revision, ...values } = current;
    const next: SettingsValues = validateSettings(
      arguments.length === 2 ? input : fields,
      values,
    );
    const saved = this.config.update((doc) => setSettings(doc, next), expected);
    return { ...saved.value.settings, revision: saved.revision };
  }
}
