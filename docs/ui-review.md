# UI review: provider settings and task history

## Reference and scope

Reviewed the chat footer, task history, provider settings, connectors, skills,
Telegram, approvals, profile/details and responsive layouts. The reference is
[DeepSeek Harness's model configuration](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers):
provider-first organization, credentials separate from model catalogs, model
discovery with searchable selection, and manual model IDs as a fallback.
This is an adaptation to Apsis's existing adapters, not an implementation of
every protocol or advanced field supported by the reference product.

## Changes

- Chat actions and task history share one compact footer. Status appears once;
  zero operations and sub-second duration are omitted from the summary.
- Connection errors have a readable explanation with the original error retained
  in an expandable detail. This changes presentation, not retry behavior.
- Settings use a stable-size shell so switching categories does not move the
  navigation or close button. Shared spacing, borders and theme tokens remain.
- Providers have a dedicated overview, add-provider catalog and editor. Codex
  is retired; legacy connections remain visible but cannot run or be selected.
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
  See `settings-platform.md` for migration, precedence and compatibility details.
