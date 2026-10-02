import {
  parseRequest,
  botCreateSchema,
  botUpdateSchema,
  templateSchema,
} from "./request-schema.ts";
import type { BotPreferencesRequest } from "../shared/api.ts";
import { contextBudget } from "./context-budget.ts";
import { randomUUID } from "node:crypto";

import { resolve } from "node:path";

import type { TaskService } from "./tasks.ts";
import type { Connections } from "./connections.ts";
import type { Bot, BotTemplate } from "../shared/product.ts";

import { ProductDB } from "./product-db.ts";
import { BotBrowser } from "./bot-browser.ts";

import { McpConfig } from "./mcp-config.ts";
import { isBotAvatar, type BotAvatarId } from "../shared/bot-avatars.ts";

import { validatePermissionRules } from "./settings.ts";

import type { WebVerification } from "../shared/coding-verification.ts";

import type { ExecutionState } from "./execution-state.ts";

import { now, fail, string } from "./product-support.ts";
import { transitionJob } from "./task-lifecycle.ts";

function validateAvatar(value: unknown): BotAvatarId {
  if (!isBotAvatar(value)) return fail("請選擇有效的 Bot 圖示。");
  return value;
}

interface Dependencies {
  browser: BotBrowser;
  connections: Connections;
  connectors: McpConfig;
  db: ProductDB;
  execution: ExecutionState;
  notify: (botId?: string, jobId?: string) => void;
  tasks: TaskService;
}

