# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/genspark-ai/genoffice/security/advisories/new)
on this repository. Do not open public issues for security reports. We aim to
acknowledge reports within 72 hours.

## Process Security Posture

All application windows run with the full Electron renderer lockdown:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for every
  document window and tab view (docs, sheets, slides, pdf, markdown, shell, updater).
- Renderers reach the main process only through typed, validated IPC channels
  (payloads are schema-checked in the main process; sheets uses zod end to end).
- Every `shell.openExternal` call goes through a single shared gate
  (`@genoffice/electron-utils` → `safeExternalUrl`) that parses the URL and
  enforces a protocol allowlist (http/https; pdf link annotations additionally
  allow mailto). `file:`, `javascript:`, and custom schemes are always rejected.
- No API keys are hardcoded. AI requests are proxied through the signed-in
  account by default; user-supplied keys stay in the OS-level settings store.

## Out of Scope

- The cloud AI services this client talks to are operated separately and are
  not part of this repository; issues with them should be reported through the
  service provider's channels.
- Vulnerabilities that require an already-compromised machine or a modified
  binary. This includes the deliberate environment-variable override points
  for local development (`GSK_CLI_PATH`, `XLSX_SIDECAR_PATH`): setting them
  requires control of the process environment, which is equivalent to code
  execution on the machine.
