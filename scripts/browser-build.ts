import type { BuildOptions } from "esbuild";

export function browserBuildOptions(production = false): BuildOptions {
  return {
    entryPoints: ["public/bot.tsx"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outdir: production ? "dist/production-public" : "dist/public",
    sourcemap: true,
    ...(production
      ? {
          minify: true,
          define: { "process.env.NODE_ENV": '"production"' },
        }
      : {}),
  };
}
