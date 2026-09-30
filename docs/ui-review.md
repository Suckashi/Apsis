# UI review: conversation and task workspace

## Conversation workspace refinement (2026-09-29)

The follow-up review focuses on whether users can identify their current work,
understand progress, act on a request, and inspect the result. The implementation
uses the approved three-part layout: Bot/task navigation, conversation, and an
on-demand Files/Changes inspector. The current design source of truth is
[`design-system/apsis/MASTER.md`](../design-system/apsis/MASTER.md).

The roster is 256px and the conversation/composer share an 800px maximum outer
width. The inspector starts at 380px, supports resizing on wide screens, and
becomes an overlay or full-width inspection surface when space is limited. The
main composer uses one control row and a compact Work options sheet. Mobile model
selection belongs in that sheet; desktop model selection supports search and
provider grouping. Approval policy triggers stay neutral, reserving attention
color for an actual pending request.

Bot conversations and task discussions share progress, readable approvals, work
history and composer primitives. The progress strip uses two rows and separates
connection health from execution state. Tool evidence remains expandable; final
answers remain readable. A completed response does not imply successful
verification, and failed operations retain their warning. Empty or quiet chat
records receive less visual emphasis.

Motion is limited to the current action: a slow waiting orbit, a subtle text
sweep for a running operation, and a one-time completion acknowledgment. Queued
work, required approvals and failures remain static. Tool rows and avatar status
dots do not continuously animate. Reduced motion leaves every state readable.

Design references are the previously reviewed
[Kimi Code Web](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/web.html),
[DeepSeek Harness chat components](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/README.md),
and Codex progress/review flows. The adaptation is specific to Apsis's multi-Bot
workspace; it does not replace its product model or permission semantics.

Acceptance covers the same work state in Bot, task and sidebar surfaces, model
repair without draft loss, readable approval action/target/impact, preserved
reading position while streaming, draft retention on task switches, keyboard
selection and focus return, responsive inspection, and no horizontal overflow.
Check both themes and locales at 1440, 1280, 1024, 768, 390 and 375px, including
200% text scaling and reduced motion. Record fixture UI tests separately from
live model execution; the checklist is not evidence that a live run occurred.

The isolated `scripts/verify-mobile-composer.ts` fixture passed after this
refinement. It checks 320/375/390/430px phone widths, 768/1024/1280/1440px desktop
geometry, 44px non-overlapping controls, preserved project/branch/mode/draft,
onscreen approval menus, phone Enter behavior, light/dark themes and a 390×420
available viewport while work is running. Screenshots are under
`artifacts/mobile-composer/`. The short viewport simulates keyboard space; real
iOS/Android keyboard behavior and live model quality are outside that fixture.

The implementation also stores real steering delivery receipts: pending when
received, applied only when included in the next model turn, and not applied when
stopped, failed, finished without consumption, or recovered after a restart.
Receipt states do not assert task success. Per-task draft, reading position,
selected inspection panel, diff file and preview file are restored independently.
Model setup errors prevent submission and keep the draft with a repair entry.

Final validation: all 234 unit/integration tests and the build pass. Browser
fixtures cover the main Bot workflow, settings in both locales, task planning and
execution, files/previews, mobile composition, expanded tool evidence, and the
new workspace model-picker/steering flows. Screenshot directories are under
`artifacts/`. Models are deterministic local substitutes; no real provider run or
native mobile keyboard session is claimed.

## Provider configuration reference and scope

Reviewed the chat footer, task history, provider settings, connectors, skills,
advanced approval history, profile/details and responsive layouts. The reference is
[DeepSeek Harness's model configuration](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers):
provider-first organization, credentials separate from model catalogs, model
discovery with searchable selection, and manual model IDs as a fallback.
This is an adaptation to Apsis's existing adapters, not an implementation of
every protocol or advanced field supported by the reference product.

## Changes

- Work history appears before the corresponding final answer; relevant artifacts
  follow that answer. Reply/copy actions remain in the compact message footer.
  Zero operations and sub-second duration are omitted from history summaries.
- Connection errors have a readable explanation with the original error retained
  in an expandable detail. This changes presentation, not retry behavior.
- Settings use a stable-size shell so switching categories does not move the
  navigation or close button. Shared spacing, borders and theme tokens remain.
- Providers have a dedicated overview, add-provider catalog and editor. The catalog
  supports OpenAI, Anthropic, Ollama and OpenAI-compatible providers.
- Model discovery is opt-in: fetching does not select or save every model.
  Search, checkboxes and manual IDs control the catalog. Existing selections are
  preserved; deselection can be undone before saving.
- Saving a provider does not explicitly change the global default. Default model
  selection remains separate. Models used by the current default or a Bot are
  protected against accidental removal in the editor.
- Stored credentials are never returned to the browser. Discovery may reuse a
  saved key only for the same normalized endpoint and compatible protocol.
  Endpoint changes require a new key or saving the new endpoint first.

## Verification

`npm run check`, `npm test`, and `npm run test:bots:browser` cover type safety,
credential reuse boundaries, default preservation, provider discovery/search/
selection, keyboard controls, dark/light themes, 375px mobile, text scaling,
reduced motion, approvals and per-run history. Browser fixtures use isolated
temporary data and local model endpoints; they do not change real API keys.

## Deliberate limits

- Native OpenAI/Anthropic model lists still accept manual IDs. No unverified
  static catalog or unsupported Responses protocol was added.
- Model display names and maximum output tokens are supported. Unknown reasoning
  parameters, new protocols and modality controls are not guessed or exposed.
- Permissions are enforced by the server, including inherited delegation limits.
  See `settings-platform.md` for current configuration format and policy precedence.
