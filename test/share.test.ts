import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShareGateway } from "../server/share-gateway.ts";
import { createApp } from "../server/app.ts";
const origin = "https://talaria-test.trycloudflare.com";
const password = "test-only-strong-random-password-12345";
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}
function call(
  port: number,
  path: string,
  {
    method = "GET",
    headers = {},
    body = "",
  }: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { Host: "talaria-test.trycloudflare.com", ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: data,
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
const login = (port: number, value = password) =>
  call(port, "/__share/login", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ password: value }).toString(),
  });

test("share gateway fails closed, authenticates exact origin and strips forwarded credentials", async (t) => {
  let hits = 0;
  const upstream = createServer((req, res) => {
    hits++;
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers["cf-access-jwt-assertion"], undefined);
    assert.equal(req.headers["x-forwarded-host"], undefined);
    res.end("private-data");
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.close());
  const gate = createShareGateway({ upstreamPort, password });
  const port = await listen(gate.server);
  t.after(() => gate.server.close());
  assert.equal((await call(port, "/")).status, 503);
  assert.throws(() => gate.setPublicOrigin("http://example.com"));
  gate.setPublicOrigin(origin);
  assert.equal((await call(port, "/api/status")).status, 401);
  assert.equal((await call(port, "/app.js")).status, 303);
  assert.equal(
    (
      await call(port, "/", {
        headers: {
          Host: "127.0.0.1:" + port,
          "X-Forwarded-Host": "talaria-test.trycloudflare.com",
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(port, "/__share/login", {
        method: "POST",
        body: "password=" + password,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(port, "/__share/login", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal((await login(port, "wrong")).status, 401);
  assert.equal(hits, 0);
  const loginPage = await call(port, "/__share/login");
  assert.equal(loginPage.headers["referrer-policy"], "same-origin");
  const response = await login(port);
  assert.equal(response.status, 303);
  const setCookie = response.headers["set-cookie"]![0];
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
    assert.ok(setCookie.includes(attribute));
  const cookie = setCookie.split(";")[0];
  const allowed = await call(port, "/api/status", {
    headers: {
      Cookie: cookie,
      Authorization: "secret",
      "CF-Access-Jwt-Assertion": "secret",
      "X-Forwarded-Host": "evil",
    },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, "private-data");
  assert.equal(allowed.headers["x-talaria-shared"], "1");
  assert.equal(hits, 1);
  const logout = await call(port, "/__share/logout", {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie },
  });
  assert.equal(logout.status, 303);
  assert.equal(
    (await call(port, "/api/status", { headers: { Cookie: cookie } })).status,
    401,
  );
});

test("authenticated remote requests preserve Talaria chat streaming, exports, and CSRF checks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "talaria-share-"));
  const app = await createApp({
    dataDir: join(dir, "data"),
    workspaceDir: join(dir, "work"),
    env: {},
  });
  const upstreamPort = await listen(app.server);
  t.after(() => app.server.close());
  const gate = createShareGateway({ upstreamPort, password });
  gate.setPublicOrigin(origin);
  const port = await listen(gate.server);
  t.after(() => gate.server.close());
  const cookie = (await login(port)).headers["set-cookie"]![0].split(";")[0];
  const headers = {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
    "X-Loom-Client": "1",
  };
  assert.equal(
    (
      await call(port, "/api/sessions", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(port, "/api/sessions", {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  const session = JSON.parse(
    (
      await call(port, "/api/sessions", {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "demo" }),
      })
    ).body,
  );
  const reply = await call(port, "/api/sessions/" + session.id + "/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "remote test", allowWrites: false }),
  });
  assert.equal(reply.status, 200);
  assert.match(reply.headers["content-type"]!, /x-ndjson/);
  const events = reply.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, "done");
  assert.ok(events.filter((e) => e.type === "delta").length > 1);
  const exported = await call(port, "/api/sessions/" + session.id + "/export", {
    headers: { Cookie: cookie },
  });
  assert.equal(exported.status, 200);
  assert.match(exported.body, /remote test/);
  assert.match(exported.headers["content-disposition"]!, /attachment/);
  assert.equal(
    (
      await call(port, "/api/settings", {
        headers: { Cookie: "__Host-talaria-share=forged" },
      })
    ).status,
    401,
  );
});

test("repeated failed logins are limited and do not reach the workspace", async (t) => {
  const gate = createShareGateway({ upstreamPort: 1, password });
  gate.setPublicOrigin(origin);
  const port = await listen(gate.server);
  t.after(() => gate.server.close());
  for (let i = 0; i < 20; i++)
    assert.equal((await login(port, "wrong")).status, 401);
  const limited = await login(port, "wrong");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "300");
});
