# @genoffice/cli

`genoffice` is the GenOffice command line. It exposes the suite's document engines
to scripts and AI agents without opening a window: the packaged app runs the
bundled CLI on its own Node runtime (`ELECTRON_RUN_AS_NODE`), so nothing extra
has to be installed.

```
genoffice info report.docx
genoffice convert scan.pdf --to docx
genoffice open report.docx --block 3
genoffice render report.docx|file.pdf --out shots/ [--page 3] [--scale 2]   # one PNG per page, to look at what was made
genoffice render report.docx --out shots/ --grid [--cols 4] [--tile 320]    # plus <stem>-grid.png: every page on one contact sheet
genoffice create --type docx --from report.md --out report.docx      # or --from fragment.html (restricted HTML)
genoffice create --type pdf --from report.docx --out report.pdf      # printed by the Word renderer
genoffice convert notes.md --to docx|html
genoffice convert report.docx --to html               # the Word editor's standalone-HTML export
genoffice convert report.docx --to md                 # GFM (math as $…$, images dropped with a warning)
genoffice capabilities --json                        # which cloud features GenOffice has configured (no network call)
genoffice search "electron headless export" [--images] [--max 6] --json
genoffice image "isometric office, soft light" --aspect 16:9 --out hero.png
genoffice media photo.jpg --ask "What text is in this picture?" --json
genoffice docs read report.docx [--range 0-9] [--html] [--full] [--comments] [--revisions] [--header-footer] --json   # blocks (--full: whole text), comment threads, tracked changes, header/footer text
genoffice docs apply report.docx --ops ops.json [--dry-run] [--out copy.docx]   # apply_ops entries + insert_content / replace_blocks / insert_image / insert_chart / edit_chart / set_header_footer / reply_comment / resolve_comment
genoffice docs check report.docx --json                               # fields without results, broken bookmark references, stale TOC, missing images, empty charts/headings, heading level skips, placeholder text, pending revisions, open comments; exit 0
genoffice merge invoice-template.docx --data values.json --out invoice.docx [--force] [--strict]   # fill {{key}} placeholders; reports used, unused and unresolved keys (or --data '{"name":"Ada"}')
genoffice pdf read scan.pdf [--page 3 | --range 1-5] [--full] --json     # text layer page by page (pages 1-20 by default, 4000 characters each) with page sizes and metadata; headless pdfium, no app process
genoffice guide docs                                                   # op signatures + restricted-HTML rules (`guide docs --json` = the catalog with each op's schema; `--fingerprint` only its hash)
genoffice selection report.docx --json   # what the user has selected in the editor showing the file
genoffice skill list   # coding agents found on this machine and the skill version each has
genoffice skill install --dir ./skills --force   # copy the bundled skill into a skills directory
genoffice install-cli   # put genoffice on the PATH
genoffice mcp --http 3000 [--host 127.0.0.1] [--token secret]   # Streamable HTTP for clients on other machines; omit --http for stdio
genoffice mcp --compact-schemas   # advertise ops/data as plain arrays instead of the per-op schema (smaller tools/list; also GENOFFICE_MCP_COMPACT_SCHEMAS=1)
genoffice mcp install all   # register the stdio server with every coding agent found (or one: claude-code, codex, cursor, gemini, copilot, opencode, windsurf)
genoffice mcp list          # each agent's MCP config and whether genoffice is registered; `mcp uninstall <agent>` removes the entry
```

Word commands run the docs editor under jsdom (installed once per process, loaded lazily); its modules are imported from the app renderer by relative path. Markdown goes through a headless Tiptap editor (StarterKit, tables, images, math, `@tiptap/markdown`): Markdown → Word is Markdown → restricted HTML → the docs engine, with local images embedded through `insert_image`.

Every command prints a one-line human summary by default or a single JSON
object with `--json` (`{ status, command, summary, output_path?, warnings?, detail? }`);
`warnings[]` (`{ code, message, suggestion? }`) carries advisories about a
result that still succeeded.
Errors are `{ status: "error", code, error, message, suggestion?, detail? }`:
`code` is the exit code, `error` a stable snake_case reason (`unknown_op`,
`target_not_found`, `out_of_range`, `file_open_in_gui`, …)
and `suggestion` the next step (with `did you mean …?` for one-typo
mistakes); the facts an agent needs to retry (valid
ranges, available ids, usage lines) come back as fields in
`detail` rather than only inside the message. Exit codes: `0` ok, `1` usage,
`2` file, `3` conversion failed, `4` app not available.

## Template merge

