import type {
  ApprovalMode,
  PermissionEffect,
  PermissionRule,
} from "../shared/settings.ts";
import { analyzeDangerousCommand } from "./vendor/kimi-bash/dangerous.ts";
import { isSensitiveFile } from "./policy-paths.ts";

export interface PolicyOptions {
  caseInsensitive?: boolean;
  approvalMode?: ApprovalMode;
  dangerousCommandGuard?: boolean;
  remembered?: boolean;
  gitWorkspace?: boolean;
  gitControl?: boolean;
}

export interface PolicyRequest {
  tool: string;
  botId?: string;
  botIds?: string[];
  command?: string;
  path?: string;
  targetBotId?: string;
  /** Browser action. Missing/unknown actions are conservatively mutations. */
  action?: string;
  readonly?: boolean;
  /** Callers must mark additional tools that mutate state. */
  mutation?: boolean;
}

export interface PolicyDecision {
  effect: PermissionEffect;
  reason:
    | "readonly"
    | "rule"
    | "default"
    | "invalid-path"
    | "connector"
    | "dangerous-command"
    | "unanalyzable-command"
    | "auto-mode"
    | "session-approval"
    | "sensitive-file"
    | "git-control"
    | "yolo-mode"
    | "git-workspace";
  dangerousCommand?: string;
  matchedRuleIds: string[];
  /** True requires a fresh approval, even if the action has a remembered allow. */
  explicitAsk: boolean;
}

/** Whole-command glob: '*' and '?' span slash/newline; '\\' escapes the next character. */
export function commandMatches(pattern: string, command: string): boolean {
  const tokens: { kind: "literal" | "star" | "any"; text?: string }[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length)
      tokens.push({ kind: "literal", text: pattern[++i] });
    else
      tokens.push(
        c === "*"
          ? { kind: "star" }
          : c === "?"
            ? { kind: "any" }
            : { kind: "literal", text: c },
      );
  }
  let p = 0,
    c = 0,
    star = -1,
    retry = 0;
  while (c < command.length) {
    const token = tokens[p];
    if (
      token?.kind === "any" ||
      (token?.kind === "literal" && token.text === command[c])
    ) {
      p++;
      c++;
    } else if (token?.kind === "star") {
      star = p++;
      retry = c;
    } else if (star >= 0) {
      p = star + 1;
      c = ++retry;
    } else return false;
  }
  while (tokens[p]?.kind === "star") p++;
  return p === tokens.length;
}

