import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ProductDB } from "../server/product-db.ts";
import { AvatarCollectionService } from "../server/avatar-collection.ts";
import type { Artifact, Job } from "../shared/product.ts";
import { botAvatars, avatarDrawCost } from "../shared/bot-avatars.ts";

const collectibleCount = botAvatars.filter((a) => a.series !== "basic").length;

async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "apsis-collection-"));
  const db = await new ProductDB().init(dir);
  t.after(() => db.db.close());
  const collection = new AvatarCollectionService(db);
  collection.init();
  const job = (input: Partial<Job> = {}): Job => ({
    id: randomUUID(),
    botId: "bot-a",
    prompt: "work",
    createdAt: new Date().toISOString(),
    status: "completed",
    contextKind: "chat",
    avatarRewardsEligible: true,
    ...input,
  });
  const artifact = (runId: string, kind: Artifact["kind"] = "result") =>
    db.put<Artifact>("artifact", {
      id: randomUUID(),
      botId: "bot-a",
      runId,
      name: "output",
      path: "output.md",
      mime: "text/markdown",
      createdAt: new Date().toISOString(),
      kind,
    });
  return { db, dir, collection, job, artifact };
}

test("collection starts empty and rewards only eligible successful work once across Bots", async (t) => {
  const f = await fixture(t);
  assert.equal(f.collection.view().balance, 0);
  assert.equal(f.collection.view().owned.length, 6);
  assert.equal(f.collection.view().remaining, collectibleCount);
  for (const status of [
    "failed",
    "cancelled",
    "interrupted",
    "queued",
    "running",
  ] as const)
    f.collection.finish(f.job({ status }));
  f.collection.finish(f.job({ createdAt: "2000-01-01T00:00:00.000Z" }));
  // A legacy job from the very same millisecond must not be credited either.
  f.collection.finish(
    f.job({
      avatarRewardsEligible: undefined,
      createdAt: f.collection.view().startedAt,
    }),
  );
  assert.equal(f.collection.view().balance, 0);
  const first = f.job();
  f.collection.finish(first);
  f.collection.finish(first);
  f.collection.finish(f.job({ botId: "bot-b" }));
  assert.equal(f.collection.view().balance, 20);
  assert.equal(f.db.all("avatar-reward").length, 2);
});

test("successful main jobs earn a flat 10 points regardless of schedules or files; delegated jobs earn zero", async (t) => {
  const f = await fixture(t);
  f.artifact("uploaded", "attachment");
  f.collection.finish(f.job({ runId: "uploaded" }));
  assert.equal(f.collection.view().balance, 10);
  f.artifact("failed");
  f.collection.finish(f.job({ runId: "failed", status: "failed" }));
  assert.equal(f.collection.view().achievements.delivery, undefined);
  f.artifact("routine-result");
  f.collection.finish(
    f.job({ runId: "routine-result", contextKind: "routine" }),
  );
  assert.equal(f.collection.view().balance, 20);
  f.collection.finish(f.job({ contextKind: "routine" }));
  assert.equal(f.collection.view().balance, 30);
  f.collection.finish(
    f.job({ contextKind: "delegation", delegatedBy: "bot-b" }),
  );
  assert.equal(f.collection.view().balance, 30);
  f.collection.finish(
    f.job({ contextKind: "delegation", delegatedBy: "bot-b" }),
  );
  assert.equal(f.collection.view().balance, 30);
  // Every delegation marker suppresses points, even if a legacy job has no contextKind.
  f.collection.finish(f.job({ parentJobId: "parent", contextKind: "chat" }));
  f.collection.finish(f.job({ delegatedBy: "bot-b", contextKind: "chat" }));
  assert.equal(f.collection.view().balance, 30);
  assert.deepEqual(f.collection.view().achievements, {});
});

test("30 points per draw, no duplicates, retry is idempotent even after collection completion", async (t) => {
  const f = await fixture(t);
  assert.throws(() => f.collection.draw("invalid"), /識別碼/);
  assert.throws(() => f.collection.draw(randomUUID()), /點數不足/);
  assert.throws(() => f.collection.requireOwned("captain"), /尚未擁有/);
  assert.throws(() => f.collection.requireOwned("unknown"), /有效/);
  assert.equal(f.collection.requireOwned("cloud"), "cloud");
  const budget = collectibleCount * avatarDrawCost;
  for (let i = 0; i < budget / 10; i++) f.collection.finish(f.job());
  const drawn = new Set();
  const firstId = randomUUID();
  const first = f.collection.draw(firstId);
  drawn.add(first.draw.avatarId);
  assert.equal(first.avatarCollection.balance, budget - avatarDrawCost);
  assert.equal(
    f.collection.requireOwned(first.draw.avatarId),
    first.draw.avatarId,
  );
  assert.deepEqual(f.collection.draw(firstId).draw, first.draw);
  assert.equal(f.collection.view().balance, budget - avatarDrawCost);
  for (let i = 1; i < collectibleCount; i++)
    drawn.add(f.collection.draw(randomUUID()).draw.avatarId);
  assert.equal(drawn.size, collectibleCount);
  assert.deepEqual(
    drawn,
    new Set(botAvatars.filter((a) => a.series !== "basic").map((a) => a.id)),
  );
  assert.equal(f.collection.view().balance, 0);
  assert.equal(f.collection.view().remaining, 0);
  assert.deepEqual(f.collection.draw(firstId).draw, first.draw);
  assert.throws(() => f.collection.draw(randomUUID()), /全部收藏/);
  f.collection.finish(f.job());
  assert.equal(f.collection.view().balance, 10);
});

