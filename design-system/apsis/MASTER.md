# Apsis interface

## Direction

Persistent Bot conversation workspace, following the user's Grok Bot reference. UI UX Pro Max's verified `ai-native-ui` style applies: minimal chrome, neutral surfaces, one accent, clear user messages, streaming state and contextual result cards. Its generic marketing-page layout and purple palette do not fit this application's established direction and are not used.

## Tokens and hierarchy

Source of truth: `public/bot.css` semantic variables, including independently defined light and dark palettes. Kimi Code Web inspired zinc palette: white/light-gray surfaces and charcoal primary actions; near-black background, raised charcoal panels and gray-white primary actions in dark mode. Selection uses neutral gray; blue is reserved for focus, with semantic status colors retained. Reference: https://github.com/MoonshotAI/kimi-cli/blob/main/web/src/index.css. Hex approximations are mapped to Apsis tokens, with secondary text darkened where needed for 4.5:1 contrast. Body/chat text 16px, controls 13–15px, supporting text 12–13px. Small status metadata can be 10–11px. Use 4/8px spacing increments, 10–18px corner radii and restrained borders. No remote font requirement.

## Interaction

Desktop: roster / conversation / optional details. At widths below 1150px, details become an overlay; at 640px and below, roster becomes a drawer. Preserve visible conversation composer and allow independent message scrolling. Mobile controls generally have 44px hit areas. Do not encode work states in color alone.

Native dialogs provide focus trapping, inert backgrounds, Escape dismissal and focus return. Drawers have equivalent keyboard behavior. SVG marks replace font-dependent symbols. Async actions have busy/disabled feedback; copy actions announce completion. Reduced-motion disables decorative animation. Theme preference persists locally.

## Verification

Run `npm run test:bots:browser`. Check chat and settings in both themes; 375, 768, 1024 and 1440px widths; narrow landscape; enlarged text; modal focus and Escape; no horizontal page overflow. Verify semantic foreground/background color pairs meet 4.5:1. Keep the existing task, approval and artifact flow working.
