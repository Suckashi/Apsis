# Alpha acceptance and independent-user trial

The source Alpha can be published after reproducible engineering checks pass. That does not establish stable-product readiness. Record automated checks, real model tests and independent-user results separately, with the exact tag/commit and date.

## Engineering release gate

- [ ] Apache 2.0 license and retained third-party notices are in the source archive.
- [ ] English/Traditional Chinese installation guides and local links pass `npm run check:docs`.
- [ ] `npm run build` and `npm test` pass, including the stopped backup/restore integration check.
- [ ] Chat, Bot and settings browser checks pass with isolated fixtures and no unexpected browser errors.
- [ ] The exact tagged commit passes Windows and Ubuntu CI.
- [ ] `npm run test:release` passes: committed source archive can be extracted, installed with `npm ci`, built and started with the documented data-directory behavior.

Use the [release workflow](../.github/workflows/release.yml), browser reports and CI logs as evidence. Checkboxes here are a reusable checklist, not a saved assertion that a particular release has passed.

## Independent-user trial

Invite 3–5 volunteers who have not worked on Apsis. Each uses their own machine, a tagged release, a non-sensitive disposable workspace and a model connection they control. Run the trial for one week. Do not silently guide them through unclear steps; record interventions as onboarding problems. Volunteers choose what sanitized evidence to share; no recruitment or messaging is automated by this plan.

| Scenario                           | Success criterion                                                                                          | Evidence                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Clean install and model connection | Start from the guide; streaming and tool test succeeds; first Bot can work.                                | OS, Node, provider/model, elapsed time, intervention count.                       |
| First file and published result    | Create `hello.md`, read it, download matching content, reload without loss.                                | Sanitized result and operation summary.                                           |
| Small repository change            | Bot changes a disposable clone, gives a truthful result, and produces readable diff/verification.          | Requested change, diff, verification and any corrections.                         |
| Document from sources              | Preview and downloaded file retain required content and sources.                                           | Sanitized sources/result; separate actual Word/PDF checks.                        |
| Scheduled work                     | Timezone, test run, scheduled result and pause behave as described.                                        | Configured timezone and observed run timestamps.                                  |
| Stop and restart                   | Earlier results persist, incomplete work is clearly marked, no external action is silently replayed.       | Before/after records and side-effect inspection.                                  |
| Backup and restore                 | Stopped copy reopens with expected Bots, history, settings and artifact; external paths are accounted for. | Associated release, checklist and comparison.                                     |
| Long task and continuing topics    | Real provider task completes or reports failure truthfully; later topics and history remain usable.        | Provider/model, duration, corrections, failure state and usage/cost if available. |

Track task success as observed, including partial results and manual corrections. The first Alpha has no completed independent-user week or universal model certification claimed by this document.

## Trial report template

Copy this into a sanitized issue or local report:

```text
Release / commit:
Date range:
OS / Node / browser:
Provider type / model (no credentials):
Scenario:
Expected result:
Observed result:
Completed / partial / failed:
Developer interventions and model corrections:
Time and model usage/cost, if available:
Restart/restore checks:
Sanitized evidence:
Reproduction steps for a failure:
```

## Exit review

Before proposing a stable release, review all required scenarios across the trial participants. Fix reproducible data-loss, authorization, misleading-result and installation blockers first. Publish the measured results and remaining limitations, including unsuccessful scenarios. A completed checklist with only fixture results does not satisfy the independent-user or real-model gates.
