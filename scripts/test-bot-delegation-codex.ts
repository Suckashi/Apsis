// Retired entry point retained so old commands fail clearly without accessing
// local ChatGPT credentials, creating app data, or invoking another provider.
console.error(
  "Codex support has been retired. This live delegation test is no longer available. " +
    "Run node --test test/codex-bridge.test.ts test/runtime-selection.test.ts to verify removal.",
);
process.exitCode = 1;
