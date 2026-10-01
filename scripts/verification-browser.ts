import { chromium } from "playwright";
import { browserExecutable } from "../server/bot-browser.ts";

// Branded browser checks use fresh isolated profiles, never the user's profile.
const option = process.argv.find((arg) => arg.startsWith("--browser="));
const selected = option?.slice(10);
if (option && selected !== "chrome" && selected !== "msedge")
  throw new Error("Use --browser=chrome or --browser=msedge.");
export const verificationBrowser = selected || "default";
export const verificationLaunch = () =>
  chromium.launch({
    headless: true,
    ...(selected
      ? { channel: selected }
      : { executablePath: browserExecutable() }),
  });
export const verificationDirectory = (root: string) =>
  selected ? `${root}/${selected}` : root;
