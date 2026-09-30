import type { IncomingMessage, ServerResponse } from "node:http";

import { FileManager } from "../file-manager.ts";
import { HtmlPreview } from "../html-preview.ts";

import type { TaskService } from "../tasks.ts";

import type { Bot } from "../../shared/product.ts";
import type { WorkLocation } from "../../shared/types.ts";

import { ProductDB } from "../product-db.ts";
import { BotBrowser } from "../bot-browser.ts";

import { McpConfig } from "../mcp-config.ts";
import { AvatarCollectionService } from "../avatar-collection.ts";

import { SettingsService } from "../settings.ts";

import { ChatWorkspaces } from "../chat-workspaces.ts";

import type { ExecutionState } from "../execution-state.ts";
import type { BotService } from "../bot-service.ts";
import type { ApprovalService } from "../approval-service.ts";
import type { RoutineService } from "../routine-service.ts";
import type { ArtifactService } from "../artifact-service.ts";
import type { MessageService } from "../message-service.ts";
import type { ProductQueries } from "../product-queries.ts";
import type { ProductTools } from "../product-tools.ts";

export interface RouteDependencies {
  avatarCollection: AvatarCollectionService;
  bootstrap: () => Promise<void>;
  bot: BotService["bot"];
  browser: BotBrowser;
  connector: ProductTools["connector"];
  connectors: McpConfig;
  create: BotService["create"];
  db: ProductDB;
  decide: ApprovalService["decide"];
  detail: ProductQueries["detail"];
  execution: ExecutionState;
  files: FileManager;
  htmlPreview: HtmlPreview;
  memoryScope: BotService["memoryScope"];
  newContext: MessageService["newContext"];
  notify: (botId?: string, jobId?: string) => void;
  policy: ApprovalService["policy"];
  publish: ArtifactService["publish"];
  readDocument: ArtifactService["readDocument"];
  receiveMessage: MessageService["receiveMessage"];
  remove: BotService["remove"];
  routine: RoutineService["routine"];
  runRecord: ProductQueries["runRecord"];
  runRoutine: RoutineService["runRoutine"];
  settings: SettingsService;
  snapshot: ProductQueries["snapshot"];
  steerMessage: MessageService["steerMessage"];
  subscribers: Set<ServerResponse>;
  tasks: TaskService;
  template: BotService["template"];
  update: BotService["update"];
  workLocation: (bot: Bot, runId?: string) => WorkLocation;
  workspaces: ChatWorkspaces;
  writableBot: BotService["writableBot"];
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  path: string;
  method: string | undefined;
  body: (req: IncomingMessage) => Promise<Record<string, unknown>>;
}
export interface BotRequestContext extends RequestContext {
  id: string;
  action: string;
  bot: Bot;
}
