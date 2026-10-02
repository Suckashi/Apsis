# Tool approval modes

Apsis applies deterministic policy outside model discretion. Whole-computer scope describes the reach of the host OS account; it is not unrestricted permission, an OS sandbox, or universal native-app control.

Every mode enforces readonly constraints and explicit denies. Critical and unknown effects always require fresh approval before allow rules, remembered grants or mode defaults. The older `dangerousCommandGuard` preference cannot disable this mandatory boundary.

| Mode   | Ordinary, classified operations                                                                                                 | Critical or unknown effects |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Manual | Reads may proceed; other operations generally ask. New non-sensitive files in a Git workspace can follow existing write policy. | Fresh approval              |
| Yolo   | Ordinary operations proceed unless a rule asks or denies.                                                                       | Fresh approval              |
| Auto   | Ordinary operations proceed subject to hard constraints and denies.                                                             | Fresh approval              |

The shared classifier covers file, shell, browser, MCP and model-facing product tools. Existing-file overwrite/edit, deletion, sensitive credentials/security paths, persistent instruction writes, privilege/security changes and untrusted execution require consent. Only a small exact shell inspection allowlist is treated as read-only; arbitrary commands and scripts are not assumed safe. Arbitrary URL fetches, MCP calls and browser mutations/navigation are unknown effects and ask. `verify_web` executes workspace JavaScript in a disposable browser with external networking blocked, and requires consent.

Approval identifies its owning job, session and run, operation, arguments, target/context and impact. It binds the exact call, current policy, workspace, connector configuration and file identity/revision. Browser calls include the owned page and a projection of the selected element's attributes and label. These are rechecked inside serialized execution. A changed fingerprint asks again; critical/unknown approvals cannot be remembered. Ordinary remembered approvals apply only within their original run, not to descendants or retries.

Native Deep Agents subagents inherit guarded tools. Persistent background work and routines use the same checks. A new invocation or retry cannot reuse critical consent. An explicit user Send on an editable connector draft is consent to that exact submission; connector, readonly and deny checks still apply. Ambiguous outcomes are marked unknown rather than automatically resent.

This is conservative application policy, not proof of every OS or remote effect. Shell programs, externally modified files, shared browser cookies, changing remote DOM and server-side semantics remain limits. A target snapshot does not freeze a remote application. Stop does not undo completed operations. Restart expires pending approvals and preserves interrupted/unknown evidence without replaying external effects.

See [single-assistant design and limitations](single-assistant.md) and [security policy](../SECURITY.md).
