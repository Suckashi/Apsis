import test from "node:test";
import assert from "node:assert/strict";
import { RunSlots } from "../server/run-slots.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const abortError = { name: "AbortError" };

test("forgetRoot refuses live roots, including suspended jobs, and resets only explicit idle roots", async () => {
  const slots = new RunSlots();
  assert.equal(slots.forgetRoot("missing"), false);
  await slots.acquire("parent", "root", 1);
  assert.equal(slots.forgetRoot("root"), false);
  const resume = slots.suspend("parent");
  assert.equal(slots.forgetRoot("root"), false);
  await slots.acquire("child", "root", 1);
  const resumed = resume();
  assert.equal(slots.forgetRoot("root"), false);
  slots.release("child");
  await resumed;
  slots.release("parent");
  assert.equal(slots.forgetRoot("root"), true);
  assert.equal(slots.forgetRoot("root"), false);
  await slots.acquire("a", "root", 2);
  await slots.acquire("b", "root", 2);
  slots.close();
});

test("isSuspended covers nested waits and queued resumes but not initial acquisition", async () => {
  const slots = new RunSlots();
  assert.equal(slots.isSuspended("missing"), false);
  await slots.acquire("parent", "root", 1);
  assert.equal(slots.isSuspended("parent"), false);
  const child = slots.acquire("child", "root", 1);
  assert.equal(slots.isSuspended("child"), false);
  const first = slots.suspend("parent");
  const second = slots.suspend("parent");
  await child;
  assert.equal(slots.isSuspended("parent"), true);
  await first();
  assert.equal(slots.isSuspended("parent"), true);
  const pending = second();
  assert.equal(slots.isSuspended("parent"), true);
  slots.release("child");
  await pending;
  assert.equal(slots.isSuspended("parent"), false);
  slots.suspend("parent");
  slots.release("parent");
  assert.equal(slots.isSuspended("parent"), false);
  slots.close();
});

test("bounds each root independently and grants queued jobs FIFO", async () => {
  const slots = new RunSlots();
  await slots.acquire("a", "root", 2);
  await slots.acquire("b", "root", 2);
  const order: string[] = [];
  const c = slots.acquire("c", "root", 2).then(() => order.push("c"));
  const d = slots.acquire("d", "root", 2).then(() => order.push("d"));
  await slots.acquire("other", "other-root", 1);
  await tick();
  assert.deepEqual(order, []);
  slots.release("a");
  await c;
  assert.deepEqual(order, ["c"]);
  slots.release("b");
  await d;
  assert.deepEqual(order, ["c", "d"]);
  slots.close();
});

test("root limit stays fixed across conflicting limits and idle periods", async () => {
  const slots = new RunSlots();
  await slots.acquire("a", "root", 1);
  slots.release("a");
  await slots.acquire("b", "root", 10);
  let acquired = false;
  const c = slots.acquire("c", "root", 10).then(() => (acquired = true));
  await tick();
  assert.equal(acquired, false);
  slots.release("b");
  await c;
  slots.close();
});

test("limit-one parent yields to child and approval waits without deadlock", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const child = slots.acquire("child", "root", 1);
  const resumeParent = slots.suspend("parent");
  await child;
  const resumeChild = slots.suspend("child");
  await slots.acquire("sibling", "root", 1);
  const resumedChild = resumeChild();
  slots.release("sibling");
  await resumedChild;
  slots.release("child");
  await resumeParent();
  slots.release("parent");
});

test("nested concurrent suspension resumes once and only after the final resume", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const first = slots.suspend("parent");
  const second = slots.suspend("parent");
  await first();
  assert.equal(first(), first());
  await slots.acquire("child", "root", 1);
  let resumed = false;
  const pending = second().then(() => (resumed = true));
  assert.equal(second(), second());
  await tick();
  assert.equal(resumed, false);
  slots.release("child");
  await pending;
  slots.close();
});

test("resuming parents share FIFO with new jobs", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const resume = slots.suspend("parent");
  await slots.acquire("child", "root", 1);
  const order: string[] = [];
  const before = slots
    .acquire("before", "root", 1)
    .then(() => order.push("before"));
  const parent = resume().then(() => order.push("parent"));
  const after = slots
    .acquire("after", "root", 1)
    .then(() => order.push("after"));
  slots.release("child");
  await before;
  assert.deepEqual(order, ["before"]);
  slots.release("before");
  await parent;
  assert.deepEqual(order, ["before", "parent"]);
  slots.release("parent");
  await after;
  assert.deepEqual(order, ["before", "parent", "after"]);
  slots.close();
});