/** Lexical policy paths only. Filesystem execution must separately enforce symlink containment. */
export function normalizePolicyPath(path: string): string {
  if (typeof path !== "string" || /[\x00-\x1f\x7f:]/.test(path))
    throw new Error("Invalid workspace-relative path");
  const value = path.replaceAll("\\", "/");
  if (value.startsWith("/")) throw new Error("Absolute paths are forbidden");
  const parts = value.split("/");
  for (const part of parts) {
    if (part === "..") throw new Error("Path traversal is forbidden");
    if (part !== "." && /[. ]$/.test(part))
      throw new Error("Ambiguous Windows path segment");
    if (
      /[<>"|?*]/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
      throw new Error("Invalid workspace-relative path segment");
  }
  return parts.filter((part) => part !== "" && part !== ".").join("/") || ".";
}

export function policyPathMatches(
  rulePath: string,
  requestPath: string,
  options: PolicyOptions = {},
): boolean {
  let rule = normalizePolicyPath(rulePath);
  let request = normalizePolicyPath(requestPath);
  if (options.caseInsensitive) {
    rule = rule.toLowerCase();
    request = request.toLowerCase();
  }
  return rule === "." || request === rule || request.startsWith(rule + "/");
}

const mutationTools = new Set([
  "write_file",
  "edit_file",
  "apply_patch",
  "delete_file",
  "remove_file",
  "move_file",
  "rename_file",
  "mkdir",
  "remember",
  "update_memory",
  "manage_memory",
  "save_skill",
  "create_draft",
  "draft_message",
  "publish_file",
  "create_document",
  "create_routine",
  "update_profile",
  "delegate_task",
]);
const defaultTools = new Set([
  "list_files",
  "read_file",
  "search_files",
  "search",
  "grep",
  "glob",
  "read_image",
  "read_document",
  "search_history",
  "read_history",
  "list_bots",
  "mcp_list",
  "delegate_task",
  "connection_probe",
  "list_memories",
  "search_memory",
  "read_memory",
  "list_skills",
  "read_skill",
  "get_current_time",
  "web_search",
  "fetch_url",
]);

export function evaluatePolicy(
  rules: readonly PermissionRule[],
  request: PolicyRequest,
  options: PolicyOptions = {},
): PolicyDecision {
  const guarded =
    request.tool === "shell" ||
    request.tool === "mcp_call" ||
    (request.tool === "browser" &&
      !["read", "navigate"].includes(request.action ?? ""));
  const mode = options.approvalMode ?? "yolo";
  if (
    request.readonly &&
    (guarded || request.mutation || mutationTools.has(request.tool))
  )
    return {
      effect: "deny",
      reason: "readonly",
      matchedRuleIds: [],
      explicitAsk: false,
    };
  let matches: PermissionRule[];
  try {
    if (request.path !== undefined) normalizePolicyPath(request.path);
    // Validate every path before matching: malformed policy must never grant access.
    for (const rule of rules)
      if (rule.path !== undefined) normalizePolicyPath(rule.path);
    matches = rules.filter(
      (rule) =>
        (rule.scope === "global" ||
          (rule.scope === "bot" &&
            rule.botId !== undefined &&
            (rule.botId === request.botId ||
              request.botIds?.includes(rule.botId)))) &&
        (rule.tool === "*" || rule.tool === request.tool) &&
        (rule.targetBotId === undefined ||
          rule.targetBotId === request.targetBotId) &&
        (rule.commandPattern === undefined ||
          (request.tool === "shell" &&
            typeof request.command === "string" &&
            commandMatches(rule.commandPattern, request.command))) &&
        (rule.path === undefined ||
          (request.path !== undefined &&
            policyPathMatches(rule.path, request.path, options))),
    );
  } catch {
    return {
      effect: "deny",
      reason: "invalid-path",
      matchedRuleIds: [],
      explicitAsk: false,
    };
  }
  const decision = (
    effect: PermissionEffect,
    reason: PolicyDecision["reason"],
    explicitAsk = false,
  ): PolicyDecision => ({
    effect,
    reason,
    explicitAsk,
    matchedRuleIds:
      reason === "rule"
        ? matches
            .filter((r) => r.effect === effect)
            .map((r) => r.id)
            .sort()
        : [],
  });
  if (matches.some((rule) => rule.effect === "deny"))
    return decision("deny", "rule");
  if (
    mode !== "auto" &&
    options.dangerousCommandGuard !== false &&
    request.tool === "shell"
  ) {
    const verdict =
      typeof request.command === "string"
        ? analyzeDangerousCommand(request.command)
        : { kind: "unanalyzable" as const };
    if (verdict?.kind === "dangerous")
      return {
        ...decision("ask", "dangerous-command", true),
        dangerousCommand: verdict.command,
      };
    if (verdict?.kind === "unanalyzable" && mode === "manual")
      return decision("ask", "unanalyzable-command", true);
  }
  if (mode === "auto") return decision("allow", "auto-mode");
  if (options.remembered) return decision("allow", "session-approval");
  for (const effect of ["ask", "allow"] as const) {
    if (matches.some((rule) => rule.effect === effect))
      return decision(effect, "rule", effect === "ask");
  }
  if (request.tool !== "shell" && request.path !== undefined) {
    if (isSensitiveFile(request.path)) return decision("ask", "sensitive-file");
    if (
      options.gitControl ||
      request.path
        .replaceAll("\\", "/")
        .split("/")
        .some((p) => p.toLowerCase() === ".git")
    )
      return decision("ask", "git-control");
  }
  if (mode === "yolo") return decision("allow", "yolo-mode");
  if (
    defaultTools.has(request.tool) ||
    (request.tool === "browser" && !guarded)
  )
    return decision("allow", "default");
  if (
    options.gitWorkspace &&
    request.path !== undefined &&
    ["write_file", "edit_file", "apply_patch"].includes(request.tool)
  )
    return decision("allow", "git-workspace");
  return decision("ask", "default");
}
