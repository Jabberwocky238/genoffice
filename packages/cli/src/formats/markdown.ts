import { dirname } from 'node:path'
import { ensureDom } from '../dom'
import type { PathContext } from '../fs'
import { applyDocOps, blankDocument, closeDocument, fillFromHtml, saveDocument } from './docx'

/**
 * Markdown ↔ HTML through a headless Tiptap editor (StarterKit, tables,
 * images, math, @tiptap/markdown). Markdown → Word goes through the docs
 * engine's restricted-HTML import: math becomes <formula>, and each image
 * stands in as a marker paragraph that insert_image swaps for the picture.
 * Only local images are embedded (path policy applies); remote ones and
 * failures fall back to their alt text.
 */
async function markdownEditor(content: string, contentType: 'markdown' | 'html') {
  await ensureDom()
  const [
    { Editor },
    { default: StarterKit },
    { TableKit },
    { default: Image },
    { Mathematics },
    { Markdown },
  ] = await Promise.all([
    import('@tiptap/core'),
    import('@tiptap/starter-kit'),
    import('@tiptap/extension-table'),
    import('@tiptap/extension-image'),
    import('@tiptap/extension-mathematics'),
    import('@tiptap/markdown'),
  ])
  return new Editor({
    extensions: [StarterKit, TableKit, Image, Mathematics, Markdown],
    content,
    contentType,
  })
}

async function withEditor<T>(
  content: string,
  contentType: 'markdown' | 'html',
  fn: (editor: import('@tiptap/core').Editor) => T,
): Promise<T> {
  const editor = await markdownEditor(content, contentType)
  try {
    return fn(editor)
  } finally {
    editor.destroy()
  }
}

export interface MarkdownImageSource {
  /** the markdown file's location, for relative image paths */
  file: string
  ctx: PathContext
}

interface ImageRef {
  src: string
  alt: string
}

const MARKER = (i: number) => `goffimg${i}goffimg`

export async function markdownToDocx(
  markdown: string,
  images?: MarkdownImageSource,
): Promise<Uint8Array> {
  const refs: ImageRef[] = []
  const html = restrictedHtml(await withEditor(markdown, 'markdown', (e) => e.getHTML()), (tag) => {
    refs.push({ src: attr(tag, 'src'), alt: attr(tag, 'alt') })
    return MARKER(refs.length - 1)
  })
  const doc = await blankDocument()
  try {
    fillFromHtml(doc, html)
    // back to front: an image lands right after its marker, so earlier indexes stay put
    for (let i = refs.length - 1; i >= 0; i--) {
      const index = markerIndex(doc, MARKER(i))
      if (index < 0) continue
      const local = images && isLocal(refs[i]!.src)
      const r = local
        ? await applyDocOps(
            doc,
            [{ op: 'insert_image', url: refs[i]!.src, afterBlockIndex: index }],
            {
              ctx: images.ctx,
              baseDir: dirname(images.file),
              mode: 'best_effort',
            },
          )
        : undefined
      replaceBlock(doc, index, r?.failures.length === 0 ? '' : refs[i]!.alt)
    }
    return await saveDocument(doc)
  } finally {
    closeDocument(doc)
  }
}

/** an attribute's value as written (still entity-escaped) */
function rawAttr(tag: string, name: string): string {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

function attr(tag: string, name: string): string {
  return rawAttr(tag, name).replace(/&amp;/g, '&')
}

/**
 * Tiptap's HTML → the docs editor's restricted subset: math nodes become
 * <formula>, each (block-level) image a marker paragraph, and table cells
 * plain text with <br> between their paragraphs.
 */
function restrictedHtml(html: string, image: (tag: string) => string): string {
  return html
    .replace(/<img\b[^>]*>/g, (tag) => `<p>${image(tag)}</p>`)
    .replace(
      /<(span|div)\b[^>]*\bdata-type="(?:inline|block)-math"[^>]*><\/\1>/g,
      // the escaped value is already valid element text
      (tag) => `<formula>${rawAttr(tag, 'data-latex')}</formula>`,
    )
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/g, '')
    .replace(/<(table|th|td)\b[^>]*>/g, '<$1>')
    .replace(/<(th|td)>([\s\S]*?)<\/\1>/g, (_m, cell: string, body: string) => {
      const text = body.replace(/<\/p>\s*<p>/g, '<br>').replace(/<\/?p>/g, '')
      return `<${cell}>${text}</${cell}>`
    })
}

/** only real URL schemes are remote; a Windows drive letter (C:\...) is a path */
function isLocal(src: string): boolean {
  return !!src && !/^(https?|data|blob):/i.test(src)
}

function markerIndex(doc: Awaited<ReturnType<typeof blankDocument>>, marker: string): number {
  let found = -1
  doc.editor.state.doc.forEach((node, _offset, index) => {
    if (found < 0 && node.textContent === marker) found = index
  })
  return found
}

/** drop block `index`, or keep it with `text` as its only content */
function replaceBlock(doc: Awaited<ReturnType<typeof blankDocument>>, index: number, text: string) {
  let from = 0
  doc.editor.state.doc.forEach((node, offset, i) => {
    if (i !== index) return
    from = offset
    const to = offset + node.nodeSize
    const chain = doc.editor.chain()
    if (text) chain.insertContentAt({ from: from + 1, to: to - 1 }, text).run()
    else chain.deleteRange({ from, to }).run()
  })
}

/** HTML (the docs editor's restricted subset or a plain page body) → GFM. */
export function htmlToMarkdown(html: string): Promise<string> {
  return withEditor(html, 'html', (e) => e.getMarkdown())
}

export async function markdownToHtml(markdown: string, title: string): Promise<string> {
  const body = await withEditor(markdown, 'markdown', (e) => e.getHTML())
  return (
    '<!doctype html>\n<html><head><meta charset="utf-8">' +
    `<title>${escapeHtml(title)}</title></head>\n<body>\n${body}\n</body></html>\n`
  )
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  )
}
