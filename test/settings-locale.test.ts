import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsers } from "prettier/plugins/typescript";
import { english, uiError, uiText } from "../public/settings-dictionary.ts";
import {
  getSettingsLocale,
  setSettingsLocale,
  settingsText,
} from "../public/settings-locale.ts";
import { renderMarkdown } from "../public/markdown.ts";

const slots = (text: string) =>
  [...text.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

test("fixed UI dictionary calls have English entries and matching placeholders", async () => {
  for (const [source, translated] of Object.entries(english)) {
    assert.ok(translated.trim(), `Empty translation: ${source}`);
    assert.deepEqual(
      slots(translated),
      slots(source),
      `Placeholder mismatch: ${source}`,
    );
  }
  let checked = 0;
  for (const file of [
    "bot.tsx",
    "provider-settings.tsx",
    "bot-ui.tsx",
    "mcp-json.ts",
    "settings-controls.tsx",
    "settings-templates.tsx",
    "markdown.ts",
  ]) {
    const source = await readFile(
      new URL(`../public/${file}`, import.meta.url),
      "utf8",
    );
    const ast: unknown = await parsers.typescript.parse(source, {
      filepath: file,
      parser: "typescript",
    } as Parameters<typeof parsers.typescript.parse>[1]);
    const visit = (value: unknown) => {
      const node = record(value);
      if (!node) return;
      const callee = record(node.callee);
      if (
        node.type === "CallExpression" &&
        (callee?.name === "uiText" ||
          (file === "markdown.ts" && callee?.name === "t"))
      ) {
        const first = Array.isArray(node.arguments)
          ? record(node.arguments[0])
          : undefined;
        if (first?.type === "Literal" && typeof first.value === "string") {
          assert.ok(
            Object.hasOwn(english, first.value),
            `${file}: missing translation for ${first.value}`,
          );
          checked++;
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (["tokens", "comments", "loc", "range", "parent"].includes(key))
          continue;
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
    };
    visit(ast);
  }
  assert.ok(
    checked > 300,
    "Audit must inspect the full application, not an empty parse result",
  );
});

test("locale switches both ways, interpolates values and preserves unknown diagnostics", () => {
  const previous = getSettingsLocale();
  try {
    setSettingsLocale("en");
    assert.equal(uiText("名稱"), "Name");
    assert.equal(settingsText("save"), "Save changes");
    assert.equal(
      uiText("刪除「{0}」？", ["我的 Bot {1}"]),
      "Delete “我的 Bot {1}”?",
    );
    assert.equal(uiError("找不到 Bot。"), "Bot not found.");
    for (const raw of [
      "Upstream detail: 模型拒絕",
      "toString",
      "constructor",
      "__proto__",
    ]) {
      assert.equal(uiText(raw), raw);
      assert.equal(uiError(raw), raw);
    }
    setSettingsLocale("zh-Hant");
    assert.equal(uiText("名稱"), "名稱");
    assert.equal(settingsText("save"), "儲存變更");
    assert.equal(uiText("刪除「{0}」？", ["My Bot"]), "刪除「My Bot」？");
    assert.equal(
      uiError("Rule tool must be exact or '*'"),
      "請填入完整工具名稱或 *；不能包含空白或其他萬用字元。",
    );
    assert.equal(uiError("constructor"), "constructor");
  } finally {
    setSettingsLocale(previous);
  }
});

test("Markdown labels follow locale at render time without rewriting code or user content", () => {
  const previous = getSettingsLocale();
  try {
    const source =
      "User content 使用者文字\n\n```text\nconst message = '名稱';\n```\n\n```\nunchanged();\n```";
    setSettingsLocale("en");
    const en = renderMarkdown(source);
    assert.equal((en.match(/>Plain text</g) || []).length, 2);
    assert.match(en, /aria-label="Copy code"/);
    assert.match(en, /aria-label="Code, scroll horizontally"/);
    assert.match(en, /User content 使用者文字/);
    assert.match(en, /const message = '名稱';/);
    setSettingsLocale("zh-Hant");
    const zh = renderMarkdown(source);
    assert.equal((zh.match(/>純文字</g) || []).length, 2);
    assert.match(zh, /aria-label="複製程式碼"/);
    assert.match(zh, /aria-label="程式碼，可左右捲動"/);
    assert.match(zh, /const message = '名稱';/);
  } finally {
    setSettingsLocale(previous);
  }
});
