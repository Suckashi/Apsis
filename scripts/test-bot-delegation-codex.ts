import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.ts";
import type { Job } from "../shared/product.ts";

// Opt-in live test. Uses isolated Bot data and the current local ChatGPT sign-in.
const directory = await mkdtemp(join(tmpdir(), "apsis-delegation-codex-"));
const app = await createApp({
  dataDir: join(directory, "data"),
  workspaceDir: join(directory, "work"),
});
try {
  await new Promise<void>((resolve) =>
    app.server.listen(0, "127.0.0.1", resolve),
  );
  const status = await app.codex.inspect();
  assert.equal(status.connected, true, "請先在 Apsis 設定中登入 ChatGPT。 ");
  const model =
    process.env.CODEX_TEST_MODEL ||
    status.models.find((m: { id: string }) => m.id === "gpt-5.6-sol")?.id ||
    status.models[0]?.id;
  assert.ok(model, "Codex 沒有可用模型。");
  const connection = await app.connections.save({
    name: "Live ChatGPT Codex",
    provider: "codex",
    model,
  });
  await app.connections.setDefault({ connectionId: connection.id, model });
  const worker = await app.product.create("計算助理", {
    description: "完成交辦的簡單算術並回報數字。",
  });
  const secretary = await app.product.create("秘書", {
    description:
      "使用 list_bots 尋找計算助理，再用 delegate_task 派工，收到結果後回覆使用者。",
  });
  const job = await app.product.submit(secretary.id, {
    requestId: "live-secretary",
    prompt: "請找計算助理，派他計算 17 乘以 19，拿到實際結果後告訴我答案。",
  });
  const deadline = Date.now() + 300000;
  while (app.product.active.size && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(app.product.active.size, 0, "Codex delegation timed out");
  const parent = app.product.db.get<Job>("job", job.id)!;
  const child = app.product.db
    .all<Job>("job")
    .find((j) => j.parentJobId === job.id && j.botId === worker.id);
  const operations =
    app.tasks.runs.records.get(parent.runId || "")?.operations || [];
  assert.ok(
    operations.some((o) => o.name === "list_bots" && o.status === "succeeded"),
    JSON.stringify({ parent, operations }),
  );
  assert.ok(
    operations.some(
      (o) => o.name === "delegate_task" && o.status === "succeeded",
    ),
    JSON.stringify({ parent, operations }),
  );
  assert.equal(child?.status, "completed", JSON.stringify({ parent, child }));
  assert.match(child!.result || "", /323/);
  assert.equal(parent.status, "completed");
  assert.match(parent.result || "", /323/);
  console.log(
    JSON.stringify(
      {
        model,
        delegated: true,
        childResult: child!.result,
        secretaryReply: parent.result,
      },
      null,
      2,
    ),
  );
} finally {
  for (const bot of app.product.snapshot().bots) app.tasks.stop(bot.sessionId);
  await app.product.close();
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
}
