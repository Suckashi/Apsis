import { changeMemory } from "./memory.ts";
import { Type, type TSchema } from "typebox";
import { codingTools } from "./coding-tools.ts";
import {
  boundedEvidence,
  ToolExecutionError,
  type Evidence,
} from "./evidence.ts";
import { randomUUID } from "node:crypto";
import { skillIndex } from "./context.ts";
import { scopedState } from "./agents.ts";
import type { ToolOptions } from "./runtime.ts";
import { normalizeFact, revise } from "./knowledge.ts";
import type { ToolOperation } from "../shared/types.ts";
export interface AgentToolResult {
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  details: Record<string, unknown>;
}
export interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  execute(
    id: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<AgentToolResult>;
}
type ToolHandler = (
  args: Record<string, string>,
  signal?: AbortSignal,
) => unknown | Promise<unknown>;
const schema = (properties: string[]) =>
  Type.Object(
    Object.fromEntries(properties.map((name) => [name, Type.String()])),
    { additionalProperties: false },
  );
const result = (value: unknown): AgentToolResult => ({
  content: [
    {
      type: "text",
      text:
        typeof value === "string" ? value : (JSON.stringify(value) ?? "null"),
    },
  ],
  details: {},
});
const tool = (
  name: string,
  description: string,
  fields: string[],
  run: ToolHandler,
): AgentTool => ({
  name,
  label: name,
  description,
  parameters: schema(fields),
  execute: async (_id, args, signal) => {
    signal?.throwIfAborted();
    if (
      !args ||
      typeof args !== "object" ||
      fields.some(
        (field) => typeof (args as Record<string, unknown>)[field] !== "string",
      )
    )
      throw new Error("工具參數格式錯誤。");
    return result(await run(args as Record<string, string>, signal));
  },
});

