import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../server/app.ts";
import { agentContext } from "../server/context.ts";

import type { Job } from "../shared/product.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "apsis-coding-prompt-"));
  const app = await createApp({
    dataDir: join(directory, "data"),
    workspaceDir: join(directory, "work"),
    runner: async () => {
      throw new Error("Prompt contract test must never invoke a runner");
    },
  });
  clearInterval(app.product.timer);
  const bot = await app.product.create("Builder");
  const session = app.tasks.store.state.sessions.find(
    (s) => s.id === bot.sessionId,
  )!;
  const prompt = "只在本地實作和驗證，不要 push 或 PR";
  app.product.db.put<Job>("job", {
    id: randomUUID(),
    botId: bot.id,
    prompt,
    createdAt: new Date().toISOString(),
    status: "running",
    runId: "fixture-run",
  });
  return {
    ...app,
    prompt() {
      const extension = app.tasks.extensions!(session, "fixture-run");
      return agentContext(
        app.tasks.store,
        true,
        session.agent,
        prompt,
        undefined,
        extension.executionContext,
      );
    },
    async close() {
      await app.product.close();
      app.product.db.db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("all chat work keeps publication scoped and supports planning without another task", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const prompt = f.prompt();
  assert.match(prompt, /requires explicit user authorization/);
  assert.match(prompt, /Work directly in this conversation/);
  assert.match(prompt, /return a plan and wait/);
  assert.doesNotMatch(prompt, /create_coding_task/);
});
