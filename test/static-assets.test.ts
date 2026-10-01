import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { StaticAssets } from "../server/static-assets.ts";

test("public assets negotiate compression, revalidate representations and refresh changed files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "apsis-static-assets-"));
  const path = join(directory, "style.css");
  const original = Buffer.from(".fixture { color: purple; }\n".repeat(1000));
  await writeFile(path, original);
  const assets = new StaticAssets();
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    void assets.serve(pathToFileURL(path), "text/css", req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const request = (accept = "identity", tag?: string, method = "GET") =>
    new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: Buffer;
    }>((resolve, reject) => {
      get(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/style.css`,
        {
          method,
          headers: {
            "Accept-Encoding": accept,
            ...(tag ? { "If-None-Match": tag } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      ).on("error", reject);
    });
  const raw = await request();
  assert.equal(raw.status, 200);
  assert.deepEqual(raw.body, original);
  assert.equal(raw.headers["cache-control"], "no-cache");
  const br = await request("gzip, br");
  assert.equal(br.headers["content-encoding"], "br");
  assert.deepEqual(brotliDecompressSync(br.body), original);
  assert.ok(br.body.length < original.length / 4);
  assert.equal(br.headers.vary, "Accept-Encoding");
  const gz = await request("br;q=0,gzip;q=0.8");
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.deepEqual(gunzipSync(gz.body), original);
  assert.notEqual(gz.headers.etag, br.headers.etag);
  assert.equal((await request("gzip,br", `W/${br.headers.etag}`)).status, 304);
  assert.equal((await request("gzip", br.headers.etag)).status, 200);
  assert.equal((await request("gzip,br", undefined, "HEAD")).body.length, 0);
  assert.equal((await request("*;q=0")).status, 406);
  assert.deepEqual((await request("gzip;q=0, br;q=0")).body, original);
  const updated = Buffer.from("/* Changed public stylesheet */\n".repeat(1000));
  await writeFile(path, updated);
  const changed = await request("gzip,br", br.headers.etag);
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, br.headers.etag);
  assert.deepEqual(brotliDecompressSync(changed.body), updated);
});
