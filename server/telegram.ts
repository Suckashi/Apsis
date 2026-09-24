import {
  randomBytes,
  createHash,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TelegramView } from "../shared/types.ts";
import { asError } from "../shared/errors.ts";

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  from?: { id: number; is_bot?: boolean };
  sender_chat?: unknown;
  chat: { id: number; type: string };
  entities?: { type: string; offset: number; length: number }[];
  reply_to_message?: { from?: { id: number } };
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
interface BotIdentity {
  id: number;
  username: string;
  is_bot: boolean;
}
interface BotState {
  token: string;
  enabled: boolean;
  ownerId?: number;
  offset?: number;
}
export type TelegramCall = <T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>;
const invalid = (message: string): never => {
  throw Object.assign(new Error(message), { status: 400 });
};
const hash = (value: string) => createHash("sha256").update(value).digest();

// Only the official API is used. Never include the credential-bearing URL or response body in errors.
export const telegramCall: TelegramCall = async <T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
        : AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Telegram 連線失敗，請檢查網路後重試。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Telegram 回應格式錯誤。");
  }
  if (!response.ok || !data.ok) {
    const code = Number(data.error_code) || response.status;
    throw new Error(
      code === 401
        ? "Telegram Token 無效，請重新設定。"
        : code === 409
          ? "Bot 已被另一個程序或 webhook 使用，請先停用另一個連線。"
          : `Telegram API 暫時無法完成請求（${code}）。`,
    );
  }
  return data.result as T;
};

