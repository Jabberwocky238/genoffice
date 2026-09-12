# WJKJ EE: rsWordParser

An experimental adapter for the actual rsWordParser WASM binding. It supports
native document sessions, queries, edits, media and in-memory DOCX saving. Docs
has an opt-in inspection panel; the editor still uses its existing parser/writer.

## Use

```ts
import { openWordDocument } from './src'

const doc = await openWordDocument(bytes)
try {
  const model = await doc.document()
  const paragraph = model.main.find((block) => block.kind === 'text')!
  await doc.apply({
    op: 'insertText',
    at: { para: paragraph.node, part: model.mainPart, offset: 0 },
    text: 'Hello',
  })
  const saved = await doc.save() // Uint8Array; the caller decides where to write it
} finally {
  doc.close()
}
```

`diagnostics()`, `resolve(kind, ids, part?)`, `media(id)`, `addMedia(bytes, mime)`,
`nodeXml(node, part?)` and `partBytes(part)` expose the other native queries.
IDs belong to one session and part; never reuse them after reopening.
`document()` returns the native one-way JSON projection, not `ParsedDocFull`.
Check `truncated` before treating a budgeted model as complete.

The binding declarations come directly from the downloaded `.d.ts`. The wrapper
handles JSON conversion, pinned version checking, Workers, errors and cleanup.
It does not reproduce rsword's model or all edit-operation types. Errors preserve
the native `code`. A timeout closes the document's Worker; reopening starts a new
session. Source byte buffers are cloned, so the host retains ownership.

## Download and run

```sh
npm run ee:word-parser:download
npm run test:ee:word-parser
npm run typecheck:ee:word-parser
npm run dev:docs:rsword
```

The download requires `gh` access to the pinned Actions artifact and `tar`.
`vendor/` is gitignored. `engine.lock.json` tracks the source, run/artifact identity
and hashes for the archive, JS, WASM and declarations. The archive is checked before
extraction, then every extracted asset is checked. `npm run ee:word-parser:check`
performs offline verification. Expired artifacts must be explicitly replaced and
revalidated, never silently resolved to the latest run.

Source: [release run 34681564080](https://github.com/LilLeapo/rsWordParser/actions/runs/34681564080),
artifact `rsword-jsbinding`, commit `e70bc13e139a016753987e94b17e0d879dac0bc5`,
protocol `native/0`, wasm-bindgen `0.2.128`. Use this complete JS-binding artifact,
which includes its companion WASM, rather than mixing it with the raw WASM artifact.

The default application build is unchanged. `GENOFFICE_WORD_PARSER=shadow` selects
the EE panel for both standalone Docs and the renderer embedded in the shell.
`npm run build:docs:rsword` produces a local Docs build with that option. Missing or
modified assets fail the enabled build. Off builds do not require or bundle them.
For a shell development session, set the environment variable on the root `npm run dev`.

Open a DOCX and click **Rust parser check**. It opens the loaded package in Rust,
queries diagnostics, and verifies byte-identical unchanged saving in memory.
The panel never writes a file. Model queries are budgeted and truncation is shown.
Edits invalidate the check; save before checking the new loaded snapshot.

## Replacement plan

This artifact exports `SessionTable`; it has no standalone `parse()` compatibility
function. Upstream's `compat-ts` feature is explicitly a test-only differential
adapter, not a stable editor integration contract. Use `native/0` for this module.

1. **Implemented:** ignored artifact acquisition, native session wrapper, Worker,
   read/edit/save integration tests, and opt-in Docs inspection.
2. **Read projection:** map native document/resolve/media output into the existing
   editor view, auditing styles, numbering, images, fields, tables, notes, protection
   and revisions. Preserve unsupported objects, and distinguish readable, editable,
   round-trippable and displayable capabilities. Metafile conversion stays a host service.
3. **Write migration:** translate editor transactions into native operations and
   keep the Rust session as the package authority. Current `buildDocBytes` depends on
   `internal.originalBytes`, XML ranges, `extras`, `docxIndex` and `SaveBlock[]`;
   substituting the return type of `parseDocx()` alone cannot satisfy that contract.
   Address multi-operation atomicity, undo/redo, IME, recovery and failed disk saves
   before enabling editing. Do not assume the current WASM API provides an editor history API.
4. **Backend rollout:** choose one authoritative read/write backend per document.
   Compare on real fixtures first, then enable supported documents. Do not silently
   switch an edited Rust session to the legacy writer using mismatched source indices.

The eventual parser host interface should live near `file-actions.ts` and
`doc-state.ts`, with a separate view adapter near `editor/convert.ts`.
The existing parser/writer remains the default until both projection and editing
coverage pass. Merely parsing successfully does not establish feature parity.

For layout, native model/resolve output should feed its own `LayoutDocument`
adapter directly. Do not route through a lossy legacy editor projection.
The layout repository's proposed Rust adapter is not present in this binding;
its API and remaining semantic gaps need a separate implementation.
See [layout integration plan](../docx-layout/PLAN.md).

## Validation and licensing

Tests exercise the downloaded WASM, including byte-identical saving, Unicode edits,
reopening in both parsers, rejected edits, media, budgets, timeout and cancellation.
These are integration checks, not a claim of complete Word or editor parity.
The module is not enabled in enterprise release workflows yet.

EE integration code is covered by [the enterprise license](../LICENSE).
[rsWordParser](https://github.com/LilLeapo/rsWordParser) remains
`MIT OR Apache-2.0`; downloaded upstream assets retain their original license.
Include upstream and Rust dependency notices before enabling distribution.
