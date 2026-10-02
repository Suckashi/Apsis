# Agent instructions

Apsis is a local-first Bot workspace powered by Deep Agents. Use the repository's existing documentation as the source for detailed behavior.

## Boundaries

- Use Deep Agents' native `task` for temporary internal subagents and `delegate_task` for persistent Bot collaboration. Do not build a parallel orchestration path. See `CONTRIBUTING.md` under "Code map and conventions" and `docs/architecture.md` under "Boundaries".
- Host commands must use Apsis's guarded Shell tool. Write tools must honor permission checks and operation journaling. Before changing tool authorization or execution, read `docs/architecture.md` under "Permissions and verification" and `SECURITY.md` under "Application boundary".
- Do not commit API keys, `.env`, browser profiles, conversations, local data directories, or private workspace files. Use synthetic data in fixtures and screenshots. See `CONTRIBUTING.md` under "Code map and conventions".

## Verification

- Work from the repository root with Node.js 22.19+ and npm. Install dependencies with `npm ci` when needed.
- For code changes, run `npm run check:docs`, `npm run build`, and `npm test`. For documentation-only changes, run the documentation and changed-file format checks. Report which checks actually ran.
- After a UI or user-flow change, run the relevant browser verifier listed in `package.json`. These use isolated stores and deterministic fixtures; they do not establish live provider behavior.

## Read when relevant

- Before changing product or runtime boundaries, read `CONTRIBUTING.md` under "Code map and conventions" and the relevant section of `docs/architecture.md`.
- Before changing storage, compatibility, backups, or release behavior, read `docs/releases.md` under "Version policy" and "Backup and restore".
- Before changing visible UI behavior, read `CONTRIBUTING.md` under "Code map and conventions" for localization and "Validate your change" for browser verification.
