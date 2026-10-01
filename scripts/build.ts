import { build } from "esbuild";
import { browserBuildOptions } from "./browser-build.ts";
await build(browserBuildOptions(true));
console.log("Production browser compiled to dist/production-public.");
