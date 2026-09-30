import type { ServerResponse } from "node:http";

import { join } from "node:path";

import { Workspace } from "./workspace.ts";
import { Type } from "typebox";

import { ToolAuthorizationError, type AgentTool } from "./tools.ts";

import { type PolicyDecision } from "./policy.ts";

export const now = () => new Date().toISOString();
export const fail = (text: string, status = 400): never => {
  throw Object.assign(new Error(text), { status });
};
export const denyOperation = (policy: PolicyDecision): never => {
  throw new ToolAuthorizationError(
    policy.reason === "invalid-path"
      ? "工作區路徑無效。path 必須使用工作區內的相對路徑，例如 index.html 或 snake/index.html；不可使用磁碟代號、絕對路徑或 '..'。請修正 path 後重試。"
      : "這項操作被權限規則拒絕。請改用允許的操作，或請使用者調整相關權限。",
    {
      reason: policy.reason,
      dangerousCommand: policy.dangerousCommand,
      matchedRuleIds: policy.matchedRuleIds,
    },
  );
};
export const string = (value: unknown, max = 16000) =>
  typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : fail("內容為空或超過長度限制。");
export const reply = (res: ServerResponse, value: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
};
export function makeTool(
  name: string,
  description: string,
  fields: string[],
  run: (args: Record<string, string>, signal?: AbortSignal) => Promise<unknown>,
): AgentTool {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object(
      Object.fromEntries(fields.map((f) => [f, Type.String()])),
      { additionalProperties: false },
    ),
    execute: async (_id, args, signal) => {
      signal?.throwIfAborted();
      if (
        !args ||
        typeof args !== "object" ||
        fields.some(
          (f) => typeof (args as Record<string, unknown>)[f] !== "string",
        )
      )
        fail("工具參數不完整。");
      const output = await run(args as Record<string, string>, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        details: {},
      };
    },
  };
}

export async function hasStaticWebPage(root: string) {
  const workspace = new Workspace(root);
  const directories = [""];
  let scanned = 0;
  while (directories.length && scanned < 300) {
    const path = directories.shift()!;
    for (const file of await workspace.list(path).catch(() => [])) {
      if (++scanned > 300) return false;
      if (file.type === "file" && /\.html?$/i.test(file.name)) return true;
      if (
        file.type === "directory" &&
        !["node_modules", ".next", ".venv", "vendor"].includes(file.name) &&
        path.split("/").length < 4
      )
        directories.push([path, file.name].filter(Boolean).join("/"));
    }
  }
  return false;
}
