import { flagBool } from '../args'
import type { CommandDef } from '../registry'
import { docsCatalog } from '../formats/docx'
import {
  opLines,
  renderGroups,
  type GuideDomain,
  type OpCatalog,
  type OpEntry,
} from '../op-catalog'
import { CliError, EXIT, type CommandResult } from '../result'
import { didYouMean } from '../suggest'

const DOMAINS: readonly GuideDomain[] = ['docs']

/**
 * The op reference is generated from the definition the executor validates against (the docs op
 * registry and tool schemas), so the guide cannot drift from what `apply` accepts; `--json`
 * returns the same catalog with each op's schema.
 */
export const guideCommand: CommandDef = {
  name: 'guide',
  summary: 'Print the op reference and design guides an agent needs before writing ops or specs.',
  usage: 'guide docs [group|op] [--fingerprint]',
  options: [
    {
      name: 'fingerprint',
      description: 'only the catalog fingerprint (changes with any op or field)',
    },
  ],
  async run(args) {
    const [domain, topic] = args.positionals
    const json = flagBool(args, 'json')
    if (flagBool(args, 'fingerprint') && (domain === undefined || isDomain(domain))) {
      return fingerprints(domain, json)
    }
    if (!isDomain(domain)) {
      throw new CliError(
        EXIT.usage,
        'guides available for: docs',
        { usage: 'genoffice guide docs' },
        {
          reason: domain === undefined ? 'missing_argument' : 'invalid_argument',
          suggestion: 'run `genoffice guide docs`',
        },
      )
    }
    const { catalog, text } = await load()
    if (!topic) return { summary: text(), ...(json ? { detail: { ...catalog } } : {}) }
    const group = catalog.groups.find((g) => g.name === topic)
    if (group) {
      const entries = catalog.ops.filter((e) => e.group === topic)
      return {
        summary: text(topic),
        ...(json
          ? { detail: { domain, fingerprint: catalog.fingerprint, group, ops: entries } }
          : {}),
      }
    }
    const entry = catalog.ops.find((e) => e.op === topic)
    if (!entry) {
      const names = [...catalog.groups.map((g) => g.name), ...catalog.ops.map((e) => e.op)]
      const guess = didYouMean(topic, names)
      throw new CliError(
        EXIT.usage,
        `unknown group or op: ${topic}`,
        { groups: catalog.groups.map((g) => g.name) },
        {
          reason: 'invalid_argument',
          suggestion: guess
            ? `did you mean ${guess}?`
            : `run \`genoffice guide ${domain}\` for the groups and ops`,
        },
      )
    }
    return { summary: opText(entry), ...(json ? { detail: { ...entry } } : {}) }
  },
}

function isDomain(value: string | undefined): value is GuideDomain {
  return (DOMAINS as readonly string[]).includes(value ?? '')
}

interface Loaded {
  catalog: OpCatalog
  text: (group?: string) => string
}

/** The catalog `guide <domain> --json` prints; the MCP op schemas are built from the same object. */
export async function loadCatalog(): Promise<OpCatalog> {
  return (await load()).catalog
}

async function load(): Promise<Loaded> {
  const { catalog, htmlRules } = await docsCatalog()
  return { catalog, text: (group) => docsGuideText(catalog, htmlRules, group) }
}

function docsGuideText(catalog: OpCatalog, htmlRules: string, group?: string): string {
  const lines = [
    'Word ops (genoffice docs apply --ops): a JSON array; every entry has "op".',
    'Targets: { "blockIndexes": [..] } or { "nodeType": "docHeading"|"docParagraph"|"docListItem"|"image", "headingLevel"? }; get indexes from `genoffice docs read`.',
    'Field notation: bare = string, n = number, bool = boolean, ? = optional, a|b = one of.',
    '',
    ...renderGroups(catalog, group),
  ]
  if (!group || group === 'content') lines.push('', htmlRules)
  return lines.join('\n')
}

function opText(entry: OpEntry): string {
  const lines = opLines(entry)
  if (entry.doc) lines.push('', entry.doc)
  else if (entry.schema) lines.push('', JSON.stringify(entry.schema, null, 2))
  return lines.join('\n')
}

async function fingerprints(
  domain: GuideDomain | undefined,
  json: boolean,
): Promise<CommandResult> {
  const domains = domain ? [domain] : DOMAINS
  const out: Record<string, string> = {}
  for (const d of domains) out[d] = (await load()).catalog.fingerprint
  return {
    summary: Object.entries(out)
      .map(([d, fp]) => `${d} ${fp}`)
      .join('\n'),
    ...(json ? { detail: { fingerprints: out } } : {}),
  }
}
