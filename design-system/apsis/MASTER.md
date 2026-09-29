# Apsis interface

## Product direction

Apsis is a conversation-first workspace for a team of Bots. Every work surface should make four things clear: the current Bot and task, the current action, whether the user needs to respond, and where to inspect the result. Preserve colorful Bot avatars, independent tasks, projects, shared Skills and permission enforcement. Use short summaries with expandable, chronological evidence.

Keep the existing neutral surfaces, Apsis purple and system fonts. UI UX Pro Max's dashboard search supports restrained typography, minimal surfaces, visible focus and purposeful motion. Its marketing-page layout suggestions do not apply to this workspace. The approved Apsis direction takes precedence over generated palette or font suggestions.

## Layout and navigation

- The desktop roster is 256px. It identifies Bots and their nested tasks, and offers project navigation. Show one highest-priority status: needs attention, running, then unread. Project task groups point to the same tasks; do not add a separate overview or inbox.
- The central conversation and composer share an 800px maximum outer width. Use 32px horizontal gutters on desktop, 24px on small tablets and 16px on phones. The conversation has relaxed spacing; task and file lists are denser.
- The inspector starts closed. Its primary entries are Files and Changes. Open files, diffs and plan documents in this same inspection area. Desktop width starts at 380px, is adjustable between 300px and 640px, and must leave at least 480px for the discussion. At less than 1150px the inspector overlays the workspace; on phones it fills the width and provides a close/return action.
- Preserve desktop roster and inspector visibility preferences, temporary focus mode, per-conversation draft and reading position, and task inspection state. Temporary phone drawers must not overwrite desktop choices.
- Settings have three primary categories: General, Models and Templates. Advanced controls, remembered approvals, MCP and shared Skills remain available through their existing secondary surfaces. Do not restore removed navigation categories.

## Conversation and composition

Reading order is the user's request, Bot commentary, expandable work evidence, final answer, then relevant results and verification. Tool commands, raw output and JSON remain accessible in details. Do not collapse the final answer into work history. Keep manually expanded history open and preserve reading position when streaming or loading history.

The current progress strip has two rows: current action and elapsed time; last update or required response and the appropriate action buttons. A connection interruption is independent of execution state. Say that the task may still be running and retain its last known status. Never infer failure from a quiet period or invent a percentage.

Use shared conversation primitives, progress, run history and approval presentation for the Bot conversation and task discussion. Completion of a response is distinct from verified success. Missing verification means “尚未驗證 / Not verified”; operation warnings remain visible. Ordinary replies have a quiet history entry instead of a prominent completion badge.

The idle composer targets 112–144px on desktop and 96–120px on phones, excluding error, approval or active-work notices. Its text grows up to 180px or 25dvh (120px on phones), then scrolls internally. The control row contains tools, Work options, searchable model selection, approval mode and send. Phones move model selection into the compact Work options bottom sheet. Work options explicitly label Work location and Mode: direct execution or plan first. Retain attachment, Skill and connector access.

During execution distinguish supplemental instructions, queued next work and stop. A submitted instruction remains “pending” until the runtime confirms adoption. Unavailable models show the reason and the corresponding Bot model repair entry point without discarding the draft. IME composition must never trigger send.

Model selection is searchable by model and provider, exposes the current selection, supports keyboard navigation and commits after a successful save. Failed changes retain the effective selection and display an actionable error.

## Visual and interaction rules

`public/bot.css` owns theme tokens. Purple denotes primary action, current selection and focus. Use amber for required attention, red for failures and green only for supported success. Body/chat text is 16px with a 1.6 line height, controls 14px and supporting text 12–13px. Use 4/8px spacing increments, fine separators and neutral surface layers rather than nested cards. Chinese system fonts include Microsoft JhengHei UI, Microsoft JhengHei and PingFang TC; remote fonts are unnecessary.

`public/approval-mode-picker.tsx` owns mode names and help. The compact trigger stays neutral so a configured policy cannot be mistaken for a pending approval. Mode colors appear inside the selection menu together with icons, labels and a selected check. Preserve the `manual / yolo / auto` values and existing authorization policies. Global scope and when a changed policy takes effect must remain explicit. Composer selection saves immediately; settings are drafts until Save.

Approval cards first explain the action, target and impact, followed by Approve/Reject. Raw arguments belong under Technical details. Long targets wrap safely. Native dialogs trap focus, inert the background, dismiss with Escape and return focus to their trigger. Selection menus support keyboard control and retain visible focus. Interactive touch targets are at least 44px. SVG icons have labels when they are actions; color alone never communicates state.

Motion must communicate an actual state:

| State                                          | Treatment                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Waiting for model                              | A slow orbit beside an explicit waiting label                    |
| Current operation                              | A subtle sweep across only the current action text               |
| Streaming response                             | Natural text arrival; no repeated animation of entire paragraphs |
| Queued, awaiting approval, failed, interrupted | Static clock, question or state mark and concrete text           |
| Verified completion                            | A single 180ms acknowledgment; static afterward                  |
| Menus and small feedback                       | Restrained 160–200ms transitions                                 |

Do not animate every tool row or Bot avatar. `prefers-reduced-motion` removes animation, movement and smooth scrolling while retaining all textual state information. Automatic scrolling follows new work only while the reader is at the end; “回到最新 / Back to latest” resumes following.

## Verification

Run type checking, build and the relevant existing browser suites with isolated data. Cover readable model failure states, complete task work, approval, queued and adopted instructions, stop, plan confirmation, files and diffs. Verify that Bot, task and roster summaries agree, and that historical records do not gain invented progress or verification.

Inspect light and dark themes, Traditional Chinese and English at 1440, 1280, 1024, 768, 390 and 375px. Check no page-level horizontal overflow, 200% text zoom, narrow landscape, visible keyboard focus, Escape and focus return, reduced motion, phone keyboard input, long paths, and a searchable model list. Test panel resizing without shrinking the discussion below 480px, switching conversations without losing drafts or reading position, and streaming while the user reads older messages. Text and semantic foreground/background pairs must meet 4.5:1 contrast.

Record actual checks and screenshots in the task report. Fixture-driven UI verification and live model execution are different forms of evidence and must be reported separately.
