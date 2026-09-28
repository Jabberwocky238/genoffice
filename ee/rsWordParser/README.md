# WJKJ EE: rsWordParser

Replaces the Docs package reader/writer with rsWordParser's WASM binding. With
`GENOFFICE_WORD_PARSER=rsword`, every Docs open, patch-save and blank document goes
through Rust; the editor, pagination and save planning are unchanged.

## Import

Consumers import from the module root, `@EE/rsWordParser` (`index.ts`): `wordBackend`,
`loadRsword`, `WordParserDiagnostics`, `openWordDocument`, `WordDocument`, `ParserError`,
`NativeDocument`. `src/` is internal. Vite configs load `vite.ts` (`rsWordParserBuild`)
by relative path because aliases do not apply while a config file is being loaded.

## Backend

Docs reaches the package engine only through `wordBackend` from
`@genoffice/word-parser-extension` (`parse`, `save`, `blank`). The public stub binds it
to the TS `parseDocx` / `saveDocx` / `buildBlankDocx`; the build alias swaps the module:

| `GENOFFICE_WORD_PARSER` | Alias target                              | Engine       | Panel             |
| ----------------------- | ----------------------------------------- | ------------ | ----------------- |
| `off` (default)         | `apps/docs/.../extensions/word-parser.ts` | TS           | none              |
| `shadow`                | `src/shadow.ts`                           | TS           | Rust parser check |
| `rsword`                | `index.ts`                                | rsWordParser | Rust parser check |

`src/backend.ts` drives upstream's `compat-ts` surface (`compat/1`): `parse(bytes)` is the
`ParsedDoc` JSON (Maps and the caller-held source bytes are revived here), `save(bytes,
blocks, options)` takes the same `SaveBlock[]` / `SaveOptions` as `saveDocx`, and
`blank(options)` mirrors `buildBlankDocx`. The WASM loads once per realm, so the parse
Worker and the UI thread each hold an instance. A version other than the pinned commit
and protocol refuses to load.

Upstream classifies `compat-ts` as a test-only differential adapter, so it tracks the TS
engine's shape rather than promising it. The two tools below measure that gap.

## Native sessions

The same WASM also exports the stateful `native/0` protocol (`SessionTable`), wrapped by
`openWordDocument` for the inspection panel and future native editing:

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
`nodeXml(node, part?)` and `partBytes(part)` expose the other native queries. IDs belong
to one session and part. Errors preserve the native `code`; a timeout closes the
document's Worker. Source byte buffers are cloned, so the host retains ownership.

## Build, pin and run

The engine source is the `rsWordParser/` git submodule at the repository root; its
pointer is the pin. Release artifacts are built without `compat-ts`, so the WASM is
built from the submodule:

```sh
git submodule update --init rsWordParser
cd rsWordParser && tools/build-js.sh --locked --features compat-ts && cd ..
npm run ee:rsWordParser:build
npm run test:ee:rsWordParser
npm run typecheck:ee:rsWordParser
npm run dev:docs:rsword
```

`ee:rsWordParser:build [checkout]` (default: the submodule) loads the built WASM,
requires a clean tree, its embedded commit to equal the checkout's `HEAD` and its protocol
to be `compat/1`, copies it into the gitignored `vendor/`, and rewrites `engine.lock.json`
(commit, `source`, features, hashes). `ee:rsWordParser:check` verifies every hash offline
and that the submodule pointer equals the pinned commit; enabled builds verify the hashes.
To move the engine, check out the new commit in the submodule, rebuild, pin, and commit
the pointer together with the lock. `download` applies only to a lock that pins an
Actions run.
wasm-bindgen must match the `wasm-bindgen` version in the upstream `Cargo.lock` (0.2.128).

`dev:docs:rsword` / `build:docs:rsword` default to `rsword`; set
`GENOFFICE_WORD_PARSER=shadow` to keep the TS engine with the panel. For a shell
session, set the variable on the root `npm run dev`.

## Measuring parity

```sh
npm run ee:rsWordParser:diff -- <dir|file.docx>... [--json report.json]
npm run test:docs:rsword
```

`ee:rsWordParser:diff` parses every document with both engines and lists each differing
field path (indices and map keys collapsed) with the number of documents it affects:
`missing` fields exist only in TS, `extra` only in Rust. `test:docs:rsword` runs the whole
Docs suite with `@genoffice/docx-engine` swapped for `tests/engine-shim.ts` (TS engine except
`parseDocx` / `saveDocx` / `buildBlankDocx`), so open → edit → save-plan → save round trips
run on Rust.

Baseline at `a8d24eaa` (compat mirrors the TS engine of 2026-09-03):

- 1,098 documents (upstream synthetic + real corpus, `fixtures`, Docs pagination corpus):
  no parse failures on either side, 251 differing paths. Most are TS fields added after
  that date (`noteNumbers`, `internal.bodyContentStart/End`, `styles.*.basedOn`,
  `docDefaults`, `watermarkPicture`, chart axes/legend, text-box wrap, header/footer
  borders and table rows); upstream `KNOWN_DIFFS.md` records the intentional ones
  (source-byte `rawRPr`, raw metafile data URLs, `mc:Fallback` for undeclared prefixes).
- Docs suite on Rust: 3,000 of 3,103 tests pass; 103 failures in 36 files, led by
  numbering, Zotero fields, list continuation, SDT tables of contents and table edits.

## Replacement plan

1. **Done:** backend seam in Docs, compat backend, local pinning, parse diff, Docs suite
   on Rust.
2. **Parity (upstream `compat_ts`):** close the diff paths and the Docs-suite failures,
   largest first; register only deliberate differences in upstream `KNOWN_DIFFS.md`.
3. **Default:** when the Docs suite is green on Rust, build enterprise releases with
   `rsword`, and publish a `compat-ts` JS binding from upstream's release job so the lock
   can pin an Actions artifact again.
4. **Native editing:** move save from `SaveBlock[]` to `native/0` operations with the
   Rust session as package authority. Layout should consume native model output
   directly, not the legacy projection; see [layout integration plan](../docx-layout/PLAN.md).

## Validation and licensing

Tests run the pinned WASM: native sessions (byte-identical saving, Unicode edits,
reopening in both parsers, rejected edits, media, budgets, timeout, cancellation) and the
compat backend (Map revival, byte-identical unedited save, blank documents).

EE integration code is covered by [the enterprise license](../LICENSE).
[rsWordParser](https://github.com/LilLeapo/rsWordParser) remains
`MIT OR Apache-2.0`; built upstream assets retain their original license.
Include upstream and Rust dependency notices before enabling distribution.
