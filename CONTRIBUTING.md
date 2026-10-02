# Contributing to Apsis

Start with the [README](README.md), [documentation index](docs/README.md), [architecture](docs/architecture.md), and [roadmap](docs/roadmap.md).

## Choose a contribution

- Reproduce a bug with OS, Node version, release/commit, provider type and sanitized steps.
- Improve a getting-started instruction or translation you can verify locally.
- Add a focused regression for a confirmed failure or improve an acceptance scenario.
- Discuss changes to product scope, storage, permission behavior or runtime architecture in an issue before a substantial implementation.

The maintainer reviews and merges PRs, selects release scope and updates the roadmap. Alpha support focuses on the latest prerelease; response times are best effort. Follow the [conduct policy](CODE_OF_CONDUCT.md). Security issues use [private reporting](SECURITY.md).

## Development setup

Requires Node.js 22.19+ and npm. Windows and Ubuntu on Node.js 22.19 are the CI baseline. Install Git for Windows to provide Bash on Windows; Linux uses system Bash.

```sh
git clone https://github.com/Suckashi/Apsis.git
cd Apsis
npm ci
npx playwright install chromium
npm run dev
```

Linux may require `npx playwright install --with-deps chromium`. Open <http://localhost:3100>. Configure a model connection in **Settings & Tools → Model connections** for manual model testing. Automated tests use isolated stores and fixtures and do not need paid model credentials.

Use an optional `.env` with `APSIS_DATA_DIR` pointing to a separate absolute directory for manual development. Keep a stopped backup before testing storage changes. Restart recovery preserves records but does not undo external actions.

## Code map and conventions

| Area                               | Entry point                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Composition and lifecycle          | `server/product.ts`, `server/app.ts`                                             |
| Domain behavior                    | `server/*-service.ts`                                                            |
| HTTP contracts                     | `shared/api.ts`, `server/routes/`, `server/request-schema.ts`                    |
| Model runtime and native subagents | `server/engines/deep.ts`, `server/deep-observation.ts`                           |
| Tool authorization and evidence    | `server/tools.ts`, `server/policy.ts`, `server/runs.ts`                          |
| Conversation UI                    | `public/bot.tsx`, `public/conversation-messages.tsx`, `public/chat-composer.tsx` |
| Tests and browser fixtures         | `test/`, `scripts/verify-*.ts`                                                   |

Keep the core Node-only and cross-platform. Use strict TypeScript and built-in Node APIs where practical. Add integrations as server-side adapters. Deep Agents native `task` handles ephemeral subagents; persistent independent work uses `start_background_work`. Host execution must use the guarded Shell tool. Write tools must honor permissions and operation journaling.

Show observable progress, results and uncertainty; do not expose private model reasoning or invent successful execution. Keep advanced UI details collapsed and approvals visible. Add fixed UI strings to the relevant localization dictionary and check both languages when changing a flow.

Never commit API keys, `.env`, browser profiles, conversations, local data directories or private workspace files. Use synthetic data in fixtures and screenshots.

## Validate your change

```sh
npm run check:docs
npm run build
npm test
```

Run relevant browser checks after a UI or user-flow change:

```sh
npm run test:assistant:browser
npm run test:settings:browser
```

Other focused verifiers are listed in `package.json`. Record the checks you ran and distinguish deterministic evidence from real provider testing. Add meaningful regressions for behavior changes; documentation-only changes need link/format checks, not a unit test for each sentence.

Format changed files with `npx prettier --write <paths>`. Avoid reformatting unrelated files. Update English and Traditional Chinese READMEs, current guides and known limitations when behavior changes. Historical design records remain historical; they should not override current implementation.

## Submit a pull request

All changes, including documentation, go through **branch → PR → CI → merge**. Create a focused branch from the latest `main`; external contributors can use a fork. Push the branch and open a PR targeting `main` with a title describing the resulting behavior. Explain the problem, change and validation; include sanitized screenshots for visible UI changes. Call out data-format changes, permission changes and anything still unverified.

The active [Protect main ruleset](https://github.com/Suckashi/Apsis/rules/24344036) requires:

- A pull request for every change to `main`; direct pushes are blocked.
- Successful `verify (ubuntu-latest)` and `verify (windows-latest)` checks from GitHub Actions. These verify type checking, documentation, tests and core browser flows on both platforms.
- A branch updated with the latest `main` and passing CI before merging. Update the branch and let CI finish again if `main` changes.
- Resolution of all review conversations before merging.

Force pushes and deletion of `main` are blocked. There are no bypass actors, including administrators. Do not disable or bypass protection to land a change. The ruleset currently requires zero approving reviews so a solo maintainer can merge their own PR once every requirement passes; this does not remove the PR or CI requirements.

After merging, confirm the resulting `main` CI run succeeds before tagging a release. Follow the [release procedure](docs/releases.md) for tag and publication checks.

Contributions submitted for inclusion in Apsis are licensed under Apache License 2.0. Retain original third-party notices and explain the source/license of copied code. There is currently no separate CLA. Release procedure and compatibility rules are in [version and backup policy](docs/releases.md).
