# write-agents-md

**English** | [繁體中文](README.zh-TW.md)

A skill for creating, auditing, and refactoring high-quality `AGENTS.md` files.
Inspect repository evidence, keep essential instructions, and route detailed knowledge to existing documentation when relevant.

Version: **1.0.0** · Research reviewed: **2026-10-01** · License: **MIT**

## Install

### With the skills CLI (recommended)

Run this command from the repository where you want to use the skill:

```bash
npx skills add Suckashi/write-agents-md
```

Requires Node.js/npm and Git. Follow the CLI prompts to choose your agents and installation method. Project installation is the default; add `--global` to use it across projects.

```bash
# Install globally
npx skills add Suckashi/write-agents-md --skill write-agents-md --global

# Install for Codex, OpenCode, and Kimi Code in this project
npx skills add Suckashi/write-agents-md --skill write-agents-md --agent codex opencode kimi-code-cli

# Install for Claude Code in this project
npx skills add Suckashi/write-agents-md --skill write-agents-md --agent claude-code

# List available skills without installing them
npx skills add Suckashi/write-agents-md --list
```

If symlinks are unavailable, including on some Windows setups, add `--copy` to an installation command. The installer handles the skill's supporting files; keep `references/` with `SKILL.md`.

This repository includes `SKILL.md` at its root, which the CLI supports directly. No separate npm package or registry submission is required for installation from GitHub. See the [skills CLI documentation](https://github.com/vercel-labs/skills) for current options and agent support.

### Manual installation

Copy the complete repository contents into the appropriate project directory:

| Agent | Project directory |
| --- | --- |
| Codex / OpenCode / Kimi Code | `.agents/skills/write-agents-md/` |
| Claude Code | `.claude/skills/write-agents-md/` |

For example, from your target repository's root:

```bash
git clone https://github.com/Suckashi/write-agents-md.git .agents/skills/write-agents-md
```

For Claude Code, change the destination to `.claude/skills/write-agents-md`. Check your agent's skill list or loading information after installation; discovery can depend on the version, worktree, session, and organization settings.

Agent documentation: [Codex](https://developers.openai.com/codex/skills) · [OpenCode](https://opencode.ai/docs/skills/) · [Kimi Code](https://moonshotai.github.io/kimi-code/en/customization/skills) · [Claude Code](https://code.claude.com/docs/en/skills).

## Use

Start with an audit of existing instructions, then request changes when ready. The skill and reference files are written in Traditional Chinese. You can request responses in your preferred language; the workflow preserves the repository's existing language conventions.

| Agent | Explicit invocation |
| --- | --- |
| Codex | `$write-agents-md` |
| Kimi Code | `/skill:write-agents-md` |
| Claude Code | `/write-agents-md` |
| OpenCode | Ask the agent to load the `write-agents-md` skill. |

Example request after invoking the skill:

```text
Audit this repository's AGENTS.md using write-agents-md.
Do not modify files. Identify what to keep, move, remove, or clarify,
and provide repository evidence for each recommendation.
```

### Modes

Modes are natural-language instructions to the agent, not executable CLI flags.

| Mode | Behavior |
| --- | --- |
| `audit` | Default. Read-only review with evidence and a proposed diff; no file changes. |
| `create` | Add missing instructions after verifying commands and rules; preserve existing entry points. |
| `refactor` | Make minimal authorized edits, retaining valid constraints and uncommitted changes. |

```text
Use write-agents-md in create mode to add the missing AGENTS.md.
Verify commands and rules first, and reuse existing documentation.
Report unconfirmed policies separately.
```

```text
Use write-agents-md in refactor mode to simplify the existing AGENTS.md.
Preserve valid constraints and add conditional routes to detailed documentation.
Do not modify application code, dependencies, CI, or tool settings. Do not commit.
```

## What it does

1. Inspect existing instructions, manifests, lockfiles, scripts, CI, and relevant documentation.
2. Record evidence and distinguish verified information from executed checks and unresolved conflicts.
3. Decide whether each item belongs in the root, a scoped instruction file, documentation, a skill, or a tool-enforced check.
4. Produce a minimal entry point with clear commands, boundaries, and conditional document routes.
5. Check links, scope, conflicts, and loading assumptions; report what was and was not tested.

The workflow reuses existing `CONTEXT.md`, `docs/agents/`, and `docs/adr/` structures when present. It works alongside workflows such as `dev-workflow-tdd` and `grill-with-docs`.

## Contents

| File | Purpose |
| --- | --- |
| [SKILL.md](SKILL.md) | Core workflow, modes, evidence rules, and boundaries. |
| [references/templates.md](references/templates.md) | Minimal entry points, conditional routes, and examples. |
| [references/compatibility.md](references/compatibility.md) | File types, loading behavior, and cross-agent compatibility. |
| [references/source-notes.md](references/source-notes.md) | Research sources, adopted principles, disagreements, and limitations. |
| [references/evaluation.md](references/evaluation.md) | Static checks, loading checks, and behavioral evaluation guidance. |
| [evals/evals.json](evals/evals.json) | Ten evaluation scenarios for manual use or a custom harness; not an executable test runner. |
| [validation-report.md](validation-report.md) | Original package validation results and untested areas. |

References are loaded when relevant. Research combines official documentation, original authors' articles, and papers; attribution and qualifications are retained in the source notes.

## Validation and limitations

The package has undergone static structure checks. The ten behavioral scenarios have **not** been run end-to-end across the supported agents or a user's real repository. No improvement in task success rate, cost, or token usage is claimed.

Instructions guide behavior; enforce permissions and irreversible-operation boundaries through the actual tools and execution environment.

## License

[MIT](LICENSE). Referenced sources retain their respective authors' rights. This is an independently authored skill, with no official affiliation or endorsement from the cited authors or agent vendors.
