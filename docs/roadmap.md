# Roadmap and known limitations

Apsis focuses on local Bot conversations that lead to useful work, visible execution and durable results. This roadmap describes priorities, not delivery dates. The maintainer selects scope through issues and PR review.

## Alpha baseline

- One Deep Agents runtime, guarded tools, observable native subagents and persistent Bot delegation.
- Continuing conversations, steering receipts, files, Git changes, published artifacts, memory and schedules.
- Current-format storage with interrupted-work recovery and isolated backup/restore verification.
- Windows/Ubuntu CI with deterministic tests and core browser workflows.
- Apache 2.0 licensing, source prereleases, current guides and contribution/security reporting.

## Next acceptance priorities

1. Independent onboarding: 3–5 people unfamiliar with the code install a tagged release and finish a first task without developer intervention.
2. Real-provider reliability: repeat representative repository, document and schedule tasks; record corrections, failed operations, cost and long-task outcomes.
3. Recovery and upgrade confidence: try stopped backups, controlled interruption and version upgrades on disposable stores; confirm data and published results remain readable.
4. Accessibility and performance: manual screen-reader journeys, more browser coverage, low-performance devices and large conversations/documents.
5. Maintenance: expand focused CI coverage where real usage finds gaps, review dependency update PRs and keep current documents consistent with code.

The [Alpha acceptance plan](alpha-acceptance.md) defines evidence and a trial report template. New features should support these journeys rather than multiply permanent controls.

## Known limitations

- Alpha APIs and data formats may change; only schema 5 is accepted, with no schema 3 import. Source releases need Node/npm and a build at startup.
- Automated browser tests use deterministic runners. Passing them does not prove real-model long-task reliability, provider compatibility or multi-day unattended use.
- Windows and Ubuntu on Node.js 22.19 are the CI baseline. macOS, other Node versions and broader browser coverage need additional evidence.
- Shell is host execution, not OS isolation. Optional sharing is trusted access to a single-owner workspace, not a multi-tenant service.
- Full interface translation, manual screen-reader coverage, real low-performance-device measurements and Word print-layout/complex-document fidelity are not complete.
- The development quality log records outstanding long-task/interruption and large-content evidence; earlier local screenshots and audit runs are not a substitute for release acceptance.

## Contribution entry points

These are proposed small tasks, not claims that corresponding GitHub issues already exist:

- Reproduce the getting-started flow on a fresh Windows or Ubuntu installation and improve unclear instructions.
- Report a localization gap with a screenshot, expected wording and the affected flow.
- Reproduce one documented accessibility issue with keyboard or a screen reader and propose a focused fix.
- Add a regression for a confirmed restore, steering or artifact-delivery failure.
- Test a specific tool-capable provider and report exact sanitized endpoint/model settings and outcomes.

Open an issue with the intended scope before taking a substantial task. See [contributing](../CONTRIBUTING.md).
