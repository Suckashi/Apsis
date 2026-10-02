# Single-assistant phase-one handoff

Branch: `feat/single-assistant-phase-one`; base main `1c779409123e9def6604230d8e70c91e1d33e637`.
Draft PR: https://github.com/Suckashi/Apsis/pull/20

Authorized: implementation, tests, feature-branch push and draft PR. **Do not merge, deploy, release, change OS security settings, delete existing user data or use paid inference.** Main-CI maintenance is a separate task.

Implemented design and limits: [single-assistant.md](docs/single-assistant.md). One assistant/main chat; independent background sessions; explicit job/session/run controls and SSE; scoped browser pages; captured model settings; bounded capacity with a reserved chat slot; serialized conflicting workspace and shell/browser access; mandatory critical/unknown-effect consent; target rechecks; once-only persisted completion; schema-5 namespace leaving old data intact; original-avatar lifecycle motion including paused approval, stale progress, reconnect and reduced motion. Legacy roster/template/manual delegation surfaces are removed from the active interface.

## Verified evidence

- The executor was reachable by successful commands after the reported disconnect; this work is preserved in committed increments.
- `npm run check:docs`, `npm run build`: passed.
- Last full `npm test`: **314 passed**, 0 failed. `/tmp/apsis-review-final-tests.log`.
- Acceptance regressions pass: real `runDeep` and integrated product completion into an existing main checkpoint; durable result cursor through paging/restart/compaction/concurrent arrival; backslash-path overwrite approval in auto/yolo; simultaneous absent-target writes require fresh overwrite consent while main chat responds. Final full suite includes these tests.
- Assistant desktop/mobile fixture browser: passed, including chat B during A, scoped stop, selected-avatar states, waiting approval, failure, disconnect/reconnect, reduced motion, stale-progress pause, distinct session-owned browser pages and reload. Dropped accepted POST responses for creation and steering survive reload and reconcile receipts without duplicate execution/adoption; approval location is visible. `/tmp/apsis-review-browser.log`.
- Settings browser: **23 checks passed**, no unexpected browser errors or external requests. `artifacts/settings-verification/report.json`.
- Synthetic screenshots: `docs/assets/single-assistant/`. Desktop, mobile, approval and stale states were visually inspected.
- No paid inference or live-model reliability claims. Local Node 24.19; CI checks Windows/Ubuntu Node 22.19. macOS unverified.

## Acceptance review follow-up

All five reported gaps were fixed on this branch: checkpoint completion delivery, canonical file targets, final consent inside per-file serialization, durable browser request identities with receipt reconciliation, and visible background approval working locations. The draft PR body records final-head CI after push. Shell/remote-process limitations remain documented; these fixes do not claim an OS sandbox.

## Continuation if interrupted

Check `git status`, the current draft head, and `gh pr checks 20`. Complete any failing checks on this branch; do not merge. Use `PLAYWRIGHT_BROWSERS_PATH=/tmp/apsis-browsers` locally and npm cache `/tmp/apsis-npm-cache` if needed. Dependencies are installed. Primary checks: docs, build, unit suite, `scripts/verify-assistant.ts`, `scripts/verify-settings.ts`.

The design explicitly documents host-account/shell limits, shared browser account state, dynamic remote DOM, conservative effect classification and the existing main-context-only PR-follow-up poller. Internal Bot field names persist as implementation details, not a data migration/compatibility layer. Reviewers should examine these boundaries before any future merge. No existing local user data was erased.
