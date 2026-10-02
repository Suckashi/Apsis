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
import { ProductTools } from "../server/product-tools.ts";
import { WebCheckFailure } from "../server/tool-failure-guard.ts";
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

test("web checks can assert checkbox state and filtered items hidden after reload", async (t) => {
  const root = await fixture(
    t,
    `<!doctype html><html><body>
      <label id="done-label" for="done">Complete task</label>
      <input id="done" type="checkbox" style="display:none"><div id="task">Task T2</div>
      <script>
        const input = document.querySelector('#done');
        const task = document.querySelector('#task');
        input.checked = localStorage.getItem('done') === 'yes';
        const render = () => { task.hidden = input.checked; };
        input.addEventListener('change', () => {
          localStorage.setItem('done', input.checked ? 'yes' : 'no');
          render();
        });
        render();
      </script></body></html>`,
  );
  const steps: WebCheckStep[] = [
    { action: "expect_checked", selector: "#done", value: "false" },
    { action: "click", selector: "#done-label" },
    { action: "expect_checked", selector: "#done" },
    { action: "expect_hidden", selector: "#task" },
    { action: "reload" },
    { action: "expect_checked", selector: "#done" },
    { action: "expect_hidden", selector: "#task" },
  ];
  const receipt = await verifyWeb(root, "task", "run", "index.html", steps);
  assert.equal(receipt.status, "passed", JSON.stringify(receipt));
  assert.equal(receipt.assertions, 5);
  assert.throws(
    () =>
      parseWebSteps([
        { action: "expect_checked", selector: "#done", value: "yes" },
      ]),
    /網頁操作/,
  );
  const visible = await verifyWeb(
    root,
    "task",
    "failed-run",
    "index.html",
    [{ action: "expect_hidden", selector: "#task" }],
    undefined,
    { assertionTimeoutMs: 250 },
  );
  assert.equal(visible.steps[0].status, "failed");
  assert.equal(visible.status, "failed");
});

test("verify_web reports the failed step to the Bot retry guard", async (t) => {
  const root = await fixture(t);
  const recorded: unknown[] = [];
  const registry = new ProductTools({
    db: {
      jobs: {
        list: () => [{ runId: "run", botId: "bot", workContextId: "topic" }],
      },
      put: (_kind: string, value: unknown) => recorded.push(value),
    },
    workLocation: () => ({ path: root }),
    notify: () => {},
  } as unknown as ConstructorParameters<typeof ProductTools>[0]);
  const tool = registry
    .tools({ id: "bot" } as Parameters<ProductTools["tools"]>[0], "run")
    .find((item) => item.name === "verify_web")!;
  await assert.rejects(
    tool.execute("call", {
      path: "index.html",
      steps: JSON.stringify([
        { action: "expect_visible", selector: "#amount" },
        { action: "expect_hidden", selector: "#result" },
      ]),
    }),
    (error) => {
      assert.ok(error instanceof WebCheckFailure);
      assert.equal(error.check?.action, "expect_hidden");
      assert.equal(error.check?.selector, "#result");
      assert.match(error.message, /第 2 步 expect_hidden/);
      return true;
    },
  );
  assert.equal(recorded.length, 1);
});

test("verification requires an assertion and rejects paths outside the workspace before launching", async (t) => {
  const root = await fixture(t);
  assert.throws(() => parseWebSteps([{ action: "reload" }]), /預期結果/);
  assert.throws(
    () =>
      parseWebSteps([
        { action: "reload", selector: "body" },
        { action: "expect_visible", selector: "body" },
      ]),
    /reload/,
  );
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

test("style assertions inspect loaded CSS and wait for interactive changes without probes", async (t) => {
  const root = await fixture(
    t,
    '<!doctype html><link rel="stylesheet" href="styles.css"><button id="complete">Complete</button><script>document.querySelector("button").onclick = () => setTimeout(() => document.querySelector("button").classList.add("done"), 200);</script>',
  );
  const steps: WebCheckStep[] = [
    { action: "click", selector: "#complete" },
    {
      action: "expect_style",
      selector: "#complete",
      property: "color",
      value: "rgb(17, 17, 17)",
    },
  ];
  await writeFile(join(root, "styles.css"), ".done{color:#8a929c}");
  const broken = await verifyWeb(
    root,
    "task",
    "wrong-style",
    "index.html",
    steps,
    undefined,
    { assertionTimeoutMs: 350 },
  );
  assert.equal(broken.status, "failed");
  assert.match(broken.steps[1].error!, /138, 146, 156/);
  await writeFile(join(root, "styles.css"), ".done{color:#111}");
  const repaired = await verifyWeb(
    root,
    "task",
    "fixed-style",
    "index.html",
    steps,
  );
  assert.equal(repaired.status, "passed", JSON.stringify(repaired));
  assert.equal(repaired.assertions, 1);
  assert.ok(repaired.files["styles.css"]);
  assert.throws(
    () =>
      parseWebSteps([
        {
          action: "expect_style",
          selector: "button",
          value: "rgb(17, 17, 17)",
        },
      ]),
    /操作/,
  );
  assert.throws(
    () =>
      parseWebSteps([
        {
          action: "expect_style",
          selector: "button",
          property: "color",
          value: "",
        },
      ]),
    /操作/,
  );
});

test("reload verifies actual storage persistence and fails transient state", async (t) => {
  const root = await fixture(
    t,
    `<!doctype html><input id="note"><button id="save">Save</button><script>
    document.querySelector('#note').value = localStorage.getItem('note') || '';
    document.querySelector('#save').onclick = () => localStorage.setItem('note', document.querySelector('#note').value);
  </script>`,
  );
  const steps: WebCheckStep[] = [
    { action: "fill", selector: "#note", value: "Keep after reload" },
    { action: "click", selector: "#save" },
    { action: "reload" },
    { action: "expect_value", selector: "#note", value: "Keep after reload" },
  ];
  const saved = await verifyWeb(root, "task", "persisted", "index.html", steps);
  assert.equal(saved.status, "passed", JSON.stringify(saved));
  assert.equal(saved.assertions, 1, "reload alone is not an assertion");
  const fresh = await verifyWeb(root, "task", "fresh", "index.html", [
    { action: "expect_value", selector: "#note", value: "" },
  ]);
  assert.equal(
    fresh.status,
    "passed",
    "each check starts with isolated storage",
  );
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><input id="note"><button id="save">Save</button>',
  );
  const transient = await verifyWeb(
    root,
    "task",
    "transient",
    "index.html",
    steps,
    undefined,
    { assertionTimeoutMs: 100 },
  );
  assert.equal(transient.status, "failed");
  assert.equal(transient.steps[2].status, "passed");
  assert.equal(transient.steps[3].status, "failed");
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
