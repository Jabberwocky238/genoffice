# GenOffice Enterprise (`ee/`)

Enterprise modules live here, behind the enterprise license boundary.

- [WJKJ](wjkj/README.md): custom API configuration dialog and home sidebar entry,
  integrated with upstream AI settings.
- [Word parser](word-parser/README.md): opt-in rsWordParser WASM session adapter
  and Docs inspection panel; downloaded assets are gitignored.
- [Word layout plan](docx-layout/PLAN.md): staged integration with docx-layout.

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
