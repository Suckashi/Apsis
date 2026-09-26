import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_SETTINGS, SETTINGS_BOUNDS } from "../shared/settings.ts";
import type { PermissionRule } from "../shared/settings.ts";
import { ProductDB } from "../server/product-db.ts";
import {
  SettingsService,
  SettingsValidationError,
  SettingsRevisionError,
  validateSettings,
  validateRules,
} from "../server/settings.ts";
import {
  evaluatePolicy,
  normalizePolicyPath,
  policyPathMatches,
} from "../server/policy.ts";

test("settings defaults and all strict numeric bounds", () => {
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
  for (const [key, [min, max]] of Object.entries(SETTINGS_BOUNDS)) {
    for (const value of [min, max])
      assert.equal(Reflect.get(validateSettings({ [key]: value }), key), value);
    for (const value of [
      min - 1,
      max + 1,
      1.5,
      NaN,
      Infinity,
      "2",
      null,
      undefined,
      true,
    ])
      assert.throws(
        () => validateSettings({ [key]: value }),
        SettingsValidationError,
      );
  }
  assert.equal(validateSettings({ locale: "en" }).locale, "en");
  for (const input of [
    null,
    [],
    "x",
    { locale: "zh-TW" },
    { surprise: 1 },
    { revision: 1 },
  ])
    assert.throws(() => validateSettings(input), SettingsValidationError);
});

