# Contributing to AgentLoom

1. Install Node.js 22.19+ and run `npm ci`.
2. Run `npm run dev`; demo mode needs no credentials.
3. Keep the core development path Node-only and cross-platform. Prefer built-in Node APIs over additional infrastructure.
4. Add integrations as server-side adapters. Never commit keys, local conversations or workspace files.
5. Use native browser ES modules. No frontend build is required.
6. Run `npm run check` and `npm test` before submitting changes. For UI changes, also verify the relevant flow in a browser.
7. New write tools and remote execution tools must honor the per-run permission flag.

For bugs, include Node version, operating system, selected agent mode, steps to reproduce and sanitized errors. Do not attach `.env` or private conversation data.
