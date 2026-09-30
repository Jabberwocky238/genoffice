import { describe, expect, it } from 'vitest'
import { fingerprint, signatureFromSchema } from '../src/op-catalog'
import { run } from './helpers'

describe('op catalogs', () => {
  it('renders signatures from a schema', () => {
    const sig = signatureFromSchema({
      type: 'object',
      properties: {
        op: { const: 'x' },
        range: { type: 'string' },
        count: { type: 'integer' },
        order: { enum: ['asc', 'desc'] },
        values: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        on: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
        colors: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['op', 'range'],
    })
    expect(sig).toBe(
      '{range, count?: n, order?: asc|desc, values?: [string|null], on?: bool|null, colors?: {"<key>": string}}',
    )
    expect(fingerprint({ b: 1, a: [2] })).toBe(fingerprint({ a: [2], b: 1 }))
  })

  it('builds the docs catalog from the op registry and the tool schemas', async () => {
    const json = await run(['guide', 'docs', '--json'])
    expect(json.code).toBe(0)
    const detail = json.json().detail
    expect(detail.groups.map((g: { name: string }) => g.name)).toEqual(['block', 'content'])
    const byName = new Map(detail.ops.map((e: { op: string }) => [e.op, e]))
    expect(byName.get('findReplace')).toMatchObject({ group: 'block', target: 'optional' })
    expect((byName.get('findReplace') as { keys: string[] }).keys).toContain('replace')
    expect((byName.get('setFont') as { signature: string }).signature).not.toContain('"setFont"')
    expect(byName.get('set_header_footer')).toMatchObject({
      group: 'content',
      signature: '{kind: header|footer, text, view?: default|first|even}',
    })
    expect(
      (byName.get('insert_content') as { schema: any }).schema.properties.afterBlockIndex
        .description,
    ).toContain('end of document')
    expect((byName.get('insert_image') as { schema: any }).schema.properties).toHaveProperty(
      'afterBlockIndex',
    )
    const text = await run(['guide', 'docs', 'content'])
    expect(text.stdout).toContain('insert_chart {kind: bar|line|pie')
    expect(text.stdout).toContain('Only these tags are allowed')
    expect(text.stdout).not.toContain('setFont')
  })
})