test("settings SQLite persistence, revision conflicts, rollback and detached results", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-settings-"));
  const db = await new ProductDB().init(directory);
  const other = await new ProductDB().init(directory);
  t.after(async () => {
    other.db.close();
    db.db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new SettingsService(db);
  const second = new SettingsService(other);
  assert.deepEqual(service.read(), { ...DEFAULT_SETTINGS, revision: 0 });
  const updated = service.update({ locale: "en" }, 0);
  assert.equal(updated.revision, 1);
  assert.equal(second.read().locale, "en");
  assert.throws(
    () => second.update({ revision: 0, maxTurns: 20 }),
    (error: unknown) =>
      error instanceof SettingsRevisionError &&
      error.status === 409 &&
      error.actualRevision === 1,
  );
  assert.throws(
    () => service.update({ revision: 1, maxTurns: 201 }),
    SettingsValidationError,
  );
  assert.equal(service.read().revision, 1);
  for (const revision of [undefined, -1, 0.5, "1", null])
    assert.throws(() => service.update({ revision }), SettingsValidationError);
  const next = second.update({
    revision: 1,
    maxTurns: 20,
    permissionRules: [rule("one", "allow")],
  });
  assert.equal(next.revision, 2);
  next.permissionRules[0].effect = "deny";
  next.maxTurns = 99;
  assert.equal(service.read().maxTurns, 20);
  assert.equal(service.read().permissionRules[0].effect, "allow");
  assert.deepEqual(
    service.update({ permissionRules: [] }, 2).permissionRules,
    [],
  );
});

function rule(
  id: string,
  effect: PermissionRule["effect"],
  extra: Partial<PermissionRule> = {},
): PermissionRule {
  return { id, scope: "global", tool: "*", effect, ...extra };
}

test("permission rules validate scope, identifiers, exact tools and canonical paths", () => {
  assert.equal(
    validateRules([rule("a", "ask", { path: "./src\\sub//" })])[0].path,
    "src/sub",
  );
  assert.equal(
    validateRules([
      rule("a", "deny", { scope: "bot", botId: "bot-1", targetBotId: "bot-2" }),
    ])[0].botId,
    "bot-1",
  );
  for (const value of [
    null,
    {},
    [null],
    [rule("a", "allow"), rule("a", "deny")],
    [rule("", "allow")],
    [rule("a", "allow", { scope: "bot" })],
    [rule("a", "allow", { botId: "bot-1" })],
    [rule("a", "allow", { targetBotId: "" })],
    [rule("a", "allow", { tool: "read_*" })],
    [rule("a", "allow", { tool: "read?" })],
    [{ ...rule("a", "allow"), effect: { toString: () => "allow" } }],
    [{ ...rule("a", "allow"), unknown: true }],
  ])
    assert.throws(() => validateRules(value), SettingsValidationError);
});

test("paths reject traversal, absolute paths and ambiguous Windows aliases", () => {
  for (const path of [
    "../src",
    "src/../safe",
    "src\\..\\safe",
    "/src",
    "\\src",
    "C:\\src",
    "C:src",
    "\\\\host\\share",
    "src\0x",
    "src/file:stream",
    "src/.. ",
    "src/name.",
    "src/NUL.txt",
  ]) {
    assert.throws(() => normalizePolicyPath(path));
    assert.throws(
      () => validateRules([rule("a", "allow", { path })]),
      SettingsValidationError,
    );
    assert.equal(
      evaluatePolicy([], { tool: "read_file", path }).effect,
      "deny",
    );
  }
  assert.equal(normalizePolicyPath(""), ".");
  assert.equal(policyPathMatches("src", "src/a.txt"), true);
  assert.equal(policyPathMatches("src", "src"), true);
  assert.equal(policyPathMatches("src", "src-other/a.txt"), false);
  assert.equal(policyPathMatches("src/file", "src/filename"), false);
  assert.equal(policyPathMatches("SRC", "src/a"), false);
  assert.equal(
    policyPathMatches("SRC", "src/a", { caseInsensitive: true }),
    true,
  );
  assert.equal(policyPathMatches(".", "src/a"), true);
});

test("policy deny overrides ask and allow regardless of rule order or scope", () => {
  const rules = [
    rule("allow", "allow"),
    rule("ask", "ask", { scope: "bot", botId: "b" }),
    rule("deny", "deny", { path: "src" }),
  ];
  const request = { tool: "write_file", botId: "b", path: "src/a" };
  const decision = evaluatePolicy(rules, request);
  assert.equal(decision.effect, "deny");
  assert.equal(decision.explicitAsk, false);
  assert.deepEqual(evaluatePolicy([...rules].reverse(), request), decision);
  const ask = evaluatePolicy(rules.slice(0, 2), request);
  assert.equal(ask.effect, "ask");
  assert.equal(ask.explicitAsk, true);
  assert.equal(
    evaluatePolicy(rules, { ...request, path: "src-other/a", botId: "other" })
      .effect,
    "allow",
  );
});

test("policy scopes and target restrictions must all match", () => {
  const rules = [
    rule("deny", "deny", {
      scope: "bot",
      botId: "a",
      tool: "delegate_task",
      targetBotId: "b",
      path: "src",
    }),
  ];
  const request = {
    tool: "delegate_task",
    botId: "a",
    targetBotId: "b",
    path: "src/x",
  };
  assert.equal(evaluatePolicy(rules, request).effect, "deny");
  for (const patch of [
    { botId: "c" },
    { targetBotId: "c" },
    { tool: "read_file" },
    { path: "src2/x" },
    { path: undefined },
  ])
    assert.equal(
      evaluatePolicy(rules, { ...request, ...patch }).effect,
      "allow",
    );
});

test("policy defaults to yolo and readonly cannot be overridden", () => {
  for (const request of [
    { tool: "shell" },
    { tool: "mcp_call" },
    { tool: "browser", action: "click" },
    { tool: "browser" },
  ]) {
    assert.equal(evaluatePolicy([], request).effect, "allow");
    assert.equal(evaluatePolicy([], request).explicitAsk, false);
    assert.equal(
      evaluatePolicy([rule("allow", "allow")], request).effect,
      "allow",
    );
    assert.equal(
      evaluatePolicy([rule("allow", "allow")], { ...request, readonly: true })
        .effect,
      "deny",
    );
  }
  for (const request of [
    { tool: "read_file" },
    { tool: "browser", action: "read" },
    { tool: "browser", action: "navigate" },
    { tool: "other_tool" },
  ])
    assert.equal(
      evaluatePolicy([], { ...request, readonly: true }).effect,
      "allow",
    );
  for (const request of [
    { tool: "write_file" },
    { tool: "edit_file" },
    { tool: "create_document" },
    { tool: "draft_message" },
    { tool: "delegate_task" },
    { tool: "custom", mutation: true },
  ])
    assert.equal(
      evaluatePolicy([rule("allow", "allow")], { ...request, readonly: true })
        .reason,
      "readonly",
    );
});
