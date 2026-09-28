# GenOffice Enterprise (`ee/`)

Enterprise modules live here, behind the enterprise license boundary.

- [WJKJ](wjkj/README.md): custom API configuration dialog and home sidebar entry,
  integrated with upstream AI settings.
- [rsWordParser](rsWordParser/README.md): rsWordParser WASM as the Docs package
  reader/writer (`GENOFFICE_WORD_PARSER=rsword`), parity tools and inspection panel;
  built assets are gitignored.
- [Word layout plan](docx-layout/PLAN.md): staged integration with docx-layout.

## Imports

`@EE/*` resolves to `ee/*` in the Docs and shell renderers, their tests and type checks.
Each module exports its public surface from its root `index.ts`; import `@EE/<module>`,
never a file inside it.

## Upstream engines

The Rust engines are git submodules at the repository root, pinned by commit:

- `rsWordParser/` ([LilLeapo/rsWordParser](https://github.com/LilLeapo/rsWordParser)):
  package reader/writer behind [rsWordParser](rsWordParser/README.md).
- `rsWordLayout/` ([Jabberwocky238/rsWordLayout](https://github.com/Jabberwocky238/rsWordLayout)):
  Word layout engine, not yet integrated.

Clone with `git clone --recurse-submodules`, or run `git submodule update --init` in an
existing checkout. Root lint and formatting skip both trees.

## License boundary

Everything under `ee/` is covered by the
[GenOffice Enterprise License](LICENSE), not the Apache-2.0 license that
covers the rest of the repository. Keeping all enterprise code behind
this single top-level directory keeps the license boundary auditable and
lets the open-source core stay plain Apache-2.0 permanently.

Downloaded third-party assets retain their upstream licenses; the enterprise
license applies to our integration code, not those external components.

## Contributions

`ee/` does not accept external contributions. Pull requests from outside
the maintainer team must not modify files in this directory (enforced
via CODEOWNERS). See [CONTRIBUTING.md](../CONTRIBUTING.md).
