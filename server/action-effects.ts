import { isSensitiveFile } from "./policy-paths.ts";

export interface ActionEffect {
  kind: "read" | "local" | "critical" | "unknown";
  impact: string;
}
/** Conservative application policy, NOT an OS sandbox. Unknown effects need fresh consent. */
export function classifyAction(
  tool: string,
  args: Record<string, unknown> = {},
  targetExists?: boolean,
): ActionEffect {
  const effect = (kind: ActionEffect["kind"], impact: string) => ({
    kind,
    impact,
  });
  const path = typeof args.path === "string" ? args.path : "";
  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  const sensitiveStartup =
    /(^|\/)(?:startup|\.vscode)(\/|$)/.test(normalizedPath) ||
    /(?:^|\/)(?:\.bashrc|\.bash_profile|\.profile|\.zshrc|\.zprofile|\.zshenv|\.npmrc|\.gitconfig|\.netrc|\.pypirc|authorized_keys|agents\.md|claude\.md|microsoft\.powershell_profile\.ps1)$/.test(
      normalizedPath,
    );
  if (sensitiveStartup)
    return effect(
      "critical",
      "Access to startup configuration, credentials or persistent execution/instructions",
    );
  if (
    path &&
    (isSensitiveFile(path) ||
      /(^|[/\\])(?:\.git|\.ssh|\.aws|\.agents|\.config)([/\\]|$)/i.test(path))
  )
    return effect(
      "critical",
      "Access to credentials, security configuration or persistent instructions",
    );
  if (tool === "shell") {
    const command = String(args.command || "").trim();
    // Small exact safe forms only. Scripts, interpreters, substitutions, redirects,
    // arbitrary executable names and compound commands are deliberately unknown.
    if (/^(?:pwd|ls(?: -la?)?)$/.test(command))
      return effect("read", "Inspect the current working folder");
    if (
      /\b(?:rm|rmdir|del|Remove-Item|chmod|chown|sudo|su|reg|systemctl|crontab|curl|wget|eval|exec|powershell|bash|sh|npm|npx|pip|python|node)\b|\bgit\s+(?:push|reset|clean)|[>]/i.test(
        command,
      )
    )
      return effect(
        "critical",
        "Host execution may delete or overwrite data, change access, execute untrusted code or submit externally",
      );
    return effect(
      "unknown",
      "Host command effects cannot be established; inspect exact command and working folder",
    );
  }
  if (tool === "fetch_url")
    return effect(
      "unknown",
      "An arbitrary URL can trigger external effects; inspect the exact URL before requesting it",
    );
  if (tool === "verify_web")
    return effect(
      "critical",
      "Execute workspace HTML and JavaScript in a disposable browser with external networking blocked",
    );
  if (tool === "mcp_call")
    return effect(
      "unknown",
      "Connector may change an external system; inspect connector, tool and exact arguments",
    );
  if (tool === "browser")
    return args.action === "read"
      ? effect("read", "Read the current page")
      : effect(
          "unknown",
          "Browser action may navigate, submit or change external state; inspect current page and target",
        );
  if (tool === "write_file" && targetExists === false)
    return effect("local", "Create a new workspace file");
  if (
    [
      "write_file",
      "edit_file",
      "apply_patch",
      "delete_file",
      "remove_file",
      "move_file",
      "rename_file",
      "save_skill",
    ].includes(tool)
  )
    return effect(
      "critical",
      "May overwrite or remove files, or install persistent instructions",
    );
  if (
    [
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
      "mcp_list",
      "connection_probe",
      "list_memories",
      "search_memory",
      "read_memory",
      "list_skills",
      "read_skill",
      "get_current_time",
      "web_search",
      "fetch_url",
      "list_projects",
    ].includes(tool)
  )
    return effect("read", "Read information");
  if (
    [
      "remember",
      "update_memory",
      "manage_memory",
      "create_draft",
      "draft_message",
      "publish_file",
      "create_document",
      "create_routine",
      "update_profile",
      "start_background_work",
      "track_pull_request",
      "verify_web",
    ].includes(tool)
  )
    return effect(
      "local",
      "Change local assistant records or produce a local result; descendant actions remain guarded",
    );
  return effect("unknown", "Unrecognized tool effects require inspection");
}
