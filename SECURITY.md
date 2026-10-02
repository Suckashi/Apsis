# Security policy

## Supported versions

During Alpha, security fixes target the latest published prerelease. Older prereleases and the default branch are not separately supported release lines. Upgrade instructions and breaking changes are listed in each [release](https://github.com/Suckashi/Apsis/releases) and in the [version policy](docs/releases.md). Security response and fix times are best effort; no response-time SLA is promised.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/Suckashi/Apsis/security/advisories/new), enabled for this repository. Include the affected release/commit, OS and Node version, reproducible steps, expected boundary, observed impact, and a minimal sanitized example. Do not include live keys, cookies, conversation databases or private documents.

The maintainer will assess the report, discuss reproduction privately, and coordinate a fix and disclosure with the reporter. Please keep exploitable details private while that work is in progress. Ordinary bugs and feature requests belong in [Issues](https://github.com/Suckashi/Apsis/issues/new/choose).

## Application boundary

- Apsis is a local, single-owner application. The normal server binds to `127.0.0.1`; it is not a multi-tenant hosted service. The server validates Host/Origin and mutation request headers.
- Approval modes, readonly settings and path rules gate tools. **Shell executes on the host and is not an operating-system sandbox.** Native Deep Agents `execute` is disabled; native `task` children use guarded tools and inherited authorization.
- MCP connectors and browser tools can contact external systems with the credentials available to them. The dedicated browser profile can contain reusable login state and is shared by Bot tabs.
- API keys stay server-side. Settings can hold credentials or refer to environment variables; configuration and stored browser state are not encrypted by Apsis. Use host permissions to protect the data directory, `.env`, external workspaces and backups.
- Configured providers receive the task context needed for model requests. Files, web pages, tool output and model instructions remain untrusted input. Local storage does not mean every request stays on your machine.
- Stopping a task does not roll back completed side effects. Restart recovery marks unfinished work interrupted or uncertain and does not automatically replay external operations.
- Optional sharing has its own password/session boundary. Anyone granted access to a shared workspace may see sensitive content or invoke its available capabilities; use it only for trusted access. Do not expose the normal local server directly to a network.

See [approval modes](docs/approval-modes.md) for exact behavior and [architecture](docs/architecture.md) for storage and runtime boundaries. Treat a bypass of documented authorization, cross-Bot isolation, credential redaction or share authentication as a security report. A permitted host command accessing host files is part of the declared Shell boundary.
