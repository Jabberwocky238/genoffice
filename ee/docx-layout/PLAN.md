# WJKJ EE: Word layout integration plan

Status: proposal; no layout implementation is enabled by this change.

Reviewed GenOffice `wjkj` at `a353558052fb737e279ffd8f457125ade8606638` and
`LilLeapo/docx-layout` at `f1a74dfcd967749aac9e4bddb537134c67642b17`.
See the [parser module](../word-parser/README.md) for its implemented WASM bridge.

## Architecture

Keep two independent EE modules:

- `ee/word-parser`: rsWordParser sessions, document queries, edits and package saving.
- `ee/docx-layout`: layout input adapters, font resources, WASM execution and future preview.

The external repositories continue to own parsing/writing and layout algorithms.
GenOffice owns editor state, UI, file I/O and integration. Neither external kernel
should depend on React, Electron or EE. Existing `ee/wjkj` remains the API settings module.

```text
DOCX -> parser session -> editor view adapter -> ProseMirror
              |
              +-> layout adapter -> LayoutDocument -> docx-layout -> future preview

ProseMirror transactions -> edit adapter -> parser session -> DOCX bytes -> host file I/O
```

The existing TypeScript parser can also feed its own layout adapter. Do not pass
rsword through a lossy legacy view projection before creating layout input.
Source maps bind editor positions and layout ranges to the same document revision.

## Current capability boundaries

The layout repository has contract validation, canonicalization, font identity,
ComputeKey and publication boundaries. Production `layout()` still returns
`ENGINE_NOT_IMPLEMENTED`. Its fake layout stages are test-only. Its renderer
boundary only inspects page count; it is not a painter.

The actual WASM API exports `normalize`, `style_identities`, `FontBuilder` and
`FrozenFonts.fingerprint/compute_key/layout`. It does not export the full Rust
publication API. The generated wire schema is a subset of the historical full
LayoutDocument design. Unknown fields may be stripped into ingestion diagnostics;
normalization success is not proof of complete semantic coverage.

Native workspace tests passed: 26 runtime tests and 9 compile-fail doctests.
Oracle Python tests could not start with `uv --locked`: the checkout's lockfile
needed updating under both available/default Python and Python 3.12. It was not
modified. No Word geometry or layout WASM verification was performed in this review.

## Proposed integration

Keep adapter, runtime, diagnostics, asset locking and future preview under this
module. Use generated schema/types from a pinned source commit. Rust owns
canonicalization and ComputeKey; TypeScript should not duplicate those algorithms.
The normalized output must not be assumed to be valid raw input for other APIs.

Adapters must preserve UTF-16 offsets, source identities, paragraph marks, sections,
revision/hidden-text policy, font slots, fields, tables and missing/false/zero states.
Missing parser facts require explicit coverage diagnostics or parser improvements.
Do not flatten unsupported content into plain text and claim a complete projection.

Use Workers for synchronous WASM. Bind requests to document instance, revision,
projection version, fonts and options. Discard late responses after changes or
close; terminate the Worker on timeout. Adopt upstream BindingKey and publication
checks when exported; a host request ID is not equivalent to that guarantee.

`doc.parsed` is the loaded snapshot, not the live ProseMirror document. First-stage
checks must invalidate after edits. Live layout requires a complete current snapshot,
including headers, textboxes, styles and sections, not just new body blocks.

Fonts require actual file bytes and face indices. CSS family names alone are not
a font environment. Freeze the source commit, toolchain, schema and all generated
asset hashes together; updates and rollbacks must keep them consistent.

## Host changes and migration stages

1. **Kernel wiring:** EE module, generated assets, Worker, coverage diagnostics and
   a narrow Docs mount. Use Vite build selection for off/shadow modes. Validate
   asset URLs, Worker startup and WASM CSP in development and packaged Electron.
   Retain current rendering and printing. A rejected layout is an expected result.
2. **Complete adapters and shadow comparison:** extend parser facts as needed,
   implement both input adapters and source maps, and adopt a complete snapshot
   provider. Only compare geometry after upstream produces real production output.
   Existing DOM geometry is an auxiliary comparison, not a substitute for Word oracle.
3. **Read-only preview:** add an EE painter after the glyph/resource/display-list
   contract is ready. Consume engine positions without browser text reflow.
   Validate target documents against Word before switching preview or printing.
4. **Editor migration:** separately design cursor hit testing, selection, IME,
   undo/redo, revisions, split tables, scrolling anchors and incremental invalidation.

Likely integration points are `App.tsx`, a narrow renderer extension interface,
`electron.vite.config.ts`, `vite.renderer.config.ts`, Docs type resolution,
root verification commands, enterprise workflows and third-party notices.
Parser fact changes belong in independent, reviewable commits under
`packages/docx-engine`; that package must not import EE.

`PaginationPreview.tsx` and current `pagination*.ts` use DOM measurement. There is
no single layout function whose replacement completes this migration.

## Acceptance

Validate real native/WASM parity, bad inputs/fonts, cancellation, stale results,
artifact mismatch, source mapping and unsupported semantic cases. Run EE-off and
EE-on builds and Windows/macOS packaged smoke checks. Complete existing editing,
saving and printing regressions. New output must not be advertised as Word-compatible
until real Word geometry has been accepted for the declared coverage.
