import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createShareGateway } from "../server/share-gateway.ts";

const port = Number(process.env.PORT || 3100);
const sharePort = Number(process.env.SHARE_PORT || 3102);
if (
  ![port, sharePort].every(
    (value) => Number.isInteger(value) && value > 0 && value < 65536,
  ) ||
  port === sharePort
)
  throw new Error("PORT 與 SHARE_PORT 必須為不同的有效連接埠。");
const candidates =
  process.platform === "win32"
    ? [
        resolve(".tools/cloudflared.exe"),
        join(
          process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
          "cloudflared/cloudflared.exe",
        ),
        join(
          process.env.ProgramFiles || "C:/Program Files",
          "cloudflared/cloudflared.exe",
        ),
        "cloudflared",
      ]
    : ["cloudflared"];
const executable = candidates.find(
  (path) =>
    ((!path.includes("/") && !path.includes("\\")) || existsSync(path)) &&
    spawnSync(path, ["--version"], { windowsHide: true, stdio: "ignore" })
      .status === 0,
);
if (!executable)
  throw new Error(
    "找不到 cloudflared。請先安裝，或將 Windows 官方免安裝版放在 .tools/cloudflared.exe。",
  );
const children: ChildProcess[] = [];
const password = randomBytes(18).toString("base64url");
const gateway = createShareGateway({ upstreamPort: port, password });
let stopping = false;
let ready = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timeout);
  gateway.server.close();
  gateway.server.closeAllConnections();
  for (const child of children)
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
    }
  if (ready)
    await writeFile(
      ".loom/share-connection.json",
      JSON.stringify(
        { active: false, stoppedAt: new Date().toISOString() },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void shutdown());
async function appReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const state = await response.json();
    return (
      state.workspace === "workspace/" && typeof state.piReady === "boolean"
    );
  } catch {
    return false;
  }
}
try {
  await mkdir(".loom", { recursive: true });
  gateway.server.listen(sharePort, "127.0.0.1");
  await once(gateway.server, "listening");
  if (await appReady())
    console.log(
      `沿用本機工作台 http://localhost:${port}；停止分享不會關閉原有工作台。`,
    );
  else {
    const dev = spawn(process.execPath, ["scripts/dev.ts"], {
      stdio: "inherit",
      windowsHide: true,
    });
    children.push(dev);
    dev.once("error", (error) => {
      console.error(error.message);
      void shutdown(1);
    });
    dev.once("exit", () => {
      if (!stopping) {
        console.error("開發伺服器已停止，關閉分享。");
        void shutdown(1);
      }
    });
    const until = Date.now() + 20000;
    while (!stopping && !(await appReady()) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 300));
    if (stopping || !(await appReady()))
      throw new Error("本機工作台未能啟動，請確認連接埠是否被占用。");
  }
  console.log("正在建立有密碼保護的 Cloudflare 臨時連結…");
  // The tunnel always targets the authenticated gateway, never the app or Ollama directly.
  const tunnel = spawn(
    executable,
    [
      "tunnel",
      "--no-autoupdate",
      "--protocol",
      "http2",
      "--url",
      `http://127.0.0.1:${sharePort}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  children.push(tunnel);
  timeout = setTimeout(() => {
    console.error("建立分享逾時，詳見 .loom/share-tunnel.log");
    void shutdown(1);
  }, 60000);
  let log = "";
  const output = (chunk: Buffer) => {
    const text = chunk.toString();
    log = (log + text).slice(-10000);
    void appendFile(".loom/share-tunnel.log", text).catch(() => {});
    const url = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if (url && !ready && !stopping) {
      gateway.setPublicOrigin(url);
      ready = true;
      clearTimeout(timeout);
      void writeFile(
        ".loom/share-connection.json",
        JSON.stringify(
          { active: true, url, password, startedAt: new Date().toISOString() },
          null,
          2,
        ),
        { mode: 0o600 },
      )
        .then(() => {
          console.log(
            `\nApsis 遠端網址：${url}\n分享密碼：${password}\n登入有效 8 小時；Ctrl+C 關閉分享。重新啟動會更換網址與密碼。\n`,
          );
        })
        .catch((error) => {
          console.error(error.message);
          void shutdown(1);
        });
    }
  };
  tunnel.stdout?.on("data", output);
  tunnel.stderr?.on("data", output);
  tunnel.once("error", (error) => {
    console.error(error.message);
    void shutdown(1);
  });
  tunnel.once("exit", () => {
    if (!stopping) {
      console.error("Cloudflare Tunnel 已停止，關閉分享入口。");
      void shutdown(1);
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
}
