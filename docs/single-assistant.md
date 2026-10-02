# Single-assistant development phase

This is the schema-5 development design, not a release announcement. Apsis has one personal assistant and one ongoing main conversation. Background work is expandable, durable work owned by the same assistant, not a roster of persistent identities. All 48 original avatars remain directly selectable. Role templates, roster creation, manual Bot delegation and topic-reset controls are absent from the active interface.

## Execution ownership

`JobService` uses the existing TaskService and Deep Agents runtime. Each background submission, routine or explicit background retry receives a new session and WorkContext. Ordinary chat keeps the main session. `start_background_work` returns a job/session receipt immediately; native Deep Agents `task` remains temporary within-run delegation. There is no second agent execution engine.

Every admitted job persists its session ID. Runs include job/session IDs and their resolved model; TaskService clones configuration before execution. Steering registration uses session IDs. Work control requests bind job, session and run IDs; a stale target returns 409. Chat stop cancels only main-session work. Approvals carry job/session/run IDs. SSE events include those identifiers and persisted event cursors. Browser pages use execution-session ownership and browser actions within a session serialize. The dedicated browser profile still shares account cookies; tab ownership is not account isolation.

Main chat retains one admission slot. Background execution shares a bounded `maxConcurrent` pool (there can therefore be at most `maxConcurrent + 1` admitted persistent jobs). A job's runtime settings are captured at start, and descendants inherit them. Background fan-out and depth use the existing limits. Same/overlapping work folders serialize before consuming an execution slot; new independent work receives separate folders, and scheduled repository work retains existing worktree isolation. Approval waits release execution capacity but retain their workspace reservation. Shell execution is serialized across sessions; browser execution is serialized per session before final permission recheck.

Jobs retain terminal results. The main transcript receives a deterministic `work-result-<jobId>` message, checked before append, and the job records delivery. Restart reconciles journals and committed transcripts, expires approvals and marks interrupted/unknown operations; it never reruns external actions automatically. An explicit retry is new work, not evidence that a previous external effect failed.

The retained internal `Bot`/`botId` names identify the single assistant profile in existing services; they are not a multi-Bot import or compatibility layer. Some internal data utilities and historical test fixtures still use these names.

## Mandatory approval

`action-effects.ts` is shared deterministic application policy. Denies and readonly constraints remain authoritative. Critical and unknown effects require fresh consent before allow rules, remembered grants, yolo or auto can apply. Disabling the older dangerous-command preference cannot disable mandatory checks. Children, scheduled work, retries and alternate tool paths use the same gate.

Critical effects include destructive host commands, existing-file writes/edits, sensitive credential/configuration targets, persistent instructions, privilege/security changes, untrusted execution and consequential external actions. MCP and browser mutations/navigation are conservatively unknown. Only a small set of exact shell inspection commands is classified as read-only; unknown shell programs/scripts require approval. New ordinary workspace files may be allowed, with the target rechecked before execution.

Approval displays the operation, exact arguments, owning work and impact. Fingerprints bind run, workspace, arguments, policy, connector configuration and file target identity/revision. Browser fingerprints include owned page URL and activity/navigation revision. A changed fingerprint requires another approval. Critical approvals cannot be remembered. Explicit user Send on an editable connector draft authorizes that exact submission; deny/readonly/connector checks still apply and ambiguous outcomes are not retried.

This is **not an OS sandbox**. Shell runs with its OS account's reach. No host privilege or security setting is changed by this redesign. Shell string classification cannot determine all operating-system effects; background processes, external edits, dynamic DOM changes and shared remote accounts remain limits. Browser fingerprints do not prove a remote server's semantics or freeze its DOM. Workspace locking prevents application-owned overlapping workspace runs, not arbitrary programs or approved host commands launched outside those folders. Native desktop adapters and universal native app control are deferred.

## Data and interface

The default data directory is `.apsis-v5/`. Schema 4 and older custom stores are rejected before databases open. Existing `.apsis-v4/` and `.apsis/` directories are left intact; there is no migration, import or deletion UI. Start with a new empty directory, and retain old stores/backups with their matching release.

The selected original avatar has lightweight motion only for observed running state. Labels derive from real lifecycle and tool progress. Approval pauses motion; failure/interruption and loss of connection have distinct states. After 60 seconds without progress, motion pauses with an explicit stale-progress label. Reduced motion disables animation. Completion has only a brief nod. Chat and background work have separate labels and controls.

## Verification and current limits

`test/single-assistant.test.ts` covers overlapping chat/background execution, model isolation, exact steering/stop targets, critical consent, changed targets, deduplicated results, restart, old-data preservation, workspace contention and capacity. Existing native-subagent, policy, journal, file, cancellation and RunSlots tests remain applicable. `scripts/verify-assistant.ts` exercises desktop/mobile chat, background work, approvals, errors, disconnect/reconnect, reduced motion and reload with a deterministic fixture. Settings retains its separate browser verifier. These fixtures do not establish real-model reliability and use no paid provider.

Windows and Ubuntu are the CI platforms. macOS is not validated. Apsis must stay running for background jobs and routines. Full native desktop control, cloud always-on operation and broader proactive exploration are deferred. PR tracking registered from a background context is stored there; the current automatic PR-follow-up poller still follows the main context only. Broader background-context PR follow-up is not claimed by this phase.
