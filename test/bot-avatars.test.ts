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

test("retirement removes only economy data and preserves all 48 Bot/template identities and job evidence", async (t) => {
  const legacy = await legacyStore();
  const db = await new ProductDB().init(legacy.directory);
  t.after(() => db.db.close());
  for (const kind of ["avatar-collection", "avatar-reward", "avatar-draw"])
    assert.deepEqual(db.all(kind), []);
  for (const avatar of botAvatars) {
    assert.equal(db.bots.get(avatar.id)?.avatar, avatar.id);
    assert.equal(db.templates.get(avatar.id)?.avatar, avatar.id);
  }
  const { avatarRewardsEligible: _retired, ...job } = legacy.job;
  assert.deepEqual(db.jobs.get(job.id), job);
  const unchanged = legacy.records.filter(
    (row) => !String(row.kind).startsWith("avatar-") && row.kind !== "job",
  );
  assert.deepEqual(
    db.db
      .prepare(
        "SELECT kind,id,value FROM records WHERE kind<>'job' ORDER BY kind,id",
      )
      .all(),
    unchanged,
  );
});

test("failed retirement rolls back all deletions and leaves the original evidence recoverable", async () => {
  const legacy = await legacyStore();
  const raw = new DatabaseSync(join(legacy.directory, "product.sqlite"));
  raw.exec(
    "CREATE TRIGGER reject_migration BEFORE UPDATE OF value ON records WHEN OLD.kind='job' BEGIN SELECT RAISE(ABORT,'migration-test'); END;",
  );
  raw.close();
  await assert.rejects(
    () => new ProductDB().init(legacy.directory),
    /migration-test/,
  );
  const recovered = new DatabaseSync(join(legacy.directory, "product.sqlite"));
  try {
    assert.deepEqual(
      recovered
        .prepare("SELECT kind,id,value FROM records ORDER BY kind,id")
        .all(),
      legacy.records,
    );
    recovered.exec("DROP TRIGGER reject_migration");
  } finally {
    recovered.close();
  }
  const retried = await new ProductDB().init(legacy.directory);
  try {
    assert.deepEqual(retried.all("avatar-collection"), []);
  } finally {
    retried.db.close();
  }
});

test("retirement is idempotent and does not recreate rewards or change stored avatars on another startup", async () => {
  const legacy = await legacyStore();
  const first = await new ProductDB().init(legacy.directory);
  const records = first.db
    .prepare("SELECT kind,id,value FROM records ORDER BY kind,id")
    .all();
  first.db.close();
  const next = await new ProductDB().init(legacy.directory);
  try {
    assert.deepEqual(
      next.db
        .prepare("SELECT kind,id,value FROM records ORDER BY kind,id")
        .all(),
      records,
    );
  } finally {
    next.db.close();
  }
});
