# Apsis interface

## Direction

Persistent, conversation-first Bot workspace. Preserve the existing light/dark zinc palettes and colorful Bot avatars. Use whitespace, aligned content and fine separators instead of nested cards. Primary tasks stay visible; supporting information is progressively disclosed. This refinement follows the existing project direction and UI UX Pro Max's general guidelines; its local database search was unavailable in this session.

## Tokens and hierarchy

Source of truth: `public/bot.css` semantic variables, including independently defined light and dark palettes. Kimi Code Web inspired zinc palette: white/light-gray surfaces and charcoal primary actions; near-black background, raised charcoal panels and gray-white primary actions in dark mode. Selection uses neutral gray; blue is reserved for focus, with semantic status colors retained. Reference: https://github.com/MoonshotAI/kimi-cli/blob/main/web/src/index.css. Hex approximations are mapped to Apsis tokens, with secondary text darkened where needed for 4.5:1 contrast. Body/chat text 16px, controls 13–15px, supporting text 12–13px. Small status metadata can be 10–11px. Use 4/8px spacing increments, 10–18px corner radii and restrained borders. No remote font requirement.

## Interaction

Desktop defaults to roster + conversation, with details closed. Store desktop roster/details visibility in `apsis.layout.v1` as `{ list: boolean, panel: boolean }`. Focus mode temporarily hides both sides and restores their previous visibility on exit; it never writes preferences. Explicitly opening a side exits focus mode. Below 1150px, details become an overlay; at 640px and below, roster becomes a drawer. Crossing these layout boundaries closes temporary drawers and exits focus mode. Narrow-screen changes never overwrite desktop preferences.

Messages and composer share an 800px maximum outer width and matching horizontal gutters (32px desktop, 24px small tablet, 16px phone). Composer grows with its text up to 180px/25dvh (80px in short landscape), then scrolls internally. Keep attachment, skill and connector actions available. During a task, distinguish steering, stop and queue-next actions. Preserve independent message scrolling and IME-safe Enter handling.

Details use a compact Bot profile row, then files/results, computer, routines, memory and recent operations. Files/results start expanded; computer expands when connected unless manually toggled. Other sections start collapsed and show counts/status. Expansions are temporary for the mounted Bot details view. Empty sections use short guidance rather than large placeholders. Approvals and errors remain visible in conversation regardless of the details panel. Long delegation prompts and results expand on demand.

Settings retain five categories and on-demand connection forms. Use flat service/model lists with separators, consistent labeled fields and existing status feedback. Phone categories scroll horizontally. Touch controls have at least 44px hit areas. Do not encode work states in color alone.

Native dialogs provide focus trapping, inert backgrounds, Escape dismissal and focus return. Drawers have equivalent keyboard behavior. SVG marks replace font-dependent symbols. Async actions have busy/disabled feedback; copy actions announce completion. Reduced-motion disables decorative animation. Theme preference persists locally.

## Verification

Run `npm run build`, `npm test`, and `npm run test:bots:browser`. Verify desktop preference persistence, focus-mode restoration, responsive drawer isolation, detail expansion, composer growth and IME handling. Check chat and settings in both themes; 375, 768, 1024 and 1440px widths; narrow landscape; enlarged text; modal focus and Escape; no horizontal page overflow. Verify semantic foreground/background color pairs meet 4.5:1. Keep the existing task, approval and artifact flow working. Save desktop, focus, details, settings and mobile screenshots in `artifacts/bot-verification/`.
