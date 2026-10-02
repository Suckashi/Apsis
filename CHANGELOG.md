# Changelog

Changes are recorded by published version. Earlier development commits are summarized in the first Alpha baseline; they are not represented as prior releases.

## Unreleased

No changes recorded yet.

## 0.2.0-alpha.1 — 2026-10-02

First source Alpha, licensed under Apache License 2.0. Vendored Kimi Bash retains MIT notices.

### Baseline

- Conversation-first Bot workspace with Deep Agents, continuing history, memory, steering, guarded tools, schedules and downloadable artifacts.
- Native `task` subagents with public execution evidence; persistent cross-Bot work through `delegate_task`.
- Windows/Ubuntu verification with deterministic model fixtures. Source-based Node.js 22.19+ installation.

### Release preparation

- Reworked English and Traditional Chinese READMEs; added getting-started guides, synthetic UI screenshot, troubleshooting and current/historical documentation index.
- Corrected native-subagent documentation and retired-runtime repository description.
- Added contribution, conduct and private security reporting policies, Issue/PR forms and dependency-update configuration.
- Added version/backup policies, a stopped backup/restore integration check, roadmap and independent-user acceptance plan.
- Added documentation/metadata checks and a tag-triggered release workflow gated by cross-platform tests and core browser verification.
- Corrected the mobile chat verifier's fixed reply count after earlier unread-message fixtures; it now checks the submitted message adds one expected reply.

### Compatibility and limitations

- Schema 4 only; no automatic schema 3 migration or import. Older `.apsis/` stores remain untouched.
- Checkpoint version 1 uses the `deepagents@1.14.0` engine tag. Use a stopped matching-version backup for rollback.
- Alpha APIs/formats may change. macOS, real-provider long tasks, independent-user week-long trials and complete accessibility/document fidelity remain unverified release-wide.

See [release notes](docs/releases/0.2.0-alpha.1.md) and [known limitations](docs/roadmap.md).