export function createTools({
  store,
  workspace,
  allowWrites,
  agent,
  permissions,
  source,
  recordOperation,
  probe,
  extraTools = [],
  authorize,
  runtimeSettings,
  executeAuthorizedTool,
  checkToolPermission,
}: ToolOptions) {
  if (probe)
    return [
      tool(
        "connection_probe",
        "Call this tool to verify tool support. Pass the requested nonce exactly.",
        ["nonce"],
        (a) => {
          if (a.nonce !== probe.nonce) throw new Error("驗證值不符");
          probe.called();
          return probe.nonce;
        },
      ),
    ];
  const view = () => scopedState(store.state, agent);
  const writable =
    (
      fn: ToolHandler,
      kind: "files" | "memory" | "skills" = "memory",
    ): ToolHandler =>
    async (...args) => {
      if (!(permissions ? permissions[kind] : allowWrites))
        throw new Error("使用者尚未開啟「允許修改」此類資料的權限。");
      return fn(...args);
    };
  const memoryVersions = new Map(
    view().memories.map((m) => [m.id, m.revision ?? 1]),
  );
  const tools = [
    tool(
      "read_history",
      "Read surrounding messages for a sequence from search_history. Results are scoped to your Bot.",
      ["sequence"],
      (a) =>
        store.conversations.around(
          view().sessions.map((s) => s.id),
          Number(a.sequence),
        ),
    ),
    tool(
      "manage_memory",
      "Manage memory using JSON: id and revision for updates, content, tier (core/reference), enabled, mergeIds and mergeRevisions. Omit id to create. Cannot change user-edited or locked memories.",
      ["change"],
      writable(async (a) => {
        const change = JSON.parse(a.change);
        return store.mutate((s) =>
          changeMemory(
            s,
            agent?.memoryScope === "private" ? agent.id : undefined,
            change,
            { kind: "agent", ...source },
          ),
        );
      }),
    ),
    ...codingTools({
      store,
      workspace,
      allowWrites,
      permissions,
      runtimeSettings,
    }),
    tool(
      "list_skills",
      "List reusable skill names, IDs and brief descriptions. Pass a query or empty string to list all.",
      ["query"],
      (a) =>
        skillIndex(view())
          .filter((s) =>
            (s.name + " " + s.description)
              .toLocaleLowerCase()
              .includes(a.query.toLocaleLowerCase()),
          )
          .slice(0, 100),
    ),
    tool(
      "read_skill",
      "Load the complete procedure for a skill ID from list_skills.",
      ["id"],
      (a) => {
        const skill = view().skills.find((s) => s.id === a.id);
        if (!skill) throw new Error("找不到技能。");
        return skill;
      },
    ),
    tool(
      "search_history",
      "Search your scoped archived history. Query must be 2–200 characters. For older results, set optional before to the smallest sequence returned; read_history loads surrounding messages.",
      ["query"],
      (a) => {
        const query = a.query.trim().toLocaleLowerCase();
        if (query.length < 2 || query.length > 200)
          throw new Error("查詢需為 2–200 字。");
        const before = a.before ? Number(a.before) : undefined;
        if (
          before !== undefined &&
          (!Number.isSafeInteger(before) || before < 1)
        )
          throw new Error("無效的分頁游標。");
        return store.conversations.search(
          query,
          view().sessions.map((s) => s.id),
          before,
        );
      },
    ),
    tool(
      "update_memory",
      "Replace an outdated memory by ID. Requires write permission. Never store credentials.",
      ["id", "content"],
      writable(async (a) => {
        if (!a.content.trim() || a.content.length > 4000)
          throw new Error("記憶需為 1–4000 字。");
        const updated = await store.mutate((s) =>
          changeMemory(
            s,
            agent?.memoryScope === "private" ? agent.id : undefined,
            {
              id: a.id,
              revision: memoryVersions.get(a.id),
              content: a.content,
            },
            { kind: "agent", ...source },
          ),
        );
        memoryVersions.set(updated.id, updated.revision ?? 1);
        return updated;
      }),
    ),
    tool(
      "list_files",
      "List files in the local workspace. Use an empty path for the root.",
      ["path"],
      (a) => workspace.list(a.path),
    ),
    tool("read_file", "Read a UTF-8 file in the workspace.", ["path"], (a) =>
      workspace.read(a.path),
    ),
    tool(
      "remember",
      "Save a useful user preference or durable project fact. Never store credentials.",
      ["content"],
      writable(async (a) => {
        if (!a.content.trim() || a.content.length > 4000)
          throw new Error("記憶長度必須為 1–4000 字。");
        const saved = await store.mutate((s) =>
          changeMemory(
            s,
            agent?.memoryScope === "private" ? agent.id : undefined,
            { content: a.content },
            { kind: "agent", ...source },
          ),
        );
        memoryVersions.set(saved.id, saved.revision ?? 1);
        return saved;
      }),
    ),
    tool(
      "save_skill",
      "Save a reusable procedure after a successful task. Never include secrets.",
      ["name", "content"],
      writable(async (a) => {
        if (
          !a.name.trim() ||
          a.name.length > 100 ||
          !a.content.trim() ||
          a.content.length > 12000
        )
          throw new Error("技能名稱或內容長度不符。");
        await store.mutate((s) =>
          s.skills.push({
            source: { kind: "agent", ...source },
            ...(agent ? { agentId: agent.id } : {}),
            id: randomUUID(),
            name: a.name,
            content: a.content,
            createdAt: new Date().toISOString(),
          }),
        );
        return "已儲存技能。";
      }, "skills"),
    ),
  ];
  tools.find((t) => t.name === "search_history")!.parameters = Type.Object(
    { query: Type.String(), before: Type.Optional(Type.String()) },
    { additionalProperties: false },
  );
  const selected = agent
    ? tools.filter((t) => agent.tools.includes(t.name))
    : tools;
  return [...selected, ...extraTools].map((t) => ({
    ...t,
    execute: async (id: string, args: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      // Snapshot parameters before the first async boundary: approval and execution
      // must refer to the same operation, even if a caller mutates its object.
      args = structuredClone(args);
      let receipt = await authorize?.(t.name, args, signal);
      signal?.throwIfAborted();
      const values = args as Record<string, unknown> | null;
      const target =
        values &&
        (["path", "id", "botId", "name", "command"]
          .map((k) => values[k])
          .find((v) => typeof v === "string") as string | undefined);
      const operation: ToolOperation = {
        ...(receipt
          ? {
              authorization: {
                reason: receipt.reason,
                dangerousCommand: receipt.dangerousCommand,
                matchedRuleIds: receipt.matchedRuleIds,
              },
            }
          : {}),
        id: randomUUID(),
        name: t.name,
        status: "started",
        startedAt: new Date().toISOString(),
        mutating: [
          "write_file",
          "edit_file",
          "shell",
          "remember",
          "update_memory",
          "manage_memory",
          "save_skill",
          "delegate_task",
        ].includes(t.name),
        target: target?.slice(0, 300),
      };
      await recordOperation?.(operation);
      let executed = false;
      try {
        signal?.throwIfAborted();
        const execute = async () => {
          signal?.throwIfAborted();
          const updated = await checkToolPermission?.(
            t.name,
            args,
            signal,
            receipt || undefined,
          );
          if (updated) {
            receipt = updated;
            operation.authorization = {
              reason: updated.reason,
              dangerousCommand: updated.dangerousCommand,
              matchedRuleIds: updated.matchedRuleIds,
            };
          }
          signal?.throwIfAborted();
          return t.execute(id, args, signal);
        };
        const output = await (executeAuthorizedTool
          ? executeAuthorizedTool(t.name, execute, signal)
          : execute());
        executed = true;
        await recordOperation?.({
          ...operation,
          status: "succeeded",
          evidence:
            (output.details.evidence as Evidence | undefined) ||
            boundedEvidence(
              {
                output: output.content
                  .map((c) =>
                    c.type === "text" ? c.text : `[${c.mimeType} image]`,
                  )
                  .join("\n"),
              },
              runtimeSettings?.outputLimit,
            ),
          endedAt: new Date().toISOString(),
        });
        return output;
      } catch (error) {
        await recordOperation?.({
          ...operation,
          status: executed || t.name === "shell" ? "unknown" : "failed",
          endedAt: new Date().toISOString(),
          error: (error as Error).message,
          evidence:
            error instanceof ToolExecutionError ? error.evidence : undefined,
        });
        throw error;
      }
    },
  }));
}
