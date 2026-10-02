import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProductDB } from "../server/product-db.ts";
import { botAvatars } from "../shared/bot-avatars.ts";

async function legacyStore() {
  const directory = await mkdtemp(join(tmpdir(), "apsis-avatar-retirement-"));
  const db = await new ProductDB().init(directory);
  for (const kind of ["avatar-collection", "avatar-reward", "avatar-draw"])
    db.put(kind, {
      id: kind,
      balance: 30,
      acquired: { captain: "2026-01-01" },
    });
  for (const avatar of botAvatars) {
    db.put("bot", {
      id: avatar.id,
      avatar: avatar.id,
      sessionId: "session-" + avatar.id,
    });
    db.put("template", {
      id: avatar.id,
      avatar: avatar.id,
      name: avatar.label,
    });
  }
  const job = {
    id: "existing-job",
    botId: "captain",
    avatar: "captain",
    prompt: "Keep existing work",
    status: "completed",
    runId: "existing-run",
    result: "Existing result",
    avatarRewardsEligible: true,
  };
  db.put("job", job);
  db.put("artifact", {
    id: "existing-artifact",
    botId: "captain",
    path: "results/original.pdf",
    snapshotPath: "immutable-original.pdf",
  });
  db.put("connection", { id: "existing-connection", model: "existing-model" });
  const records = db.db
    .prepare("SELECT kind,id,value FROM records ORDER BY kind,id")
    .all();
  db.db.close();
  return { directory, job, records };
}

test("opening the product store does not delete prior records; all 48 avatar designs remain available", async (t) => {
  const legacy = await legacyStore();
  const db = await new ProductDB().init(legacy.directory);
  t.after(() => db.db.close());
  assert.equal(botAvatars.length, 48);
  assert.deepEqual(
    db.db.prepare("SELECT kind,id,value FROM records ORDER BY kind,id").all(),
    legacy.records,
  );
});
