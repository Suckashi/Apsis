import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TelegramChannel, type TelegramCall } from "../server/telegram.ts";

test("paired Telegram private messages reach the Bot product handler", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-telegram-"));
  const sent: string[] = [];
  const call: TelegramCall = async (_token, method, params) => {
    if (method === "getMe")
      return { id: 99, username: "apsis_test_bot", is_bot: true } as never;
    if (method === "getWebhookInfo") return { url: "" } as never;
    if (method === "getUpdates") return [] as never;
    if (method === "sendMessage") {
      sent.push(String(params.text));
      return { message_id: sent.length } as never;
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  };
  const channel = await new TelegramChannel(directory, call).init();
  t.after(() => channel.stop());
  channel.productMessage = async (message) => `Bot received: ${message}`;
  await channel.update({
    token: "12345:abcdefghijklmnopqrstuvwxyz",
    enabled: true,
  });
  const deadline = Date.now() + 2000;
  while (channel.status !== "connected" && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(channel.status, "connected");
  const pairing = channel.createPairing();
  const message = (update_id: number, text: string) => ({
    update_id,
    message: {
      message_id: update_id,
      text,
      from: { id: 123 },
      chat: { id: 123, type: "private" },
    },
  });
  await channel.accept(message(1, pairing.command));
  await channel.accept(message(2, "/bots"));
  assert.equal(channel.view().ownerId, "123");
  assert.match(sent.at(-1) || "", /Bot received: \/bots/);
});
