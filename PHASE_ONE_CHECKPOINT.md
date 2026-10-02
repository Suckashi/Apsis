# Single-assistant phase-one checkpoint

Branch: `feat/single-assistant-phase-one`, based on main `1c779409123e9def6604230d8e70c91e1d33e637`.

Authorized: implement, test, push and open a draft PR. Do not merge, deploy, release, change OS security settings, erase old user data, use paid inference or duplicate main-CI maintenance. User additionally requested selected-avatar working animations with honest lifecycle/reconnect states and reduced-motion support.

Implemented: independent persistent work sessions and work cards; main chat remains usable; job/session/run targeting for steering, stop, approvals and SSE; per-session browser pages; serialized shared workspaces; bounded background capacity with a reserved chat slot; exact consent fingerprints and mandatory critical/unknown-action checks; once-only persisted result messages; schema-5 namespace preserving older stores; selected-avatar progress motion; roster/template/delegation removal from the active UI. Native Deep Agents remains the only model runtime. Details and limitations: `docs/single-assistant.md`.

Verified at this checkpoint:

- Actual shell commands work after the reported executor disconnect. Working directory `/workspace/Apsis`.
- Full `npm test`: 307 tests passed before the latest two concurrency tests and final lock/UI/documentation refinements. Log `/tmp/apsis-tests-final.log`.
- `node --test test/single-assistant.test.ts`: 7 passed, including the new capacity/contention tests. Log `/tmp/apsis-single.log`.
- Build passed before final documentation/lock refinements. Logs `/tmp/apsis-build.log`, `/tmp/apsis-check.log`.
- `npm run check:docs` passed after documentation edits. Log `/tmp/apsis-docs.log`.
- `scripts/verify-assistant.ts` passed actual desktop/mobile fixture flows. Screenshots in `artifacts/single-assistant/`; desktop/mobile images inspected. Includes chat B during A, selected avatar, approval waiting, error, disconnect/reconnect, reduced motion, stop and reload. Last run preceded final settings refinements.
- Settings browser verifier ran: all but two obsolete expectations passed. Those expectations (disabled mandatory guard and two remaining settings tabs) have been corrected; rerun is pending.

Next steps:

1. Format changed files and rerun docs/build/full unit suite (expect 309 tests), assistant browser and settings browser. Use `PLAYWRIGHT_BROWSERS_PATH=/tmp/apsis-browsers`; npm cache `/tmp/apsis-npm-cache` if needed. Dependencies are installed. Node is 24.19 locally; CI baseline remains Windows/Ubuntu Node 22.19.
2. Strengthen browser evidence for stale progress and owned pages if needed; current fixture is deterministic, not real-model validation. No credentials or paid model calls were used.
3. Review final diff, include synthetic screenshots, commit, push feature branch and open DRAFT PR. Check branch CI; do not merge.
4. Report the exact PR URL, checks and limits. Background PR tracking stores context correctly but the automatic follow-up poller currently follows only the main context; this is documented. No universal native-app control or OS sandbox is claimed.

Potential review concerns: retained internal Bot naming/helpers are single-profile service implementation details; removed legacy public UX tests were replaced with single-assistant acceptance checks while low-level permission, journal, native-subagent and RunSlots safety tests remain. Shell effects remain conservatively classified. Browser URL/revision checks do not freeze remote DOM or prove remote semantics. Full-PC host scope is OS-account reach, not a security sandbox.