test("rewards and draws roll back completely if persistence fails", async (t) => {
  const f = await fixture(t);
  const work = f.job({ status: "running" });
  f.db.put("job", work);
  const put = f.db.put.bind(f.db);
  f.db.put = (kind, value) => {
    if (kind === "avatar-collection") throw new Error("simulated disk failure");
    return put(kind, value);
  };
  assert.throws(
    () => f.collection.finish({ ...work, status: "completed" }),
    /disk failure/,
  );
  assert.equal(f.db.get<Job>("job", work.id)?.status, "running");
  assert.equal(f.db.all("avatar-reward").length, 0);
  f.db.put = put;
  for (let i = 0; i < 3; i++) f.collection.finish(f.job());
  const before = f.collection.view();
  f.db.put = (kind, value) => {
    if (kind === "avatar-collection") throw new Error("simulated disk failure");
    return put(kind, value);
  };
  const id = randomUUID();
  assert.throws(() => f.collection.draw(id), /disk failure/);
  assert.deepEqual(f.collection.view(), before);
  assert.equal(f.db.get("avatar-draw", id), undefined);
  f.db.put = put;
  assert.equal(f.collection.draw(id).avatarCollection.balance, 0);
});

test("new series extend an existing completed collection without resetting its wallet or history", async (t) => {
  const f = await fixture(t);
  const startedAt = f.collection.view().startedAt;
  const legacyAvatars = botAvatars.filter(
    (a) => a.series === "voyage" || a.series === "magic",
  );
  const lastDraw = {
    id: randomUUID(),
    avatarId: "elf" as const,
    createdAt: startedAt,
    balanceAfter: 60,
  };
  f.db.put("avatar-draw", lastDraw);
  f.db.put("avatar-collection", {
    id: "global",
    startedAt,
    revision: 20,
    balance: 60,
    acquired: Object.fromEntries(legacyAvatars.map((a) => [a.id, startedAt])),
    achievements: { delivery: startedAt },
    lastDraw,
  });
  f.collection.init();
  const before = f.collection.view();
  assert.equal(before.startedAt, startedAt);
  assert.equal(before.balance, 60);
  assert.equal(before.owned.length, 18);
  assert.equal(before.remaining, collectibleCount - legacyAvatars.length);
  assert.equal(before.achievements.delivery, startedAt);
  assert.deepEqual(f.collection.draw(lastDraw.id).draw, lastDraw);
  const result = f.collection.draw(randomUUID());
  assert.ok(!legacyAvatars.some((a) => a.id === result.draw.avatarId));
  assert.equal(result.avatarCollection.balance, 30);
  assert.equal(result.avatarCollection.owned.length, 19);
});

test("collection survives deleted source jobs and reopening the database", async (t) => {
  const f = await fixture(t);
  const jobs = Array.from({ length: 4 }, () => f.job());
  jobs.forEach((j) => f.collection.finish(j));
  const requestId = randomUUID();
  const draw = f.collection.draw(requestId);
  jobs.forEach((j) => f.db.remove("job", j.id));
  const before = f.collection.view();
  const reopened = await new ProductDB().init(f.dir);
  t.after(() => reopened.db.close());
  const collection = new AvatarCollectionService(reopened);
  collection.init();
  assert.deepEqual(collection.view(), before);
  assert.deepEqual(collection.draw(requestId).draw, draw.draw);
  collection.finish(jobs[0]);
  assert.equal(collection.view().balance, 10);
});

test("simplified rewards retain historical bonuses and never re-credit their jobs", async (t) => {
  const f = await fixture(t);
  const previous = f.job({ contextKind: "routine" });
  const at = f.collection.view().startedAt;
  const receipt = {
    id: previous.id,
    points: 30,
    achievements: ["routine"],
    createdAt: at,
  };
  f.db.put("avatar-reward", receipt);
  f.db.put("avatar-collection", {
    id: "global",
    startedAt: at,
    revision: 1,
    balance: 30,
    acquired: { captain: at },
    achievements: { routine: at },
  });
  f.collection.init();
  f.collection.finish(previous);
  assert.equal(f.collection.view().balance, 30);
  assert.deepEqual(f.db.get("avatar-reward", previous.id), receipt);
  assert.equal(f.collection.requireOwned("captain"), "captain");
  f.collection.finish(f.job({ contextKind: "routine" }));
  assert.equal(f.collection.view().balance, 40);
  assert.deepEqual(f.collection.view().achievements, { routine: at });
});
