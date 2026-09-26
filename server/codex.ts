import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { agentContext } from "./context.ts";
import { createTools, type AgentTool } from "./tools.ts";
import type { RunOptions } from "./runtime.ts";
import { codexProgress, codexTurnNotifications } from "./codex-progress.ts";

type RpcMessage = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string };
};

class CodexClient {
  process: ChildProcessWithoutNullStreams;
  nextId = 1;
  pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  listeners = new Set<(message: RpcMessage) => void>();
  buffer = "";
  stderr = "";
  constructor() {
    this.process = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (;;) {
        const end = this.buffer.indexOf("\n");
        if (end < 0) break;
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          this.receive(JSON.parse(line));
        } catch {
          // Codex may write a diagnostic line before protocol startup.
        }
      }
    });
    this.process.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-2000);
    });
    const fail = (error: Error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
    };
    this.process.on("error", () =>
      fail(new Error("找不到 Codex CLI，請先安裝 Codex。")),
    );
    this.process.on("exit", (code) =>
      fail(
        new Error(
          `Codex App Server 已停止 (${code ?? "unknown"})。${this.stderr.slice(-300)}`,
        ),
      ),
    );
  }
  receive(message: RpcMessage) {
    if (
      typeof message.id === "number" &&
      (message.result !== undefined || message.error)
    ) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error)
          pending.reject(
            new Error(message.error.message || "Codex 請求失敗。"),
          );
        else pending.resolve(message.result);
      }
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
  send(message: RpcMessage) {
    this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  async request(method: string, params: unknown = {}) {
    const id = this.nextId++;
    const promise = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} 逾時。`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.send({ id, method, params });
    return await promise;
  }
  async init() {
    await this.request("initialize", {
      clientInfo: { name: "apsis", title: "Apsis", version: "0.2.0" },
      capabilities: {},
    });
    this.send({ method: "initialized", params: {} });
    return this;
  }
  close() {
    this.process.kill();
  }
}

export class CodexRuntime {
  active = new Map<string, { tools: AgentTool[]; signal: AbortSignal }>();
  login?: CodexClient;
  loginResult: {
    state: "idle" | "pending" | "completed" | "failed";
    error?: string;
  } = { state: "idle" };
  getPort: () => number | undefined;
  constructor(getPort: () => number | undefined) {
    this.getPort = getPort;
  }
  async inspect() {
    const client = await new CodexClient().init();
    try {
      const [account, models] = await Promise.all([
        client.request("account/read", { refreshToken: false }),
        client.request("model/list", { limit: 50, includeHidden: false }),
      ]);
      return {
        connected: account.account?.type === "chatgpt",
        plan: account.account?.planType || null,
        login: this.loginResult,
        models: (models.data || []).map(
          (m: { model: string; displayName: string }) => ({
            id: m.model,
            name: m.displayName,
          }),
        ),
      };
    } finally {
      client.close();
    }
  }
  async beginLogin() {
    if (this.login && this.loginResult.state === "pending")
      throw new Error("ChatGPT 登入正在進行中。");
    this.login?.close();
    const client = await new CodexClient().init();
    this.login = client;
    this.loginResult = { state: "pending" };
    client.listeners.add((message) => {
      if (message.method !== "account/login/completed") return;
      this.loginResult = message.params?.success
        ? { state: "completed" }
        : { state: "failed", error: message.params?.error || "登入失敗。" };
      client.close();
      if (this.login === client) this.login = undefined;
    });
    try {
      const result = await client.request("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "codex",
      });
      if (!result.authUrl || !/^https:\/\//.test(result.authUrl))
        throw new Error("Codex 未提供登入網址。");
      return { url: result.authUrl };
    } catch (error) {
      this.loginResult = { state: "failed", error: (error as Error).message };
      client.close();
      this.login = undefined;
      throw error;
    }
  }
  async handleMcp(req: IncomingMessage, res: ServerResponse, token: string) {
    const entry = this.active.get(token);
    if (!entry || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    const server = new Server(
      { name: "apsis", version: "0.2.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "Use list_bots to find an Apsis teammate, then delegate_task to actually assign work. A list is not a dispatch.",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: entry.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters as any,
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = entry.tools.find((t) => t.name === request.params.name);
      if (!tool)
        return {
          content: [{ type: "text" as const, text: "Unknown tool" }],
          isError: true,
        };
      try {
        const result = await tool.execute(
          randomUUID(),
          request.params.arguments || {},
          entry.signal,
        );
        return { content: result.content };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: (error as Error).message }],
          isError: true,
        };
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } finally {
      await server.close();
    }
  }
  async run(options: RunOptions) {
    const account = await this.inspect();
    if (!account.connected) throw new Error("請先在模型設定登入 ChatGPT。");
    const port = this.getPort();
    if (!port) throw new Error("Apsis 本機伺服器尚未啟動。");
    const token = randomUUID();
    this.active.set(token, {
      tools: createTools(options),
      signal: options.signal,
    });
    let client: CodexClient;
    try {
      client = await new CodexClient().init();
    } catch (error) {
      this.active.delete(token);
      throw error;
    }
    let threadId = "";
    let turnId = "";
    let final = "";
    let latest = "";
    let completed!: (value: string) => void;
    let failed!: (error: Error) => void;
    const turn = new Promise<string>((resolve, reject) => {
      completed = resolve;
      failed = reject;
    });
    void turn.catch(() => {});
    const abort = () => {
      if (threadId && turnId)
        void client
          .request("turn/interrupt", { threadId, turnId })
          .catch(() => {});
      failed(new Error("已停止執行。"));
      client.close();
    };
    options.signal.addEventListener("abort", abort, { once: true });
    const progress = codexProgress(options);
    const notifications = codexTurnNotifications((method, params) => {
      progress.receive(method, params);
      if (
        method === "item/completed" &&
        params?.item?.type === "agentMessage"
      ) {
        const item = params.item;
        if (item.phase === "final_answer") final = item.text || "";
        else latest = item.text || latest;
      }
      if (method === "turn/completed") {
        const state = params.turn;
        if (state.status === "completed") completed(final || latest);
        else
          failed(
            new Error(state.error?.message || `Codex 任務${state.status}。`),
          );
      }
    });
    client.listeners.add((message) => {
      if (message.method) notifications.receive(message.method, message.params);
    });
    try {
      const system =
        agentContext(
          options.store,
          options.allowWrites,
          options.agent,
          options.prompt,
          options.permissions,
          options.executionContext,
        ) +
        "\nApsis product tools are on the apsis MCP server. For a request to assign work to another Bot, call list_bots and then delegate_task. A written claim is not proof of dispatch; use the actual delegate_task result.";
      const started = await client.request("thread/start", {
        model: options.env?.MODEL_ID,
        cwd: options.workspace.root,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
        serviceName: "apsis",
        developerInstructions: system,
        config: {
          mcp_servers: {
            apsis: {
              url: `http://127.0.0.1:${port}/api/codex/mcp/${token}`,
              required: true,
              // Apsis enforces its own tool permissions and approval rules.
              default_tools_approval_mode: "approve",
            },
          },
        },
      });
      threadId = started.thread.id;
      notifications.thread(threadId);
      const history = options.session.messages
        .filter((m) => m.status === "complete")
        .slice(-12)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");
      const startedTurn = await client.request("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text:
              (history ? `Previous Apsis conversation:\n${history}\n\n` : "") +
              options.prompt,
          },
        ],
      });
      turnId = startedTurn.turn.id;
      notifications.turn(turnId);
      const text = await turn;
      await progress.flush();
      if (!text.trim()) throw new Error("Codex 未回傳內容。");
      options.emit({ type: "delta", text });
      return { text };
    } finally {
      try {
        await progress.flush();
      } finally {
        options.signal.removeEventListener("abort", abort);
        this.active.delete(token);
        client.close();
      }
    }
  }
  close() {
    this.login?.close();
  }
}
