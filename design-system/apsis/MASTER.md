# Apsis interface

## Direction

Persistent, conversation-first Bot workspace. Use low-saturation neutral surfaces, restrained Apsis purple and three semantic approval-mode colors. Preserve colorful Bot avatars. Use whitespace, aligned content and fine separators instead of nested cards. Primary tasks stay visible; supporting information is progressively disclosed. Preserve navigation, public settings values and permission rules. This refinement follows UI UX Pro Max's general guidelines; its local database search was unavailable in this session.

## Tokens and hierarchy

Source of truth: `public/bot.css` semantic variables, independently defined for light and dark themes. Purple identifies primary actions, the current navigation selection and keyboard focus. Light mode uses `#6D28D9` actions and `#EDE9FE` selections; dark mode uses `#B59AFF` actions and `#302640` selections. Composer surfaces remain neutral, with a soft border and purple focus treatment. Body/chat text is 16px, controls 14px, supporting text at least 12px. Chinese system fonts include Microsoft JhengHei UI, Microsoft JhengHei and PingFang TC. Use 4/8px spacing increments and restrained borders. No remote font requirement.

## Approval modes

`public/approval-mode-picker.tsx` owns the shared mode labels, icons, help and selection component used by conversation and settings. Colors are semantic CSS tokens, never a substitute for names, icons or the selected check mark.

| Value    | Label                        | Icon                      | Light / dark foreground |
| -------- | ---------------------------- | ------------------------- | ----------------------- |
| `manual` | 一般核准 / Manual            | Shield                    | `#2563EB` / `#93C5FD`   |
| `yolo`   | 需要時詢問 / Ask when needed | Shield with question mark | `#A16207` / `#FCD34D`   |
| `auto`   | 不要求核准 / Never ask       | Lightning                 | `#BE123C` / `#FDA4AF`   |

Use mode color only on mode icons, labels and selected/hovered options; do not tint the entire composer. The composer trigger displays icon, current mode and chevron. Its popover directly exposes three rows with a selected check, then “所有 Bot · 下次操作生效” and collapsed “模式說明”. Settings uses the same three rows. Long permission details remain available on demand; errors and pending approvals stay visible.

Composer selection saves immediately, prevents duplicate submissions and closes only after success. Settings selections remain drafts until Save. Failed saves keep the error and actual effective mode visible; conflicts reload current settings through the existing flow. Arrow/Home/End keys move focus; Enter/Space confirms; Escape dismisses and returns focus to the trigger. Keep `manual / yolo / auto`, settings revisions and API contracts unchanged.

## Interaction

Desktop defaults to roster + conversation, with details closed. Store desktop roster/details visibility in `apsis.layout.v1` as `{ list: boolean, panel: boolean }`. Focus mode temporarily hides both sides and restores their previous visibility on exit; it never writes preferences. Explicitly opening a side exits focus mode. Below 1150px, details become an overlay; at 640px and below, roster becomes a drawer. Crossing these layout boundaries closes temporary drawers and exits focus mode. Narrow-screen changes never overwrite desktop preferences.

Messages and composer share an 800px maximum outer width and matching horizontal gutters (32px desktop, 24px small tablet, 16px phone). Composer grows with its text up to 180px/25dvh (80px in short landscape), then scrolls internally. Keep attachment, skill and connector actions available. During a task, distinguish steering, stop and queue-next actions. Preserve independent message scrolling and IME-safe Enter handling.

Details use a compact Bot profile row, then files/results, computer, routines, memory and recent operations. Files/results start expanded; computer expands when connected unless manually toggled. Other sections start collapsed and show counts/status. Expansions are temporary for the mounted Bot details view. Empty sections use short guidance rather than large placeholders. Approvals and errors remain visible in conversation regardless of the details panel. Long delegation prompts and results expand on demand.

Settings retain five categories and on-demand connection forms. Use flat service/model lists with separators, consistent labeled fields and existing status feedback. Phone categories scroll horizontally. Touch controls have at least 44px hit areas. Do not encode work states in color alone.

Native dialogs provide focus trapping, inert backgrounds, Escape dismissal and focus return. Drawers have equivalent keyboard behavior. SVG marks replace font-dependent symbols. Async actions have busy/disabled feedback; copy actions announce completion. Desktop secondary message actions appear on hover/focus; touch actions stay visible with at least 44px targets. Transitions take 120–180ms and respect reduced motion. Theme preference persists locally. The compact composer tool trigger reads “工具”, with attachments, skills and connectors grouped inside.

## Verification

Run `npm run check`, `npm run build`, `npm test`, `npm run test:bots:browser` and `npm run test:settings:browser`. Verify all three approval modes, immediate versus draft saves, conflict recovery, cross-window updates and keyboard selection. Verify desktop preference persistence, focus-mode restoration, responsive drawer isolation, detail expansion, composer growth and IME handling. Check chat and settings in both themes and both locales; 375, 768, 1024 and 1440px widths; narrow landscape; 200% text; modal focus and Escape; no horizontal page overflow. Verify text and semantic foreground/background pairs meet 4.5:1. Keep the existing task, approval and artifact flow working. Save screenshots in `artifacts/bot-verification/` and `artifacts/settings-verification/`.
