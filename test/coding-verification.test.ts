import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseWebSteps,
  verificationStale,
  verifyWeb,
} from "../server/coding-verification.ts";
import type { WebCheckStep } from "../shared/coding-verification.ts";

async function fixture(t: TestContext, html?: string) {
  const root = await mkdtemp(join(tmpdir(), "apsis-web-verification-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "index.html"),
    html ??
      `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/favicon.ico"></head><body>
    <input id="amount"><input id="people"><button id="calculate">Calculate</button>
    <output id="result">Not calculated</output><script src="app.js"></script></body></html>`,
  );
  return root;
}

const calculationSteps: WebCheckStep[] = [
  { action: "fill", selector: "#amount", value: "1000" },
  { action: "fill", selector: "#people", value: "4" },
  { action: "click", selector: "#calculate" },
  { action: "expect_text", selector: "#result", value: "NT$ 250.00" },
];
const script = `(function () {
  document.querySelector('#calculate').addEventListener('click', () => {
    setTimeout(() => {
      const value = Number(document.querySelector('#amount').value) / Number(document.querySelector('#people').value);
      document.querySelector('#result').textContent = 'NT$ ' + value.toFixed(2);
    }, 180);
  });
})`;

test("real headless interactions fail an uninvoked IIFE and pass its repaired delayed rendering", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "app.js"), script);
  const broken = await verifyWeb(
    root,
    "task",
    "broken-run",
    "index.html",
    calculationSteps,
    undefined,
    { assertionTimeoutMs: 450 },
  );
  assert.equal(broken.status, "failed");
  assert.equal(broken.assertions, 0);
  assert.equal(broken.steps[2].status, "passed", JSON.stringify(broken));
  assert.equal(broken.steps[3].status, "failed");
  assert.match(broken.steps[3].error!, /Not calculated/);

  await writeFile(join(root, "app.js"), script + "();\n");
  const repaired = await verifyWeb(
    root,
    "task",
    "repaired-run",
    "index.html",
    calculationSteps,
  );
  assert.equal(repaired.status, "passed", JSON.stringify(repaired));
  assert.equal(repaired.assertions, 1);
  assert.deepEqual(repaired.errors, []);
  assert.ok(repaired.files["index.html"]);
  assert.ok(repaired.files["app.js"]);
  assert.equal(
    repaired.files["favicon.ico"],
    undefined,
    "missing optional favicon is not a failed interaction",
  );
  assert.equal(await verificationStale(root, repaired), false);
  await writeFile(join(root, "README.md"), "Unrelated documentation");
  assert.equal(await verificationStale(root, repaired), false);
  await writeFile(
    join(root, "app.js"),
    script + "();\n// changed after the check\n",
  );
  assert.equal(await verificationStale(root, repaired), true);
});

test("verification requires an assertion and rejects paths outside the workspace before launching", async (t) => {
  const root = await fixture(t);
  assert.throws(
    () => parseWebSteps([{ action: "click", selector: "#calculate" }]),
    /預期結果/,
  );
  assert.throws(
    () =>
      parseWebSteps([
        { action: "expect_text", selector: "#result", value: " " },
      ]),
    /空白/,
  );
  assert.throws(
    () => parseWebSteps([{ action: "fill", selector: "#amount" }]),
    /value/,
  );
  for (const path of [
    "../index.html",
    "..\\index.html",
    join(root, "index.html"),
  ]) {
    await assert.rejects(
      verifyWeb(root, "task", "run", path, calculationSteps),
      /工作區|相對路徑/,
    );
  }
});

test("JavaScript page errors fail verification even when the visible assertion passes", async (t) => {
  const root = await fixture(
    t,
    '<!doctype html><p id="ready">Ready</p><script>throw new Error("fixture page error")</script>',
  );
  const receipt = await verifyWeb(root, "task", "run", "index.html", [
    { action: "expect_text", selector: "#ready", value: "Ready" },
  ]);
  assert.equal(receipt.assertions, 1);
  assert.equal(receipt.status, "failed");
  assert.ok(
    receipt.errors.some((error) => error.includes("fixture page error")),
  );
});

test("external network requests never reach another local server", async (t) => {
  let requests = 0;
  const target = createServer((_request, response) => {
    requests++;
    response.end("unexpected network access");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  const address = target.address();
  assert.ok(address && typeof address !== "string");
  const root = await fixture(
    t,
    `<!doctype html><p id="network">pending</p><script>
    fetch('http://127.0.0.1:${address.port}/outside').then(() => {
      document.querySelector('#network').textContent = 'unexpected';
    }).catch(() => { document.querySelector('#network').textContent = 'blocked'; });
  </script>`,
  );
  const receipt = await verifyWeb(root, "task", "run", "index.html", [
    { action: "expect_text", selector: "#network", value: "blocked" },
  ]);
  assert.equal(requests, 0);
  assert.equal(receipt.assertions, 1);
  assert.equal(
    receipt.status,
    "failed",
    "blocked dependencies cannot count as a working page",
  );
  assert.ok(receipt.errors.length > 0);
});

test("cancellation and the overall deadline stop pending browser assertions", async (t) => {
  const root = await fixture(t, '<!doctype html><p id="result">waiting</p>');
  const steps: WebCheckStep[] = [
    { action: "expect_text", selector: "#result", value: "never" },
  ];
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("fixture cancellation")),
    900,
  );
  let started = Date.now();
  let cancelled;
  try {
    cancelled = await verifyWeb(
      root,
      "task",
      "cancelled",
      "index.html",
      steps,
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  assert.equal(cancelled.status, "failed");
  assert.ok(
    cancelled.errors.some((error) => error.includes("fixture cancellation")),
  );
  assert.ok(Date.now() - started < 8000);
  started = Date.now();
  const timedOut = await verifyWeb(
    root,
    "task",
    "timeout",
    "index.html",
    steps,
    undefined,
    { timeoutMs: 900 },
  );
  assert.equal(timedOut.status, "failed");
  assert.ok(timedOut.errors.some((error) => error.includes("逾時")));
  assert.ok(Date.now() - started < 8000);
});

test("request floods and console errors have bounded verification records", async (t) => {
  const root = await fixture(
    t,
    `<!doctype html><p id="ready">Ready</p><script>
    for (let i = 0; i < 225; i++) fetch('/asset.json?i=' + i).catch(() => {});
    for (let i = 0; i < 80; i++) console.error('fixture error ' + i + 'x'.repeat(2000));
  </script>`,
  );
  await writeFile(join(root, "asset.json"), "{}");
  const receipt = await verifyWeb(root, "task", "run", "index.html", [
    { action: "expect_text", selector: "#ready", value: "Ready" },
  ]);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.errors.length, 40);
  assert.ok(receipt.errors.every((error) => error.length <= 1500));
  assert.ok(Object.keys(receipt.files).length <= 200);
});
