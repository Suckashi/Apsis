# Tool approval and Bash

Apsis uses deterministic Kimi-style tool approval. No model request is made to
review a tool call. The parser and dangerous-command detector are adapted from
MoonshotAI/kimi-code commit `be7d5f5fea7800778e4660cd5f36780ba783bddd`, with the MIT
license and adaptation notes in `server/vendor/kimi-bash/`.

## Modes

Choose **Settings → Execution & language → Tool approval mode**.
You can also open **Ask when needed** (or the current mode) in the
conversation input toolbar and choose one of the three colored rows to switch
immediately, including while a task is running. This changes the same global
setting for all Bots and takes effect on the next tool operation. It does not
send a message to the model. Concurrent settings edits are rejected and reloaded
instead of overwriting someone else's changes.
The conversation menu saves immediately and closes on success; settings keeps a
draft until **Save changes**. Blue shield means Manual, amber shield/question means
Ask when needed, and rose lightning means Never ask. Names and check marks also
identify each choice. Detailed rules are collapsed under **About modes**.

| Mode                                               | Behavior                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `manual`                                           | Default read tools and eligible Git workspace file writes are allowed; other tools ask.                         |
| `yolo` (default, including existing installations) | Ordinary operations are allowed after earlier policies. Unanalyzable commands also pass.                        |
| `auto`                                             | No tool approval prompts, including dangerous commands; explicit denies and hard capability limits still apply. |

Hard capabilities (readonly, connector selection, file grants, and existing file
workspace/symlink/hidden-file restrictions) are checked independently. Then the
policy order is: configured deny → dangerous command ask (except auto) → auto allow
→ task approval history → configured ask → configured allow → sensitive file /
Git control path ask → yolo allow → default tools / Git workspace writes → ask.
Ancestor rules are included for delegated work and scheduled routines. Background
jobs do not silently switch to auto mode. Changing approval settings affects the
next tool operation; unrelated execution limits remain snapshotted per job.

The guard recognizes Kimi's command list, wrappers and nested shell/eval syntax.
It preserves the upstream recursive+force rm rules and /tmp and /temp exceptions.
It is not a proof of safety, a sandbox, an interpreter for arbitrary programs, or
a scanner of npm scripts. Package installs, network commands, MCP calls and
browser mutations have no separate mandatory confirmation in yolo/auto.
Sensitive-path policy uses structured file targets; it does not inspect all file
accesses performed by shell commands. Existing hidden-file restrictions can still
reject an operation even after approval.

`dangerousCommandGuard` defaults to true and is an advanced setting; it is ignored
in auto mode. A shell PermissionRule may add `commandPattern`, a whole-command
glob with `*`, `?` and backslash escaping. Wildcards include slash and newline.
Other rule fields keep their existing meaning. `POST /api/v2/permissions/preview`
uses the same policy and creates neither an execution nor an approval grant.

## Remembered approvals

**Allow for this task** remembers the exact tool, arguments and workspace in the
original work context. Parent grants are inherited by its delegated descendants;
child grants do not authorize parents or siblings. They survive retries/resuming
the same context and do not apply to a new task or an independent scheduled run.
Dangerous and unanalyzable-command guard requests cannot be remembered.

Legacy permanent approvals remain visible as inactive history. Current grants
and legacy records can be removed in Auto approvals. Approval receipts bind the
arguments and permission state; changed settings, revoked grants or changed
ancestor rules are checked again after waiting and immediately before execution.
Arguments are copied before async authorization so callers cannot substitute a
different operation. A process restart expires pending approvals without replay.

## Bash on Windows and Linux

Windows requires **Git for Windows**. Apsis finds its native `usr/bin/bash.exe`
(rather than the Windows WSL launcher); Linux uses `/bin/bash`, then PATH.
Set `APSIS_SHELL_PATH` to an absolute Bash executable path to override detection.
An invalid override disables Shell rather than falling back to another shell.
When Bash is missing, other tools still work and the task activity explains setup.

The public `shell` tool still accepts `command` and optional `timeout` in seconds.
It starts in the native project directory with Bash syntax, no profile/rc loading,
filtered environment, hidden Windows windows, bounded output and the existing
1–120 second timeout. Windows drive paths are also presented to the model as Bash
paths (for example `D:\Code\Apsis` → `/d/Code/Apsis`). Old PowerShell history is not
rewritten or replayed. Cancellation targets the launched process group, including
background processes; Windows resolves the precise MSYS group from its native PID.

## Verification

`npm run check`, `npm test`, `npm run test:settings:browser` and
`npm run test:bots:browser` cover policy, task scopes, approval changes, real Bash
execution and the interface. GitHub Actions runs them on Windows and Ubuntu.
Dangerous-command tests parse commands or use fake effects; they never execute
the destructive examples. Browser fixtures use no external model accounts.
