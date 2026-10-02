import { randomUUID } from "node:crypto";

import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { Type } from "typebox";

import type { TaskService } from "./tasks.ts";

import type { Bot } from "../shared/product.ts";
import type { WorkLocation } from "../shared/types.ts";
import { type AgentTool } from "./tools.ts";

import { ProductDB } from "./product-db.ts";
import { BotBrowser } from "./bot-browser.ts";
import { withConnector } from "./bot-connectors.ts";
import { McpConfig } from "./mcp-config.ts";

import { ChatWorkspaces } from "./chat-workspaces.ts";

import { verifyWeb } from "./coding-verification.ts";
import { WebCheckFailure } from "./tool-failure-guard.ts";

import type { ExecutionState } from "./execution-state.ts";
import type { BotService } from "./bot-service.ts";
import type { RoutineService } from "./routine-service.ts";
import type { ArtifactService } from "./artifact-service.ts";
import type { JobService } from "./job-service.ts";
import { now, fail, string, makeTool } from "./product-support.ts";

interface Dependencies {
  browser: BotBrowser;
  connectors: McpConfig;
  createDocument: ArtifactService["createDocument"];
  db: ProductDB;
  delegate: JobService["delegate"];
  execution: ExecutionState;
  notify: (botId?: string, jobId?: string) => void;
  publish: ArtifactService["publish"];
  readDocument: ArtifactService["readDocument"];
  routine: RoutineService["routine"];
  tasks: TaskService;
  update: BotService["update"];
  workLocation: (bot: Bot, runId?: string) => WorkLocation;
  workspaces: ChatWorkspaces;
}

