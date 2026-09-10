# GenOffice Enterprise (`ee/`)

Enterprise modules live here, behind the enterprise license boundary.

- [WJKJ](wjkj/README.md): shared AI provider settings, model suggestions,
  and the home sidebar configuration entry.

## License boundary

Everything under `ee/` is covered by the
[GenOffice Enterprise License](LICENSE), not the Apache-2.0 license that
covers the rest of the repository. Keeping all enterprise code behind
this single top-level directory keeps the license boundary auditable and
lets the open-source core stay plain Apache-2.0 permanently.

## Contributions

`ee/` does not accept external contributions. Pull requests from outside
the maintainer team must not modify files in this directory (enforced
via CODEOWNERS). See [CONTRIBUTING.md](../CONTRIBUTING.md).
