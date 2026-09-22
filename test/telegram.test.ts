import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../server/app.ts";
import {
  TelegramChannel,
  splitTelegramText,
  telegramCall,
  type TelegramCall,
  type TelegramUpdate,
} from "../server/telegram.ts";
import { buildContext } from "../server/context.ts";
import { createTools } from "../server/agent.ts";
import { Store } from "../server/store.ts";

const token = "123456789:abcdefghijklmnopqrstuvwxyz123456789";
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(t: TestContext, runner?: AppOptions["runner"]) {
  const directory = await mkdtemp(join(tmpdir(), "talaria-bot-"));
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const runs: Parameters<NonNullable<AppOptions["runner"]>>[0][] = [];
  const call: TelegramCall = async <T>(
    _token: string,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    calls.push({ method, params });
    if (method === "getMe")
      return { id: 99, username: "TalariaTestBot", is_bot: true } as T;
    if (method === "getWebhookInfo") return { url: "" } as T;
    if (method === "getUpdates") {
      if (params.offset === -1) return [] as T;
      return new Promise<T>((_resolve, reject) => {
        if (signal?.aborted) return reject(new Error("aborted"));
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    }
    return { message_id: 42 } as T;
  };
  const app = await createApp({
    dataDir: directory,
    workspaceDir: join(directory, "work"),
    env: {},
    telegramCall: call,
    runner: async (options) => {
      runs.push(options);
      if (runner) return runner(options);
      options.emit({ type: "delta", text: "已完成 " + options.prompt });
      return { text: "已完成 " + options.prompt };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(async () => {
    await app.telegram.stop();
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  });
  const base = "http://127.0.0.1:" + (app.server.address() as AddressInfo).port;
  const post = (path: string, data: unknown) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loom-Client": "1" },
      body: JSON.stringify(data),
    });
  let sequence = 1;
  const message = (
    text: string,
    user = 7,
    extra: Partial<NonNullable<TelegramUpdate["message"]>> = {},
  ): TelegramUpdate => ({
    update_id: sequence++,
    message: {
      message_id: sequence,
      text,
      from: { id: user },
      chat: { id: user, type: "private" },
      ...extra,
    },
  });
  const enable = async (groupId = "") => {
    assert.equal(
      (
        await post("channels/telegram", {
          token,
          enabled: true,
          allowWrites: false,
          groupId,
        })
      ).status,
      200,
    );
    await until(() => app.telegram.status === "connected");
  };
  const pair = async () => {
    const response = await post("channels/telegram/pairing", {});
    assert.equal(response.status, 200);
    const { command } = await response.json();
    await app.telegram.accept(message(command));
  };
  return { ...app, directory, base, post, calls, runs, message, enable, pair };
}

test("Telegram is opt-in, protects credentials and settings, pairs one owner and shares Web history", async (t) => {
  const app = await fixture(t);
  assert.equal(app.calls.length, 0);
  assert.equal(
    (
      await app.post("channels/telegram", {
        enabled: true,
        allowWrites: false,
        groupId: "",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(app.base + "/api/channels/telegram/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  await app.enable();
  assert.ok(
    !JSON.stringify(
      await (await fetch(app.base + "/api/channels/telegram")).json(),
    ).includes(token),
  );
  await app.telegram.accept(app.message("not paired"));
  assert.equal(app.runs.length, 0);
  await app.pair();
  assert.equal(app.telegram.view().ownerId, "7");
  await app.telegram.accept(app.message("stranger", 8));
  assert.equal(app.runs.length, 0);
  const update = app.message("hello");
  await app.telegram.accept(update);
  await Promise.all(app.telegram.jobs);
  await app.telegram.accept(update);
  assert.equal(app.runs.length, 1);
  assert.equal(app.runs[0].allowWrites, false);
  const sessions = await (await fetch(app.base + "/api/sessions")).json();
  assert.equal(sessions[0].source, "telegram");
  assert.equal(sessions[0].count, 2);
  const id = sessions[0].id;
  const webReply = await app.post("sessions/" + id + "/chat", {
    prompt: "continue from Web",
    allowWrites: false,
  });
  assert.match(await webReply.text(), /done/);
  await app.telegram.accept(app.message("continue from bot"));
  await Promise.all(app.telegram.jobs);
  assert.equal(app.runs.at(-1)!.session.messages.length, 4);
  assert.equal(app.store.state.sessions[0].messages.length, 6);
  await app.telegram.stop();
  const reopened = await new TelegramChannel(
    app.directory,
    app.tasks,
    app.telegram.call,
  ).init();
  assert.equal(reopened.view().ownerId, "7");
  assert.equal(reopened.state.bindings["7:0"], id);
  assert.ok(
    (await readFile(join(app.directory, "telegram.json"), "utf8")).includes(
      token,
    ),
  );
});

test("group replies require the paired sender, configured group and an explicit mention or reply", async (t) => {
  const app = await fixture(t);
  await app.enable("-100123");
  await app.pair();
  const group = {
    chat: { id: -100123, type: "supergroup" },
    entities: [{ type: "mention", offset: 0, length: 15 }],
  };
  await app.telegram.accept(app.message("@TalariaTestBot hello", 8, group));
  await app.telegram.accept(app.message("hello", 7, { chat: group.chat }));
  await app.telegram.accept(
    app.message("@TalariaTestBot hello", 7, {
      ...group,
      chat: { id: -999, type: "group" },
    }),
  );
  assert.equal(app.runs.length, 0);
  await app.telegram.accept(
    app.message("@TalariaTestBot hello", 7, {
      ...group,
      message_thread_id: 55,
    }),
  );
  await Promise.all(app.telegram.jobs);
  assert.equal(app.runs.length, 1);
  assert.equal(app.runs[0].prompt, "hello");
  assert.equal(
    app.calls.filter((c) => c.method === "sendMessage").at(-1)!.params
      .message_thread_id,
    55,
  );
  await app.telegram.accept(
    app.message("/resume@TalariaTestBot " + app.runs[0].session.id, 7, group),
  );
  assert.equal(app.runs.length, 1);
});

test("bot tasks expose live progress and can be stopped from Web or bot while polling continues", async (t) => {
  const app = await fixture(t, async ({ signal, emit }) => {
    emit({ type: "delta", text: "working" });
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      }),
    );
    return { text: "unreachable" };
  });
  await app.enable();
  await app.pair();
  await app.telegram.accept(app.message("slow task"));
  await until(() => app.runs.length === 1);
  const id = app.runs[0].session.id;
  const live = await (await fetch(app.base + "/api/sessions/" + id)).json();
  assert.equal(live.running, true);
  assert.equal(live.live.text, "working");
  assert.equal(
    (
      await app.post("sessions/" + id + "/chat", {
        prompt: "collision",
        allowWrites: false,
      })
    ).status,
    409,
  );
  await app.post("sessions/" + id + "/stop", {});
  await Promise.all(app.telegram.jobs);
  assert.equal(app.tasks.running.size, 0);
  assert.equal(app.store.state.sessions[0].messages.at(-1)!.status, "error");
  await app.telegram.accept(app.message("slow task again"));
  await until(() => app.runs.length === 2);
  await app.telegram.accept(app.message("/stop"));
  await Promise.all(app.telegram.jobs);
  assert.equal(app.tasks.running.size, 0);
  await app.telegram.accept(app.message("third"));
  await until(() => app.runs.length === 3);
  const sentBefore = app.calls.filter((c) => c.method === "sendMessage").length;
  await app.telegram.update({
    enabled: false,
    allowWrites: false,
    groupId: "",
  });
  assert.equal(
    app.calls.filter((c) => c.method === "sendMessage").length,
    sentBefore,
  );
});

test("resume/new, pairing expiry, revocation and credential rotation retain owner control", async (t) => {
  const app = await fixture(t);
  await app.enable();
  const expired = app.telegram.createPairing();
  app.telegram.pairing!.expires = 0;
  await app.telegram.accept(app.message(expired.command));
  assert.equal(app.telegram.view().ownerId, "");
  await app.pair();
  const web = await app.tasks.create("pi");
  await app.telegram.accept(app.message("/resume " + web.id));
  await app.telegram.accept(app.message("resumed"));
  await Promise.all(app.telegram.jobs);
  assert.equal(app.runs[0].session.id, web.id);
  await app.telegram.accept(app.message("/new"));
  assert.notEqual(app.telegram.state.bindings["7:0"], web.id);
  await app.telegram.unpair();
  await until(() => app.telegram.status === "connected");
  await app.telegram.accept(app.message("old owner"));
  assert.equal(app.runs.length, 1);
  await app.pair();
  await app.telegram.update({
    token: "987654321:abcdefghijklmnopqrstuvwxyz123456789",
    enabled: false,
    allowWrites: false,
    groupId: "",
  });
  assert.equal(app.telegram.view().ownerId, "");
  assert.deepEqual(app.telegram.state.bindings, {});
});

test("Hermes-inspired context loads full skills on demand and history search uses saved completed messages", async (t) => {
  const app = await fixture(t);
  const full = "A very specific full procedure " + "step details ".repeat(100);
  await app.store.mutate((s) => {
    s.skills.push({ id: "fixture", name: "Procedure", content: full });
    s.memories.push({ id: "fact", content: "Node only" });
  });
  const prompt = buildContext(app.store.state, false);
  assert.ok(prompt.includes("Procedure"));
  assert.ok(!prompt.includes(full));
  const tools = createTools({
    store: app.store,
    workspace: app.workspace,
    allowWrites: false,
  });
  const read = await tools
    .find((t) => t.name === "read_skill")!
    .execute("call", { id: "fixture" });
  assert.ok(JSON.stringify(read).includes(full));
  await assert.rejects(
    tools
      .find((t) => t.name === "update_memory")!
      .execute("call", { id: "fact", content: "new" }),
    /允許修改/,
  );
  const session = await app.tasks.create("demo");
  await app.tasks.run(session.id, "history needle", false);
  const history = await tools
    .find((t) => t.name === "search_history")!
    .execute("call", { query: "needle" });
  assert.ok(JSON.stringify(history).includes(session.id));
});

test("interrupted persisted tasks are marked failed on restart; long Telegram replies preserve Unicode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-recovery-"));
  const store = await new Store(dir).init();
  await store.mutate((s) =>
    s.sessions.push({
      id: "interrupted",
      title: "task",
      mode: "pi",
      createdAt: "",
      piMessages: [],
      messages: [{ id: "u", role: "user", content: "task", status: "pending" }],
    }),
  );
  const reopened = await new Store(dir).init();
  assert.equal(reopened.state.sessions[0].messages[0].status, "failed");
  assert.match(reopened.state.sessions[0].messages[1].content, /中斷/);
  const text = "😀中文\n".repeat(2000);
  const parts = splitTelegramText(text);
  assert.equal(parts.join(""), text);
  assert.ok(
    parts.every(
      (p) => p.length <= 3900 && Buffer.from(p).toString("utf8") === p,
    ),
  );
});

test("long polling retries transient errors, redacts credentials and consumes duplicated updates once", async (t) => {
  const app = await fixture(t);
  await app.enable();
  await app.pair();
  await app.telegram.stop();
  const original = app.telegram.call;
  let polls = 0;
  const update = app.message("through long polling");
  app.telegram.call = async <T>(
    key: string,
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (method === "getUpdates") {
      if (polls++ === 0) throw new Error("temporary network issue " + token);
      if (polls === 2) return [update, update] as T;
    }
    return original<T>(key, method, params, signal);
  };
  app.telegram.start();
  await until(() => app.telegram.status === "error");
  assert.ok(!app.telegram.view().error.includes(token));
  await until(() => app.runs.length === 1);
  await Promise.all(app.telegram.jobs);
  assert.equal(app.telegram.state.offset, update.update_id + 1);
  assert.equal(app.runs.length, 1);
  assert.ok(
    app.calls.some(
      (c) =>
        c.method === "sendMessage" &&
        String(c.params.text).includes("through long polling"),
    ),
  );
});

test("Telegram transport uses official JSON API and never leaks error bodies or token URLs", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string, init: RequestInit) => {
      assert.equal(input, "https://api.telegram.org/bot" + token + "/getMe");
      assert.equal(init.method, "POST");
      assert.equal(init.body, "{}");
      if (calls++ === 0) return Response.json({ ok: true, result: { id: 99 } });
      if (calls === 2)
        return Response.json(
          { ok: false, error_code: 401, description: "secret " + token },
          { status: 401 },
        );
      throw new Error("fetch error at " + input);
    },
  );
  assert.deepEqual(await telegramCall(token, "getMe", {}), { id: 99 });
  await assert.rejects(
    telegramCall(token, "getMe", {}),
    (error) =>
      error instanceof Error &&
      /Token 無效/.test(error.message) &&
      !error.message.includes(token),
  );
  await assert.rejects(
    telegramCall(token, "getMe", {}),
    (error) =>
      error instanceof Error &&
      /連線失敗/.test(error.message) &&
      !error.message.includes(token),
  );
});
