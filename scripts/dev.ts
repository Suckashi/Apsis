import { context } from "esbuild";
import { spawn } from "node:child_process";
import { browserBuildOptions } from "./browser-build.ts";
import { watchDevelopmentSources } from "./development-watch.ts";

const browser = await context({
  ...browserBuildOptions(),
  logLevel: "info",
});
await browser.rebuild();
await browser.watch();
const launch = () =>
  spawn(process.execPath, ["--env-file-if-exists=.env", "server/index.ts"], {
    stdio: "inherit",
    env: { ...process.env, APSIS_BROWSER_BUILD: "development" },
  });
let server = launch();
let stopping = false;
let restarting = false;
const stopWatching = await watchDevelopmentSources(process.cwd(), () => {
  if (stopping || restarting) return;
  restarting = true;
  server.once("exit", () => {
    if (stopping) return;
    server = launch();
    observeServer();
    restarting = false;
  });
  server.kill();
});
const stop = () => {
  stopping = true;
  stopWatching();
  server.kill();
  void browser.dispose();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
function observeServer() {
  server.once("error", (error) => {
    console.error(error.message);
    void browser.dispose();
    process.exitCode = 1;
    stopWatching();
  });
  server.once("exit", async (code) => {
    if (restarting && !stopping) return;
    stopWatching();
    await browser.dispose();
    process.exitCode = code ?? 0;
  });
}
observeServer();
