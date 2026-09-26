export type SettingsLocale = "zh-Hant" | "en";
export type PermissionEffect = "allow" | "ask" | "deny";
export type ApprovalMode = "manual" | "yolo" | "auto";

export interface PermissionRule {
  id: string;
  scope: "global" | "bot";
  /** Required for bot scope; forbidden for global scope. */
  botId?: string;
  tool: string;
  /** Workspace-relative directory or file; includes descendants on segment boundaries. */
  path?: string;
  targetBotId?: string;
  effect: PermissionEffect;
  /** Shell-only glob matched against the entire command. */
  commandPattern?: string;
}

export interface SettingsValues {
  approvalMode: ApprovalMode;
  dangerousCommandGuard: boolean;
  maxTurns: number;
  taskTimeoutMs: number;
  shellTimeoutSeconds: number;
  outputLimit: number;
  maxDelegationDepth: number;
  maxDelegatedJobs: number;
  maxConcurrent: number;
  locale: SettingsLocale;
  permissionRules: readonly PermissionRule[];
}

export interface Settings extends SettingsValues {
  revision: number;
}

export type SettingsPatch = Partial<SettingsValues>;
export type SettingsUpdate = SettingsPatch & { revision: number };
export type RuntimeSettings = Pick<
  SettingsValues,
  | "maxTurns"
  | "taskTimeoutMs"
  | "shellTimeoutSeconds"
  | "outputLimit"
  | "maxDelegationDepth"
  | "maxDelegatedJobs"
  | "maxConcurrent"
>;

export const SETTINGS_BOUNDS = Object.freeze({
  maxTurns: [1, 200],
  taskTimeoutMs: [1000, 86400000],
  shellTimeoutSeconds: [1, 120],
  outputLimit: [1000, 1000000],
  maxDelegationDepth: [0, 10],
  maxDelegatedJobs: [0, 100],
  maxConcurrent: [1, 16],
} as const);

export const DEFAULT_SETTINGS: Readonly<SettingsValues> = Object.freeze({
  approvalMode: "yolo",
  dangerousCommandGuard: true,
  maxTurns: 100,
  taskTimeoutMs: 1800000,
  shellTimeoutSeconds: 60,
  outputLimit: 24000,
  maxDelegationDepth: 3,
  maxDelegatedJobs: 12,
  maxConcurrent: 4,
  locale: "zh-Hant",
  permissionRules: Object.freeze([]),
});
