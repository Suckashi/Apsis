import assert from "node:assert/strict";
import test from "node:test";
import {
  retryModel,
  retryableModelError,
  retryDelay,
} from "../server/model-retry.ts";

test("model retries are bounded, announced, and honor Retry-After", async () => {
  let calls = 0;
  const attempts: number[] = [];
  await assert.rejects(
    retryModel(
      async () => {
        calls++;
        throw { status: 503 };
      },
      {
        signal: new AbortController().signal,
        outputVersion: () => 0,
        onRetry: async (attempt) => {
          attempts.push(attempt);
        },
        wait: async () => {},
      },
    ),
  );
  assert.equal(calls, 4);
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(
    retryDelay({ headers: new Headers({ "retry-after": "2" }) }, 1),
    2000,
  );
  assert.equal(retryDelay({ headers: { "retry-after": "300" } }, 1), 30000);
  for (const error of [
    { status: 401 },
    { status: 403 },
    { status: 400 },
    new Error("invalid path"),
    { message: "fetch failed", cause: { code: "EACCES" } },
  ])
    assert.equal(retryableModelError(error), false);
});

test("partial model streams and cancellation are never retried", async () => {
  let version = 0,
    attempts = 0;
  await assert.rejects(
    retryModel(
      async () => {
        version++;
        throw { status: 503 };
      },
      {
        signal: new AbortController().signal,
        outputVersion: () => version,
        onRetry: async () => {
          attempts++;
        },
        wait: async () => {},
      },
    ),
  );
  assert.equal(attempts, 0);
  const controller = new AbortController();
  await assert.rejects(
    retryModel(
      async () => {
        throw { status: 429 };
      },
      {
        signal: controller.signal,
        outputVersion: () => 0,
        onRetry: async () => {
          controller.abort();
        },
      },
    ),
    { name: "AbortError" },
  );
});
