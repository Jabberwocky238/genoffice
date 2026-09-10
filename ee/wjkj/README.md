# WJKJ custom API module

This directory contains the WJKJ-specific provider configuration entry and is
covered by [the enterprise license](../LICENSE).

- `AiSettingsEntry.tsx`: sidebar entry and custom API settings dialog. The host
  supplies the language and settings API through props.
- `api.ts`: the minimal settings API required by this component.
- `settings.ts`: form validation based on upstream provider capabilities.
- `styles.css`: module styles, with generic button rules scoped to the dialog.

## Upstream integration

Upstream now supports custom API providers itself. This module reuses the
upstream provider catalog, settings IPC, persistence and editor execution.
It does not patch Docs, Sheets, Slides or the shared AI provider package.
Model suggestions, CLI providers and settings migrations follow upstream.
The existing upstream settings dialog and its connection tests remain available.

The only application integration is the component import and sidebar mount in
`apps/shell/src/renderer/src/Home.tsx`. The `wjkj` branch enables it directly.
When syncing upstream, keep this small integration and the `ee/wjkj` directory;
do not restore the old editor overrides that forced a provider selection.

GitHub requires the enterprise build workflow to remain in
`.github/workflows/wjkj-enterprise.yml`; it builds this module with the shell.

## Validation

Run `npm run test:ee`, `npm run typecheck -w @genoffice/shell` and
`npm run build -w @genoffice/shell` to verify the module and integration.