export function splitTelegramText(text: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const char of text) {
    if (chunk.length + char.length > 3900) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export class TelegramChannel {
  productMessage?: (text: string) => Promise<string>;
  async notifyOwner(text: string) {
    if (!this.state.enabled || !this.state.ownerId) return;
    for (const chunk of splitTelegramText(text))
      await this.call(this.state.token, "sendMessage", {
        chat_id: this.state.ownerId,
        text: chunk,
        link_preview_options: { is_disabled: true },
      });
  }
  file: string;
  call: TelegramCall;
  state: BotState = {
    token: "",
    enabled: false,
  };
  tail: Promise<unknown> = Promise.resolve();
  controlTail: Promise<unknown> = Promise.resolve();
  poll?: Promise<void>;
  controller?: AbortController;
  identity?: BotIdentity;
  status: TelegramView["status"] = "disabled";
  lastError = "";
  pairing?: { digest: Buffer; expires: number; attempts: number };
  constructor(directory: string, call: TelegramCall = telegramCall) {
    this.file = join(directory, "telegram.json");
    this.call = call;
  }
  async init() {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (
        typeof data.token !== "string" ||
        typeof data.enabled !== "boolean" ||
        (data.ownerId !== undefined && typeof data.ownerId !== "number")
      )
        throw new Error("Telegram 設定檔格式錯誤。");
      this.state = {
        token: data.token,
        enabled: data.enabled,
        ...(data.ownerId === undefined ? {} : { ownerId: data.ownerId }),
        ...(Number.isSafeInteger(data.offset) ? { offset: data.offset } : {}),
      };
    } catch (error) {
      if (asError(error).code !== "ENOENT") throw error;
    }
    return this;
  }
  private async mutate(fn: (state: BotState) => void) {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.state);
      fn(next);
      const temp = this.file + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temp, this.file);
        this.state = next;
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  view(): TelegramView {
    return {
      configured: !!this.state.token,
      enabled: this.state.enabled,
      ownerId: this.state.ownerId ? String(this.state.ownerId) : "",
      username: this.identity?.username || "",
      status: this.status,
      error: this.lastError,
      pairingExpiresAt: this.pairing
        ? new Date(this.pairing.expires).toISOString()
        : "",
    };
  }
  private control<T>(fn: () => Promise<T>) {
    const op = this.controlTail.then(fn);
    this.controlTail = op.catch(() => {});
    return op;
  }
  update(input: Record<string, unknown>) {
    return this.control(async () => {
      if (Object.keys(input).some((k) => !["token", "enabled"].includes(k)))
        invalid("不支援的 Telegram 設定。");
      if (typeof input.enabled !== "boolean") invalid("請確認 Bot 開關格式。");
      if (
        input.token !== undefined &&
        input.token !== "" &&
        input.token !== null &&
        (typeof input.token !== "string" ||
          !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(input.token))
      )
        invalid("Telegram Token 格式不正確。");
      const token =
        input.token === null
          ? ""
          : typeof input.token === "string" && input.token
            ? input.token
            : this.state.token;
      if (input.enabled && !token) invalid("請先填入 BotFather 提供的 Token。");
      await this.stop();
      await this.mutate((s) => {
        if (token !== s.token) {
          s.ownerId = undefined;
          s.offset = undefined;
        }
        if (input.enabled && !s.enabled) s.offset = undefined;
        s.token = token;
        s.enabled = input.enabled as boolean;
      });
      this.pairing = undefined;
      this.identity = undefined;
      this.lastError = "";
      this.start();
      return this.view();
    });
  }
  async testConnection() {
    if (!this.state.token) invalid("請先儲存 Token。");
    const token = this.state.token;
    const identity = await this.call<BotIdentity>(token, "getMe", {});
    const webhook = await this.call<{ url: string }>(
      token,
      "getWebhookInfo",
      {},
    );
    if (webhook.url)
      invalid("這個 Bot 已設定 webhook。請使用專用 Bot 或先停用原有 webhook。");
    if (token === this.state.token) this.identity = identity;
    return { username: identity.username };
  }
  createPairing() {
    if (!this.state.enabled || !this.state.token || this.status !== "connected")
      invalid("請先啟用 Bot，等待連線成功後再產生配對碼。");
    if (this.state.ownerId) invalid("已綁定帳號，請先解除綁定。");
    const code = randomBytes(16).toString("hex");
    this.pairing = {
      digest: hash(code),
      expires: Date.now() + 600000,
      attempts: 0,
    };
    return {
      command: "/pair " + code,
      expiresAt: new Date(this.pairing.expires).toISOString(),
    };
  }
  unpair() {
    return this.control(async () => {
      await this.stop();
      this.pairing = undefined;
      await this.mutate((s) => {
        s.ownerId = undefined;
        s.offset = undefined;
      });
      this.start();
      return this.view();
    });
  }
  start() {
    if (this.controller || !this.state.enabled || !this.state.token) return;
    const controller = new AbortController();
    this.controller = controller;
    this.status = "connecting";
    this.poll = this.loop(controller.signal).finally(() => {
      if (this.controller === controller) this.controller = undefined;
    });
  }
  async stop() {
    this.controller?.abort();
    await this.poll;
    this.controller = undefined;
    this.status = "disabled";
  }
  private async loop(signal: AbortSignal) {
    let backoff = 1000;
    while (!signal.aborted) {
      try {
        if (!this.identity) {
          this.identity = await this.call<BotIdentity>(
            this.state.token,
            "getMe",
            {},
            signal,
          );
          const webhook = await this.call<{ url: string }>(
            this.state.token,
            "getWebhookInfo",
            {},
            signal,
          );
          if (webhook.url)
            throw new Error(
              "此 Bot 已設定 webhook，請使用專用 Bot 或先停用原有 webhook。",
            );
        }
        // First enable/credential change discards earlier messages instead of executing stale commands.
        if (this.state.offset === undefined) {
          const last = await this.call<TelegramUpdate[]>(
            this.state.token,
            "getUpdates",
            { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message"] },
            signal,
          );
          await this.mutate((s) => {
            s.offset = last.length ? last.at(-1)!.update_id + 1 : 0;
          });
        }
        this.status = "connected";
        this.lastError = "";
        const updates = await this.call<TelegramUpdate[]>(
          this.state.token,
          "getUpdates",
          {
            offset: this.state.offset,
            limit: 20,
            timeout: 25,
            allowed_updates: ["message"],
          },
          signal,
        );
        for (const update of updates) {
          if (signal.aborted) break;
          await this.accept(update, signal);
        }
        backoff = 1000;
        // Avoid a hot loop if Telegram or a test transport immediately returns an empty batch.
        if (!updates.length) await delay(200, undefined, { signal });
      } catch (error) {
        if (signal.aborted) break;
        this.status = "error";
        this.lastError = this.safeError(error);
        this.identity = undefined;
        await delay(backoff, undefined, { signal }).catch(() => {});
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }
  private safeError(error: unknown) {
    return asError(error).message.replaceAll(
      this.state.token || "\0",
      "[redacted]",
    );
  }
  async accept(
    update: TelegramUpdate,
    signal = this.controller?.signal || new AbortController().signal,
  ) {
    if (
      !this.state.enabled ||
      signal.aborted ||
      !Number.isSafeInteger(update.update_id) ||
      update.update_id < (this.state.offset ?? 0)
    )
      return;
    // Acknowledge before acting so reconnects cannot replay an external action.
    await this.mutate((state) => {
      state.offset = update.update_id + 1;
    });
    const message = update.message;
    if (
      !message?.from ||
      message.from.is_bot ||
      message.sender_chat ||
      !message.text ||
      !this.identity ||
      message.chat.type !== "private" ||
      message.chat.id !== message.from.id
    )
      return;
    const text = message.text.trim();
    const command = text.match(/^\/(\w+)(?:@([\w]+))?(?:\s+([\s\S]*))?$/);
    if (
      command?.[2] &&
      command[2].toLowerCase() !== this.identity.username.toLowerCase()
    )
      return;
    if (command?.[1] === "pair" && !this.state.ownerId) {
      const pair = this.pairing;
      if (!pair || pair.expires < Date.now() || pair.attempts >= 10) return;
      pair.attempts++;
      if (!timingSafeEqual(hash(command[3] || ""), pair.digest)) return;
      this.pairing = undefined;
      await this.mutate((state) => {
        state.ownerId = message.from!.id;
      });
      await this.send(
        message,
        "已綁定 Apsis。使用 /bots 查看 Bot，再用 /bot ID 切換。",
        signal,
      );
      return;
    }
    if (message.from.id !== this.state.ownerId || !this.productMessage) return;
    try {
      await this.send(message, await this.productMessage(text), signal);
    } catch (error) {
      if (!signal.aborted)
        await this.send(message, this.safeError(error), signal);
    }
  }
  private async send(m: TelegramMessage, text: string, signal: AbortSignal) {
    for (const chunk of splitTelegramText(text || "任務完成。")) {
      signal.throwIfAborted();
      await this.call(
        this.state.token,
        "sendMessage",
        {
          chat_id: m.chat.id,
          text: chunk,
          link_preview_options: { is_disabled: true },
          ...(m.message_thread_id
            ? { message_thread_id: m.message_thread_id }
            : {}),
          reply_parameters: {
            message_id: m.message_id,
            allow_sending_without_reply: true,
          },
        },
        signal,
      );
    }
  }
}