test("new suspension withdraws a queued resume until the new final resume", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const first = slots.suspend("parent");
  await slots.acquire("child", "root", 1);
  const oldResume = first();
  const second = slots.suspend("parent");
  await oldResume;
  slots.release("child");
  await slots.acquire("other", "root", 1);
  const pending = second();
  slots.release("other");
  await pending;
  slots.close();
});

test("pre-aborted and queued aborts preserve FIFO and leak no slots", async () => {
  const slots = new RunSlots();
  const reason = new Error("cancelled by caller");
  await assert.rejects(
    slots.acquire("pre", "root", 99, AbortSignal.abort(reason)),
    reason,
  );
  await slots.acquire("holder", "root", 1);
  const head = new AbortController();
  const middle = new AbortController();
  const a = assert.rejects(slots.acquire("a", "root", 1, head.signal), reason);
  const b = assert.rejects(
    slots.acquire("b", "root", 1, middle.signal),
    abortError,
  );
  const tail = slots.acquire("tail", "root", 1);
  middle.abort();
  head.abort(reason);
  await Promise.all([a, b]);
  slots.release("holder");
  await tail;
  slots.release("tail");
  await slots.acquire("a", "root", 1);
  slots.close();
});

test("abort after grant retains capacity until release", async () => {
  const slots = new RunSlots();
  const controller = new AbortController();
  const granted = slots.acquire("a", "root", 1, controller.signal);
  controller.abort();
  await granted;
  let acquired = false;
  const next = slots.acquire("b", "root", 1).then(() => (acquired = true));
  await tick();
  assert.equal(acquired, false);
  slots.release("a");
  await next;
  slots.close();
});

test("original signal cancels both suspended and queued resumes", async () => {
  for (const abortBeforeResume of [true, false]) {
    const slots = new RunSlots();
    const controller = new AbortController();
    await slots.acquire("parent", "root", 1, controller.signal);
    const resume = slots.suspend("parent");
    await slots.acquire("child", "root", 1);
    if (abortBeforeResume) controller.abort();
    const rejected = assert.rejects(resume(), abortError);
    if (!abortBeforeResume) controller.abort();
    await rejected;
    slots.release("child");
    await slots.acquire("parent", "root", 1);
    slots.close();
  }
});

test("release cancels waits and stale resumes cannot affect reused IDs", async () => {
  const slots = new RunSlots();
  await slots.acquire("parent", "root", 1);
  const stale = slots.suspend("parent");
  slots.release("parent");
  slots.release("parent");
  await slots.acquire("parent", "root", 1);
  await stale();
  const queued = assert.rejects(slots.acquire("queued", "root", 1), abortError);
  slots.release("queued");
  await queued;
  const resume = slots.suspend("parent");
  await slots.acquire("child", "root", 1);
  const pending = assert.rejects(resume(), abortError);
  slots.release("parent");
  await pending;
  slots.close();
});

test("close rejects all waits without granting any, and invalidates suspended jobs", async () => {
  const slots = new RunSlots();
  await slots.acquire("suspended", "root", 1);
  const stale = slots.suspend("suspended");
  await slots.acquire("resuming", "root", 1);
  const resume = slots.suspend("resuming");
  await slots.acquire("holder", "root", 1);
  const waits = [
    assert.rejects(resume(), abortError),
    assert.rejects(slots.acquire("a", "root", 1), abortError),
    assert.rejects(slots.acquire("b", "root", 1), abortError),
  ];
  slots.close();
  slots.close();
  await Promise.all(waits);
  await stale();
  slots.release("holder");
  await assert.rejects(slots.acquire("new", "root", 1), abortError);
});

test("invalid limits, duplicate jobs, and suspension before acquisition reject", async () => {
  const slots = new RunSlots();
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(slots.acquire("bad", "root", limit), RangeError);
  await slots.acquire("a", "root", 1);
  await assert.rejects(slots.acquire("a", "other", 1), /already registered/);
  assert.throws(() => slots.suspend("missing"), /has not acquired/);
  const queued = assert.rejects(slots.acquire("queued", "root", 1), abortError);
  assert.throws(() => slots.suspend("queued"), /has not acquired/);
  slots.close();
  await queued;
});
