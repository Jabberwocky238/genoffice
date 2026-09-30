import { PNG } from 'pngjs'

export interface GridTile {
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface GridSheet {
  png: Buffer
  width: number
  height: number
  cols: number
  rows: number
  tiles: GridTile[]
}

const GUTTER = 8

/** Pages downscaled to `tileWidth` and laid out row-major on white, `cols` per row. */
export function contactSheet(
  pages: { page: number; png: Buffer }[],
  cols: number,
  tileWidth: number,
): GridSheet {
  const decoded = pages.map((p) => ({ page: p.page, img: PNG.sync.read(p.png) }))
  const tileHeight = Math.max(
    1,
    ...decoded.map((d) => Math.round((d.img.height * tileWidth) / d.img.width)),
  )
  const rows = Math.ceil(decoded.length / cols)
  const width = cols * tileWidth + (cols + 1) * GUTTER
  const height = rows * tileHeight + (rows + 1) * GUTTER
  const sheet = new PNG({ width, height })
  sheet.data.fill(255)
  const tiles: GridTile[] = []
  decoded.forEach((d, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const w = tileWidth
    const h = Math.round((d.img.height * tileWidth) / d.img.width)
    const x = GUTTER + col * (tileWidth + GUTTER)
    const y = GUTTER + row * (tileHeight + GUTTER)
    downscaleInto(d.img, sheet, x, y, w, h)
    tiles.push({ page: d.page, x, y, w, h })
  })
  return { png: PNG.sync.write(sheet), width, height, cols, rows, tiles }
}

/** Box-filter downscale of `src` into a `w`×`h` area of `dst` at (dx, dy). */
function downscaleInto(src: PNG, dst: PNG, dx: number, dy: number, w: number, h: number): void {
  const sx = src.width / w
  const sy = src.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4
          const a = src.data[i + 3]! / 255
          r += src.data[i]! * a + 255 * (1 - a)
          g += src.data[i + 1]! * a + 255 * (1 - a)
          b += src.data[i + 2]! * a + 255 * (1 - a)
          n++
        }
      }
      const o = ((dy + y) * dst.width + dx + x) * 4
      dst.data[o] = Math.round(r / n)
      dst.data[o + 1] = Math.round(g / n)
      dst.data[o + 2] = Math.round(b / n)
      dst.data[o + 3] = 255
    }
  }
}
