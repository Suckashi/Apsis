import { build } from "esbuild";
await build({
  entryPoints: ["public/bot.tsx"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: "dist/public",
  sourcemap: true,
});
console.log("Browser TypeScript compiled to dist/public.");
