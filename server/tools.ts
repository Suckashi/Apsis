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
  content: { type: "text"; text: string }[];
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
  const tools = [
    ...codingTools({ store, workspace, allowWrites, permissions }),
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
      "Find matching completed messages in the owner's past Web and bot conversations. Query must be at least two characters.",
      ["query"],
      (a) => {
        const query = a.query.trim().toLocaleLowerCase();
        if (query.length < 2 || query.length > 200)
          throw new Error("查詢需為 2–200 字。");
        return view()
          .sessions.flatMap((s) =>
            s.messages
              .filter(
                (m) =>
                  m.status === "complete" &&
                  m.content.toLocaleLowerCase().includes(query),
              )
              .map((m) => ({
                sessionId: s.id,
                title: s.title,
                role: m.role,
                excerpt: m.content.slice(
                  Math.max(
                    0,
                    m.content.toLocaleLowerCase().indexOf(query) - 160,
                  ),
                  Math.max(
                    0,
                    m.content.toLocaleLowerCase().indexOf(query) - 160,
                  ) + 1000,
                ),
              })),
          )
          .slice(0, 10);
      },
    ),
    tool(
      "update_memory",
      "Replace an outdated memory by ID. Requires write permission. Never store credentials.",
      ["id", "content"],
      writable(async (a) => {
        if (!a.content.trim() || a.content.length > 4000)
          throw new Error("記憶需為 1–4000 字。");
        await store.mutate((s) => {
          const memory = scopedState(s, agent).memories.find(
            (m) => m.id === a.id,
          );
          if (!memory) throw new Error("找不到記憶。");
          revise(memory, a.content);
        });
        return "記憶已更新。";
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
        await store.mutate((s) => {
          if (
            scopedState(s, agent).memories.some(
              (m) => normalizeFact(m.content) === normalizeFact(a.content),
            )
          )
            return;
          s.memories.push({
            source: { kind: "agent", ...source },
            ...(agent?.memoryScope === "private" ? { agentId: agent.id } : {}),
            id: randomUUID(),
            content: a.content,
            createdAt: new Date().toISOString(),
          });
        });
        return "已儲存記憶。";
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
  const selected = agent
    ? tools.filter((t) => agent.tools.includes(t.name))
    : tools;
  return selected.map((t) => ({
    ...t,
    execute: async (id: string, args: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const values = args as Record<string, unknown> | null;
      const target =
        values &&
        (["path", "id", "name", "command"]
          .map((k) => values[k])
          .find((v) => typeof v === "string") as string | undefined);
      const operation: ToolOperation = {
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
          "save_skill",
        ].includes(t.name),
        target: target?.slice(0, 300),
      };
      await recordOperation?.(operation);
      let executed = false;
      try {
        signal?.throwIfAborted();
        const output = await t.execute(id, args, signal);
        executed = true;
        await recordOperation?.({
          ...operation,
          status: "succeeded",
          evidence:
            (output.details.evidence as Evidence | undefined) ||
            boundedEvidence({
              output: output.content.map((c) => c.text).join("\n"),
            }),
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
