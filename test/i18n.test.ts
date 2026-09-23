import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { english } from "../public/translations.ts";
import {
  languageKey,
  parseLocale,
  saveLocale,
  translate,
} from "../public/i18n.ts";
import { agentTools } from "../shared/agents.ts";

test("language defaults to Traditional Chinese and persists only supported choices", () => {
  for (const value of [null, undefined, "fr", "", "zh-TW"])
    assert.equal(parseLocale(value), "zh-TW");
  assert.equal(parseLocale("en"), "en");
  const values = new Map<string, string>();
  assert.equal(
    saveLocale("en", {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    }),
    true,
  );
  assert.equal(values.get(languageKey), "en");
  assert.equal(
    saveLocale("en", {
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage blocked");
      },
    }),
    false,
  );
  assert.equal(
    saveLocale("en", { getItem: () => null, setItem: () => {} }),
    false,
  );
});

test("translations substitute once and leave user values and unknown text unchanged", () => {
  const name = "記憶 {1} <script> $&";
  assert.equal(translate("en", "與 {0} 的訊息", name), "Messages with " + name);
  assert.equal(
    translate("zh-TW", "與 {0} 的訊息", name),
    "與 " + name + " 的訊息",
  );
  assert.equal(
    translate("en", "Unknown provider response"),
    "Unknown provider response",
  );
  assert.equal(translate("en", "toString"), "toString");
});

test("English catalog covers literal UI keys and tool labels with matching placeholders", async () => {
  for (const [source, result] of Object.entries(english)) {
    assert.ok(result.trim(), source);
    assert.deepEqual(
      [...result.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      [...source.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      source,
    );
  }
  for (const file of await readdir(new URL("../public/", import.meta.url))) {
    if (!file.endsWith(".ts") || ["i18n.ts", "translations.ts"].includes(file))
      continue;
    const source = await readFile(
      new URL("../public/" + file, import.meta.url),
      "utf8",
    );
    for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(match[1]!);
      assert.ok(Object.hasOwn(english, key), `${file}: ${key}`);
    }
  }
  for (const label of Object.values(agentTools))
    assert.ok(Object.hasOwn(english, label), label);
});

test("English markdown controls preserve Chinese code and escape image descriptions", () => {
  const moduleUrl = new URL("../public/markdown.ts", import.meta.url).href;
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    globalThis.localStorage = { getItem: () => "en" };
    const { renderMarkdown } = await import(${JSON.stringify(moduleUrl)});
    console.log(renderMarkdown(${JSON.stringify("```text\n記憶 {0} <script>\n```\n\n![圖片 <b>](https://example.com/image.png)")}));
  `,
    ],
    { encoding: "utf8" },
  );
  assert.match(result, /Copy code/);
  assert.match(result, /Plain text/);
  assert.match(result, /記憶 \{0\} &lt;script&gt;/);
  assert.match(result, /\[Image: 圖片 &lt;b&gt;\]/);
  assert.doesNotMatch(result, /<img|複製程式碼/);
});