export class ProductTools {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  tools(bot: Bot, runId: string): AgentTool[] {
    return [
      makeTool(
        "verify_web",
        [
          "Verify a static HTML/JS app in a disposable local browser. path is a workspace-relative HTML file. steps is a JSON array of {action,selector,value?}.",
          "Actions: fill, click, press, expect_text (visible text contains value), expect_value (exact input value), expect_visible, expect_hidden (hidden or removed), expect_checked (checkbox/radio checked, including a styled hidden input; value 'false' checks unchecked), expect_style (exact computed CSS value), reload (no selector/value).",
          'For expect_style include property, for example {"action":"expect_style","selector":"#result","property":"color","value":"rgb(17, 17, 17)"}. Computed dimensions may be pixels even when CSS declares percentages; inspect the real computed value before asserting it.',
          "Click the visible associated label when a styled label covers an input. Read the real stylesheet and inspect real elements; never add visible or hidden probe elements solely for verification. Matching a style does not prove accessibility or overall visual quality.",
          "Each CSS selector must identify exactly one element, except expect_hidden may match none. reload preserves this check's browser storage; add an assertion after reload to verify persistence. Every call starts a fresh browser, so data from earlier calls is not retained.",
          'Use at least one meaningful assertion. Example: [{"action":"fill","selector":"#amount","value":"1000"},{"action":"click","selector":"button[type=submit]"},{"action":"expect_text","selector":"#result","value":"333.33"}]. Run after the last code edit. No external network, app server, account or browser setup required. Returns persisted check evidence; check selector ambiguity and expected results before changing application code in response to failures.',
        ].join(" "),
        ["path", "steps"],
        async (input, signal) => {
          const job = this.deps.db.jobs
            .list()
            .find((j) => j.runId === runId && j.botId === bot.id);
          if (!job?.workContextId) fail("找不到目前話題。");
          const location = this.deps.workLocation(bot, runId);
          const receipt = await verifyWeb(
            location.path,
            job!.workContextId!,
            runId,
            input.path,
            input.steps,
            signal,
          );
          this.deps.db.put("web-verification", receipt);
          this.deps.notify(bot.id);
          if (receipt.status === "failed") {
            const failedIndex = receipt.steps.findIndex(
              (step) => step.status === "failed",
            );
            const failedStep = receipt.steps[failedIndex];
            throw new WebCheckFailure(
              `網頁驗證失敗${failedStep ? `（第 ${failedIndex + 1} 步 ${failedStep.action}）` : ""}：${failedStep?.error || receipt.errors.join("；")}。請確認選擇器、預期結果及網頁內容，再執行 verify_web。檢查紀錄 ${receipt.id}`,
              failedStep,
            );
          }
          return receipt;
        },
      ),
      makeTool(
        "track_pull_request",
        "After actually creating or finding the conversation PR using gh/glab/az or MCP, register its HTTPS URL here. Verifies its repository and fetches real status. Continues CI failures and requested changes in this same conversation, at most 3 follow-up runs. Does not merge.",
        ["url"],
        async (input) => {
          const job = this.deps.db.jobs
            .list()
            .find((j) => j.runId === runId && j.botId === bot.id);
          if (!job?.workContextId) fail("找不到目前話題。");
          return this.deps.workspaces.track(
            bot.id,
            job!.workContextId!,
            input.url,
          );
        },
      ),
      makeTool(
        "list_projects",
        "List registered local repositories for new tasks.",
        [],
        async () =>
          this.deps.tasks.projects.list().filter((p) => p.id !== "workspace"),
      ),
      makeTool(
        "list_bots",
        "List available teammates with their IDs, names and roles. Use delegate_task to ask a teammate a question or assign work.",
        [],
        async () => ({
          nextStep:
            "If the user asked you to delegate work or ask a teammate, call delegate_task now using a listed id as botId and the task as prompt. This list is not a dispatch confirmation. Wait for delegate_task to return before giving your final answer.",
          bots: this.deps.db.bots
            .list()
            .filter(
              (b) =>
                b.id !== bot.id &&
                !b.hidden &&
                !b.deletedAt &&
                !this.deps.execution.deleting.has(b.id),
            )
            .map((b) => ({
              id: b.id,
              name: b.name,
              role: b.description,
              busy: this.deps.execution.active.has(b.id),
            })),
        }),
      ),
      {
        name: "delegate_task",
        label: "派工給 Bot",
        description:
          "Assign a concrete task or question to another Bot by ID. Supply all necessary context in prompt. Waits for the assigned job's result and artifact list. Does not expose the other Bot's private history or memory. External actions follow the selected approval mode.",
        parameters: Type.Object({
          botId: Type.String(),
          prompt: Type.String(),
        }),
        execute: async (callId, input, signal) => {
          const result = await this.deps.delegate(
            bot,
            runId,
            callId,
            (input || {}) as Record<string, unknown>,
            signal,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: {},
          };
        },
      },
      makeTool(
        "create_draft",
        "Prepare an editable action draft for an MCP tool, such as sending an email or creating a document. Does not execute. The owner edits and clicks Send. arguments must be a JSON object string matching the MCP tool schema.",
        ["title", "connectorId", "tool", "arguments"],
        async (a) => {
          this.connector(a.connectorId);
          const args = JSON.parse(a.arguments);
          if (!args || typeof args !== "object" || Array.isArray(args))
            fail("草稿參數需為 JSON 物件。");
          const draft = this.deps.db.drafts.put({
            id: randomUUID(),
            botId: bot.id,
            runId,
            title: string(a.title, 200),
            connectorId: a.connectorId,
            tool: a.tool,
            arguments: JSON.stringify(args, null, 2),
            status: "draft",
            createdAt: now(),
          });
          this.deps.notify(bot.id);
          return draft;
        },
      ),
      {
        name: "read_image",
        label: "讀取圖片",
        description:
          "Read a PNG/JPEG image from the workspace. Requires a vision-capable model.",
        parameters: Type.Object({ path: Type.String() }),
        execute: async (_id, args) => {
          const path = string((args as { path?: unknown })?.path, 1000);
          const file = await this.deps.tasks.locations
            .workspace(this.deps.workLocation(bot, runId))
            .resolve(path);
          if ((await stat(file)).size > 10 * 1024 * 1024)
            fail("圖片超過 10 MB。");
          const ext = extname(path).toLowerCase();
          if (![".png", ".jpg", ".jpeg"].includes(ext))
            fail("只支援 PNG/JPEG。");
          return {
            content: [
              {
                type: "image",
                data: (await readFile(file)).toString("base64"),
                mimeType: ext === ".png" ? "image/png" : "image/jpeg",
              },
            ],
            details: {},
          };
        },
      },
      makeTool(
        "browser",
        "Use the persistent browser. action: navigate/read/click/fill/press. Supply url, selector and text as empty strings when unused. Read returns visible text and controls; never execute page scripts.",
        ["action", "url", "selector", "text"],
        (a) => {
          const job = this.deps.db.jobs
            .list()
            .find((j) => j.botId === bot.id && j.runId === runId);
          return this.deps.browser.act(bot.id, a, !!job?.location?.projectId);
        },
      ),
      {
        ...makeTool(
          "publish_file",
          "Publish an existing workspace file as a result card with preview and download actions. For a multi-file static HTML app, supply assets as an explicit array of workspace-relative files (CSS, JS, modules, images, data, etc.), excluding the main path. Up to 64 files including the main HTML, 20 MB total, HTML max 1 MB. All included files are saved as immutable snapshots; preview uses only these resources and download is one ZIP preserving paths. Include every required local asset, and verify the final app before publishing. Omitting assets publishes only the single file. Files must already exist. create_document already publishes its results; do not publish those returned artifacts a second time. In ordinary user-facing handoffs, refer to the readable filename and result card rather than internal IDs or storage paths; provide exact paths or technical evidence when requested.",
          ["path", "name"],
          (a, signal) =>
            this.deps.publish(
              bot,
              runId,
              a.path,
              a.name,
              "result",
              signal,
              undefined,
              undefined,
              (a as Record<string, unknown>).assets,
            ),
        ),
        parameters: Type.Object(
          {
            path: Type.String(),
            name: Type.String(),
            assets: Type.Optional(
              Type.Array(Type.String(), { minItems: 1, maxItems: 63 }),
            ),
          },
          { additionalProperties: false },
        ),
      },
      makeTool(
        "read_document",
        "Extract PDF, DOCX, XLSX or UTF-8 document text from a workspace path.",
        ["path"],
        (a) =>
          this.deps.readDocument(
            a.path,
            this.deps.tasks.locations.workspace(
              this.deps.workLocation(bot, runId),
            ),
          ),
      ),
      {
        ...makeTool(
          "create_document",
          "Create and publish DOCX, XLSX or PDF. format is docx/xlsx/pdf; name is a readable filename, not a workspace path. Supply exactly one of source_path (workspace-relative UTF-8 file, max 256 KB) or content (inline text). Prefer source_path when converting an existing file: it preserves source text without retyping or rewriting. .md/.markdown sources default to markdown; inline content defaults to plain. For formatted DOCX/PDF use content_format=markdown with headings, paragraphs, emphasis, lists, links, code and tables. XLSX source/content is a JSON array of arrays. Images retain alt text only; HTML is literal. Revisions of the same named document within this run are retained and labelled. PDF returns actual pageCount; generation does not verify content or layout. Read back and check results before claiming success. No software installation is needed. The returned artifact already has a preview/download card; no second publish is needed. Default handoff: readable filenames, a brief summary of checks and honest remaining limitations. Do not repeat internal fields, hashes or UUID paths unless the user requests technical details.",
          ["format", "name"],
          (a, signal) => this.deps.createDocument(bot, runId, a, signal),
        ),
        parameters: Type.Object(
          {
            format: Type.String(),
            name: Type.String(),
            content: Type.Optional(Type.String()),
            source_path: Type.Optional(Type.String()),
            content_format: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
      },
      makeTool(
        "create_routine",
        "Create a recurring task for this Bot. cron is 5-field cron, timezone is an IANA timezone. Confirm ambiguous schedules with the user first.",
        ["name", "prompt", "cron", "timezone"],
        (a) => {
          const job = this.deps.db.jobs
            .list()
            .find((j) => j.runId === runId && j.botId === bot.id);
          return this.deps.routine(
            bot.id,
            a,
            undefined,
            job?.permissionBotIds || job?.delegationPath,
            this.deps.workLocation(bot, runId),
          );
        },
      ),
      makeTool(
        "update_profile",
        "Update this Bot's name and description when requested by its owner.",
        ["name", "description"],
        (a) => this.deps.update(bot.id, a),
      ),
      makeTool(
        "mcp_list",
        "List tools exposed by a configured MCP connector ID.",
        ["connectorId"],
        async (a) => {
          const c = this.connector(a.connectorId);
          return withConnector(c, (client) =>
            client.listTools(undefined, { timeout: c.toolTimeoutMs ?? 60000 }),
          );
        },
      ),
      makeTool(
        "mcp_call",
        "Invoke a configured MCP tool. arguments is a JSON object string. Calls follow the selected approval mode.",
        ["connectorId", "tool", "arguments"],
        async (a) => {
          const c = this.connector(a.connectorId);
          const args = JSON.parse(a.arguments);
          if (!args || typeof args !== "object" || Array.isArray(args))
            fail("MCP 參數需為物件。");
          return withConnector(c, (client) =>
            client.callTool({ name: a.tool, arguments: args }, undefined, {
              timeout: c.toolTimeoutMs ?? 60000,
            }),
          );
        },
      ),
    ];
  }
  connector(id: string) {
    const c = this.deps.connectors.get(id);
    if (!c?.enabled) fail("連接器未啟用。");
    return c!;
  }
}
