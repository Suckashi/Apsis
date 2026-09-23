import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

// Keep the established wire name so rebranding does not invalidate login sessions.
const cookieName = "__Host-talaria-share";
const lifetime = 8 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest();
const loginPage = (error = "") =>
  `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入 Apsis</title><link rel="stylesheet" href="/__share/style.css"></head><body><main><div class="brand">⌘ Apsis</div><span class="eyebrow">YOUR PRIVATE WORKSPACE</span><h1>你的工作台，隨處可達。</h1><p>輸入本次分享密碼，連回你的 Apsis。</p><form method="post" action="/__share/login"><label for="password">分享密碼</label><input id="password" name="password" type="password" required maxlength="256" autocomplete="current-password" autofocus><p class="error" role="alert">${error}</p><button type="submit">登入工作台 →</button></form><small>登入有效 8 小時。停止分享後，這個入口就會關閉。</small></main></body></html>`;

export function createShareGateway({
  upstreamPort,
  password,
}: {
  upstreamPort: number;
  password: string;
}) {
  if (
    !Number.isInteger(upstreamPort) ||
    upstreamPort < 1 ||
    upstreamPort > 65535
  )
    throw new Error("Invalid upstream port");
  if (password.length < 24)
    throw new Error("Share password must contain at least 24 characters");
  const passwordHash = digest(password);
  const sessions = new Map<string, number>();
  let publicOrigin: URL | undefined;
  let failures = 0;
  let windowStart = Date.now();
  const send = (
    res: ServerResponse,
    code: number,
    value: string,
    html = false,
  ) => {
    res.writeHead(code, {
      "Content-Type": html
        ? "text/html; charset=utf-8"
        : "text/plain; charset=utf-8",
    });
    res.end(value);
  };
  const redirect = (res: ServerResponse, path: string) => {
    res.writeHead(303, { Location: path });
    res.end();
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    try {
      // Only the exact tunnel hostname is accepted. Forwarded headers never confer trust.
      if (!publicOrigin) return send(res, 503, "分享入口正在準備中。");
      if (req.headers.host !== publicOrigin.host)
        return send(res, 403, "不允許的 Host。");
      if (req.headers.origin && req.headers.origin !== publicOrigin.origin)
        return send(res, 403, "不允許的來源。");
      if (req.headers["sec-fetch-site"] === "cross-site")
        return send(res, 403, "不允許跨網站請求。");
      if (!req.url?.startsWith("/") || req.url.startsWith("//"))
        return send(res, 400, "無效網址。");
      const url = new URL(req.url, publicOrigin);
      if (url.origin !== publicOrigin.origin)
        return send(res, 400, "無效網址。");
      if (
        !["GET", "HEAD"].includes(req.method || "") &&
        req.headers.origin !== publicOrigin.origin
      )
        return send(res, 403, "缺少正確的 Origin。");
      if (url.pathname === "/__share/style.css" && req.method === "GET") {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        return res.end(
          await readFile(new URL("../public/share.css", import.meta.url)),
        );
      }
      if (url.pathname === "/__share/login") {
        if (req.method === "GET") return send(res, 200, loginPage(), true);
        if (req.method !== "POST") return send(res, 405, "不支援的操作。");
        if (
          !req.headers["content-type"]?.startsWith(
            "application/x-www-form-urlencoded",
          )
        )
          return send(res, 415, "不支援的表單格式。");
        if (Date.now() - windowStart > 300000) {
          failures = 0;
          windowStart = Date.now();
        }
        if (failures >= 20) {
          res.setHeader("Retry-After", "300");
          return send(res, 429, loginPage("嘗試次數過多，請稍後再試。"), true);
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 2048)
            return send(res, 413, "內容過大。");
        }
        const candidate = new URLSearchParams(body).get("password") || "";
        if (!timingSafeEqual(digest(candidate), passwordHash)) {
          failures++;
          return send(
            res,
            401,
            loginPage("密碼不正確，請確認本次分享密碼。"),
            true,
          );
        }
        for (const [key, expires] of sessions)
          if (expires <= Date.now()) sessions.delete(key);
        if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, Date.now() + lifetime);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime / 1000}`,
        );
        return redirect(res, "/");
      }
      const token =
        (req.headers.cookie || "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(cookieName + "="))
          ?.slice(cookieName.length + 1) || "";
      const expires = sessions.get(token);
      if (!expires || expires <= Date.now()) {
        sessions.delete(token);
        if (url.pathname.startsWith("/api/")) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "遠端登入已到期，請重新整理頁面登入。" }),
          );
        }
        return redirect(res, "/__share/login");
      }
      if (url.pathname === "/__share/logout" && req.method === "POST") {
        sessions.delete(token);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
        );
        return redirect(res, "/__share/login");
      }
      if (url.pathname.startsWith("/__share/"))
        return send(res, 404, "找不到頁面。");
      if (
        !["GET", "HEAD"].includes(req.method || "") &&
        req.headers["x-loom-client"] !== "1"
      )
        return send(res, 403, "缺少工作台請求標頭。");
      // Rebuild a small header allowlist after authentication. Never forward proxy credentials.
      const headers: Record<string, string> = {
        host: `127.0.0.1:${upstreamPort}`,
      };
      for (const key of ["content-type", "accept", "x-loom-client"]) {
        const value = req.headers[key];
        if (typeof value === "string") headers[key] = value;
      }
      if (req.headers.origin)
        headers.origin = `http://127.0.0.1:${upstreamPort}`;
      const upstream = request(
        {
          hostname: "127.0.0.1",
          port: upstreamPort,
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (response) => {
          res.writeHead(response.statusCode || 502, {
            ...response.headers,
            "Cache-Control": "no-store",
            "X-Talaria-Shared": "1",
            "Referrer-Policy": "same-origin",
          });
          response.on("error", () => res.destroy());
          response.pipe(res);
        },
      );
      upstream.setTimeout(310000, () => upstream.destroy(new Error("timeout")));
      upstream.on("error", () => {
        if (!res.headersSent)
          send(res, 502, "本機工作台暫時無法連線，請稍後重新整理。");
        else res.destroy();
      });
      req.on("aborted", () => upstream.destroy());
      res.on("close", () => {
        if (!res.writableEnded) upstream.destroy();
      });
      req.pipe(upstream);
    } catch {
      if (!res.headersSent) send(res, 500, "分享入口發生錯誤。");
      else res.destroy();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 64;
  return {
    server,
    setPublicOrigin(value: string) {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.port ||
        !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)
      )
        throw new Error("Invalid Quick Tunnel URL");
      publicOrigin = url;
    },
  };
}
