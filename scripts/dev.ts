import { context } from "esbuild";
import { spawn } from "node:child_process";

const browser = await context({
  entryPoints: ["public/app.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: "dist/public",
  sourcemap: true,
  logLevel: "info",
});
await browser.rebuild();
await browser.watch();
const server = spawn(
  process.execPath,
  ["--watch", "--env-file-if-exists=.env", "server/index.ts"],
  { stdio: "inherit" },
);
const stop = () => {
  server.kill();
  void browser.dispose();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.once("error", (error) => {
  console.error(error.message);
  void browser.dispose();
  process.exitCode = 1;
});
server.once("exit", async (code) => {
  await browser.dispose();
  process.exitCode = code ?? 0;
});