`genoffice merge <template> --data <values> --out <file>` fills `{{key}}`
placeholders in a `.docx` template from a JSON object (a file, inline JSON or
`-` for stdin). Nested objects flatten to dotted keys (`{{a.b}}`); arrays are
not expanded and come back in `detail.ignored_keys`; whitespace inside the
braces is tolerated. The fill runs on the docs editor's own `findReplace` (a
table block with a placeholder that has a value goes through `replace_blocks`
on its restricted HTML, since `findReplace` does not reach cells; a table
nothing fills is left untouched).

The result lists `used_keys`, `unused_keys` and `unresolved_placeholders`
(`{ placeholder, key, reason, location }` with the block index). `reason:
no_key` is a placeholder the data does not cover; `split_placeholder` is one
Word stored across runs with different formatting, which run-level replace
cannot match (retype it in one run). Unresolved placeholders stay in place and
the result carries an `unresolved_placeholder` warning; `--strict` turns them
into an error of the same name and writes nothing. The output is written
atomically, an existing file needs `--force`, and the GUI-open check and
`GENOFFICE_ALLOWED_ROOTS` apply as for every other write.

## MCP server

`genoffice mcp` serves the same commands as Model Context Protocol tools on
stdio, for clients that cannot run a shell or should not (Claude Desktop,
Cursor, sandboxed agents). Nothing else is needed on the machine: the process
runs on the app's Node runtime like every other command, and GenOffice itself
only starts, hidden, for the conversions that need its renderer.

```bash
claude mcp add --transport stdio genoffice -- genoffice mcp
```

```json
{ "mcpServers": { "genoffice": { "command": "genoffice", "args": ["mcp"] } } }
```

`genoffice mcp install <agent|all> [--dir <path>] [--force]` writes that entry
for you, pointing at the absolute launcher path so it works without `genoffice`
on the PATH (on Windows, where MCP clients spawn without a shell, the entry
runs `GenOffice.exe` as Node on the bundled `genoffice.cjs` with
`ELECTRON_RUN_AS_NODE=1`, the same entry the app's Settings snippet shows): `~/.claude.json` (Claude Code, user scope; `CLAUDE_CONFIG_DIR`
honoured), `~/.codex/config.toml` (`[mcp_servers.genoffice]`; `CODEX_HOME`),
`~/.cursor/mcp.json`, `~/.gemini/settings.json`, `~/.copilot/mcp-config.json`
(Copilot CLI), `~/.config/opencode/opencode.json` and
`~/.codeium/windsurf/mcp_config.json`. Only the `genoffice` key is touched; an
entry of that name starting another program is reported as `occupied` and left
alone unless `--force`, a file that cannot be parsed is reported as `manual`
with the snippet to paste. `--dir` names the agent's config folder for one
agent; `mcp uninstall <agent|all>` removes the entry; `mcp list` shows every
agent, detected or not, with its config path and state (`--json` for the
structured rows).

The tool table is `src/mcp/tools.ts`: one tool per command verb
(`docs_read`, `docs_apply`, `render`, `convert`, …),
each parameter taken from the command's own option list, so the two surfaces
cannot drift. Ops, data and Markdown are passed inline and land
in a scratch directory for the length of the call; `render` returns the PNGs
as image content. Results are the same JSON
envelope `--json` prints; an error comes back with `isError` and the same
`error` reason. The `ops` parameter carries the per-op
schema of `guide docs --json` (one variant per op with its fields), so a
client sees the fields without reading the guide; `genoffice mcp
--compact-schemas` (or `GENOFFICE_MCP_COMPACT_SCHEMAS=1`) advertises them as
plain arrays for clients with a small context budget. The op references are
also a resource (`genoffice://guide/docs`).

Behind a reverse proxy, set `GENOFFICE_TRUST_PROXY_HEADERS=1` so the download
URLs the server hands out use the forwarded host and scheme; by default the
`X-Forwarded-*` headers are ignored.

`genoffice mcp --http <port> [--host <addr>] [--token <secret>]` serves the
same tools over Streamable HTTP for clients on other machines (`src/mcp/http.ts`).
Files travel with the calls: `PUT /files/<name>` uploads one and returns a URL,
every path parameter also takes an http(s) URL (fetched into the session's
scratch directory, `src/mcp/files.ts`), and a tool that writes a file returns
`output_url` plus the bytes as an embedded resource when small or a
`resource_link` otherwise (`src/mcp/remote.ts`). Each session has its own
scratch directory and working directory; `open` and `selection`
are not registered;
with `GENOFFICE_ALLOWED_ROOTS` unset the tools are confined to the server's
file store.

## Putting genoffice on the PATH

