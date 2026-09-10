# WJKJ enterprise module

This module contains the WJKJ branch's AI customization and is covered by
[the enterprise license](../LICENSE).

- `AiSettingsEntry.tsx` and `styles.css`: provider/model configuration UI.
  The host passes its language and settings API; the module does not depend
  on the shell window global or its locale context.
- `providers.ts`: WJKJ model suggestions, including the existing DeepSeek v4
  entries, without mutating the community provider catalog.
- `main.ts`: resolves persisted settings while preserving the selected
  provider for Docs, Sheets and Slides.
- `api.ts` and `preload.ts`: shared settings contract and the narrow IPC bridge.
  The channels reuse the existing editor settings handlers and storage.

## Integration

The `wjkj` branch directly integrates this module: the shell renders
`AiSettingsEntry`, extends its home API with `WjkjAiSettingsApi`, and installs
`createWjkjAiSettingsApi` in its preload. Each editor's settings read handler
calls `resolveWjkjAiSettings`. No runtime flag or separate installation is
required. The existing AI execution and persistence code remains in the core.

Styles for generic dialog buttons are scoped to `.ai-settings-modal` so they
do not affect other shell dialogs. The sidebar host uses `wjkj-sidebar-footer`.

The workflow remains in `.github/workflows/wjkj-enterprise.yml` because GitHub
Actions discovers workflows there. It builds the integrated module through
`npm run build:all` and retains the existing WJKJ artifact names.

## Validation

Run `npm run test:ee` for settings preservation, provider catalog isolation,
and IPC routing checks. Run the Docs, Sheets, Slides and Shell workspace
`typecheck` scripts to check the host integration.
