import assert from "node:assert/strict";
import test from "node:test";
import { restoreTaskNavigation } from "../public/task-navigation.ts";

const available = [{ id: "task-one" }, { id: "task-two" }];

test("task navigation restores existing tabs and current task without duplicates", () => {
  assert.deepEqual(
    restoreTaskNavigation(
      JSON.stringify({
        tabs: ["task-two", "task-one", "task-two"],
        activeTask: "task-one",
      }),
      available,
    ),
    {
      tabs: ["task-two", "task-one"],
      activeTask: "task-one",
    },
  );
});

test("task navigation rejects malformed storage and unavailable task IDs", () => {
  for (const value of [
    null,
    "{",
    "null",
    "[]",
    '"task-one"',
    '{"tabs":"task-one"}',
  ])
    assert.deepEqual(restoreTaskNavigation(value, available), { tabs: [] });
  assert.deepEqual(
    restoreTaskNavigation(
      JSON.stringify({
        tabs: ["missing", "../../task-one", 1, null, "task-two"],
        activeTask: "missing",
      }),
      available,
    ),
    {
      tabs: ["task-two"],
      activeTask: undefined,
    },
  );
});

test("a known active task is retained even when its saved tab entry is missing", () => {
  assert.deepEqual(
    restoreTaskNavigation(
      JSON.stringify({ tabs: [], activeTask: "task-one" }),
      available,
    ),
    {
      tabs: ["task-one"],
      activeTask: "task-one",
    },
  );
});