- **macOS**: the app tries to symlink `/usr/local/bin/genoffice` (or `/opt/homebrew/bin/genoffice`) on every launch until one succeeds. If neither directory is writable it stays silent; run `genoffice install-cli` from the launcher, or `sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/GenOffice.app/Contents/Resources/cli/genoffice" /usr/local/bin/genoffice`.
- **Windows**: the installer appends `<install dir>\resources\cli` to the user PATH (`apps/shell/build/installer.nsh`, REG_EXPAND_SZ preserved, removed on uninstall) and the app re-checks once per version; new terminals see `genoffice`. The directory holds `genoffice.cmd` for cmd / PowerShell and the extension-less `genoffice` for Git Bash.
- **Linux**: the deb/rpm post-install links `/usr/bin/genoffice`; the AppImage relies on the first-launch symlink into `/usr/local/bin` when it is writable.

`genoffice install-cli` repeats the attempt and prints the manual command when it cannot finish. jsdom (for Word/Markdown) ships beside the bundle as `Resources/cli/node_modules`, collected by `collect-deps.mjs` at build time.

Independently of the PATH, every launch of the packaged app writes the launcher directory to `~/.genoffice/launcher` (`GENOFFICE_AUTH_DIR` overrides the directory, as for `auth.json`). The `genoffice` agent skill (`skills/genoffice/SKILL.md`) reads it when `genoffice` is not on the PATH. `genoffice --version` prints this package's version, inlined by `build.mjs`.

## Layout

- `src/cli.ts` — argv parsing, dispatch, output; `runCli()` is embeddable.
- `src/registry.ts` — `CommandDef` table (`name`, `usage`, `run`), the single
  place future entry points (in-app AI, MCP) dispatch through.
- `src/commands/` — `info`, `convert`, `create`, `render`, `docs`, `merge`, `pdf`,
  `guide`, `open`, `selection`, `capabilities`, `search`, `image`, `media`, `install-cli`.
- `src/dom.ts` — the jsdom bootstrap the Word/Markdown paths need.
- `src/formats/` — thin adapters over the docs editor, `@genoffice/pdf2docx`
  and the headless Markdown editor.
- `src/resources.ts` — locates pdfium wasm and the OCR helper in both the
  packaged `Resources/` layout and the dev checkout.
- `bin/genoffice`, `bin/genoffice.cmd` — launchers copied next to `genoffice.cjs` in the
  packaged app.

## Path policy and audit log

- `GENOFFICE_ALLOWED_ROOTS` (PATH-style list of directories) confines every file genoffice
  reads or writes to those trees; symlinks are resolved before the check. A path
  outside exits 2 with the roots in `detail.allowed_roots`. Unset means
  unrestricted.
- `apply --out` onto another existing file needs `--force`, like `create` / `convert`;
  editing in place never does. Unknown options are rejected instead of ignored.
- A file the running GenOffice shell has open in a tab is not rewritten in place
  (exit 2, `detail.gui_pid`): the shell publishes its open tabs to
  `userData/open-documents.json` and genoffice reads it (`GENOFFICE_USER_DATA`
  overrides the location). `--force` writes anyway; the editor then warns about
  the on-disk change at its next save.
- Every executed command appends one JSON line (`ts`, `command`, `argv`,
  `status`, `code`, `output_path`, `ms`, `cwd`) to
  `~/.genoffice/cli-audit.jsonl`, rotated at 2 MB. `GENOFFICE_AUDIT_LOG=<path>`
  redirects it, `GENOFFICE_AUDIT_LOG=off` disables it.

## Cloud commands

`search`, `image` and `media` reuse the editors' provider routing. Search uses
the selected Serper / Serply / Tavily / Parallel provider when its key is configured;
otherwise Genspark is the default when signed in (`~/.genoffice/auth.json`)
and cloud tools are on, then Parallel's free, rate-limited Search MCP, then
DuckDuckGo. Parallel
and Tavily provide web search only. Image generation and media analysis use
the corresponding provider chosen in the app's AI settings
(`GenOffice/ai-settings.json` in the platform config directory, override with
`GENOFFICE_AI_SETTINGS`). `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` are honoured.
Search results, image bytes and analysis text come back in the JSON `detail`;
`image` also writes the file. These are the only commands that send data off
the machine.

## Build and run in a checkout

```
npm run build -w @genoffice/cli       # esbuild → dist/genoffice.cjs
packages/cli/bin/genoffice info file.docx  # falls back to the system node
```

Conversions that need the app renderer (Word → PDF, Word → HTML,
`create --type pdf`) run inside the GenOffice binary
through its hidden `--headless-export` mode: genoffice spawns it (Dock hidden, no
window), reads the JSON envelope it prints and maps its exit code. Set
`GENOFFICE_APP_BIN` to point at a specific executable; in a checkout the dev Electron
plus `apps/shell` is used, so `npm run build:all` first.