export class BotService {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  bot(id: string) {
    const bot = this.deps.db.bots.get(id);
    if (!bot || bot.deletedAt) fail("找不到 Bot。", 404);
    return bot!;
  }
  writableBot(id: string) {
    if (this.deps.execution.deleting.has(id)) fail("Bot 正在刪除中。", 409);
    return this.bot(id);
  }
  botPreferences(input: BotPreferencesRequest): Partial<Bot> {
    const value: Partial<Bot> = {};
    if (input.connectorIds !== undefined) {
      const ids = input.connectorIds;
      if (
        !Array.isArray(ids) ||
        ids.length > 1000 ||
        ids.some((id) => typeof id !== "string")
      )
        fail("連接器清單格式錯誤。");
      const available = new Set(this.deps.connectors.all().map((c) => c.id));
      if ((ids as string[]).some((id) => !available.has(id)))
        fail("連接器已不存在，請重新選擇。");
      value.connectorIds = [...new Set(ids as string[])];
    }
    if (input.permissionMode !== undefined) {
      if (!["workspace", "readonly"].includes(String(input.permissionMode)))
        fail("未知權限模式。");
      value.permissionMode = input.permissionMode as Bot["permissionMode"];
    }
    if (input.permissionRules !== undefined)
      value.permissionRules = validatePermissionRules(input.permissionRules);
    return value;
  }
  template(request: unknown, id: string = randomUUID()) {
    const input = parseRequest(templateSchema, request);
    const preferences = this.botPreferences(input);
    const selection = input.connectionId
      ? this.deps.connections.selection(input.connectionId, input.model)
      : {};
    const template: BotTemplate = {
      id,
      name: string(input.name, 80),
      description:
        input.description === undefined
          ? ""
          : typeof input.description === "string" &&
              input.description.length <= 4000
            ? input.description
            : fail("描述過長。"),
      avatar:
        input.avatar === undefined ? "orbit" : validateAvatar(input.avatar),
      ...selection,
      connectorIds: preferences.connectorIds || [],
      permissionMode: preferences.permissionMode || "workspace",
      permissionRules: preferences.permissionRules || [],
    };
    this.deps.db.templates.put(template);
    this.deps.notify();
    return template;
  }
  async removeBotData(bot: Bot) {
    const contextIds = new Set(
      this.deps.tasks.store.conversations.db
        .prepare("SELECT id FROM contexts WHERE session_id=?")
        .all(bot.sessionId)
        .map((c) => String(c.id)),
    );
    for (const receipt of this.deps.db.all<WebVerification>("web-verification"))
      if (contextIds.has(receipt.workContextId))
        this.deps.db.remove("web-verification", receipt.id);
    // The tombstone keeps partially completed deletions hidden across restarts.
    for (const kind of [
      "job",
      "approval",
      "session-allow",
      "routine",
      "draft",
      "artifact",
      "preferences",
      "message-receipt",
    ])
      for (const row of this.deps.db.query<{ id: string; botId?: string }>(
        kind,
        { botId: bot.id },
      ))
        this.deps.db.remove(kind, row.id);
    await this.deps.tasks.store.mutate((state) => {
      state.memories = state.memories.filter((m) => m.agentId !== bot.id);
      state.skills = state.skills.filter((s) => s.agentId !== bot.id);
    });
    await this.deps.tasks.store.conversations.remove(bot.sessionId);
    this.deps.db.bots.remove(bot.id);
  }
  async remove(id: string) {
    const bot = this.writableBot(id);
    if (
      this.deps.db.drafts
        .list()
        .some((d) => d.botId === id && d.status === "sending")
    )
      fail("外部操作正在傳送，請等待完成後再刪除 Bot。", 409);
    this.deps.execution.deleting.add(id);
    try {
      for (const job of this.deps.db.jobs.list())
        if (job.botId === id && job.status === "queued")
          this.deps.db.jobs.put(transitionJob(job, "cancelled"));
      const deadline = Date.now() + 10000;
      // A drain may still be preparing a run, so stop again until it settles.
      while (
        this.deps.execution.active.has(id) ||
        this.deps.tasks.running.has(bot.sessionId)
      ) {
        for (const job of this.deps.db.jobs.list())
          if (job.botId === id)
            this.deps.execution.jobControllers.get(job.id)?.abort();
        this.deps.tasks.stop(bot.sessionId);
        if (Date.now() >= deadline) fail("任務尚未停止，請稍後重試刪除。", 409);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const page = this.deps.browser.pages.get(id);
      if (page && !page.isClosed()) await page.close();
      this.deps.browser.pages.delete(id);
      if (this.deps.browser.owner === id) this.deps.browser.owner = undefined;
      this.deps.db.bots.put({ ...bot, deletedAt: now() });
      await this.removeBotData(bot);
      this.deps.execution.steers.delete(id);
      this.deps.notify(id);
    } finally {
      this.deps.execution.deleting.delete(id);
    }
  }
  memoryScope(bot: Bot) {
    return bot.id;
  }
  async create(name = "新 Bot", request: unknown = {}) {
    let input = parseRequest(botCreateSchema, request);
    if (input.templateId !== undefined) {
      const template =
        this.deps.db.templates.get(string(input.templateId, 100)) ||
        fail("找不到 Bot 範本。", 404);
      if (name === "新 Bot" && input.name === undefined) name = template.name;
      input = { ...template, ...input };
    }
    const preferences = this.botPreferences(input);
    name = string(name, 80);
    const description =
      input.description === undefined
        ? ""
        : typeof input.description === "string" &&
            input.description.length <= 4000
          ? input.description
          : fail("描述過長。");
    const avatar =
      input.avatar === undefined ? "orbit" : validateAvatar(input.avatar);
    const override = input.connectionId
      ? this.deps.connections.selection(input.connectionId, input.model)
      : undefined;
    const botId = randomUUID();
    const session = await this.deps.tasks.create({ botId });
    const bot = this.deps.db.bots.put({
      id: botId,
      sessionId: session.id,
      name,
      avatar,
      description,
      ...(override || {}),
      pinned: false,
      hidden: false,
      createdAt: now(),
      readAt: now(),
      connectorIds: preferences.connectorIds || [],
      permissionMode: preferences.permissionMode || "workspace",
      permissionRules: (preferences.permissionRules || []).map((r) => ({
        ...r,
        scope: "bot",
        botId,
      })),
    });
    this.deps.notify(bot.id);
    return bot;
  }
  async update(id: string, request: unknown) {
    const input = parseRequest(botUpdateSchema, request);
    const bot = this.writableBot(id);
    Object.assign(bot, this.botPreferences(input));
    bot.permissionRules = (bot.permissionRules || []).map((r) => ({
      ...r,
      scope: "bot",
      botId: bot.id,
    }));
    if (input.name !== undefined) bot.name = string(input.name, 80);
    if (input.avatar !== undefined) bot.avatar = validateAvatar(input.avatar);
    if (input.description !== undefined)
      bot.description =
        typeof input.description === "string" &&
        input.description.length <= 4000
          ? input.description
          : fail("描述過長。");
    for (const key of ["pinned", "hidden"] as const)
      if (typeof input[key] === "boolean") bot[key] = input[key];
    if (input.read === true) bot.readAt = now();
    if (input.readMessageId !== undefined) {
      const message = this.deps.tasks.store.conversations.message(
        bot.sessionId,
        input.readMessageId,
      );
      if (!message || message.role !== "assistant" || !message.createdAt)
        return fail("找不到可確認已讀的回覆。", 404);
      if (message.createdAt > bot.readAt) bot.readAt = message.createdAt;
    }
    if (input.connectionId !== undefined) {
      if (input.connectionId === "") {
        delete bot.connectionId;
        delete bot.model;
      } else {
        const selected = this.deps.connections.selection(
          input.connectionId,
          input.model,
        );
        Object.assign(bot, selected);
      }
    }
    this.deps.db.bots.put(bot);
    this.deps.notify(id);
    return bot;
  }
  validateContextModel(bot: Bot) {
    const selection = bot.connectionId
      ? this.deps.connections.selection(bot.connectionId, bot.model)
      : this.deps.connections.defaultSelection();
    if (!selection) fail("請先在設定加入模型連線。", 422);
    const connection = this.deps.connections
      .view()
      .find((c) => c.id === selection!.connectionId)!;
    return contextBudget(
      connection.provider,
      selection!.model,
      connection.modelSettings?.[selection!.model],
    );
  }
}
