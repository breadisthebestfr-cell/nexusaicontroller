// Generates build/icon.png (512x512) for the installer/app icon — a gradient hub mark.
// Pure Node (zlib), no deps. Run: node scripts/gen-icon.mjs
import zlib from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const S = 512
const cx = S / 2
const cy = S / 2

// Brand colors (accent -> accent-2).
const a = [0x4f, 0x8c, 0xff]
const b = [0x7c, 0x5c, 0xff]
const lerp = (x, y, t) => Math.round(x + (y - x) * t)

const raw = Buffer.alloc(S * (S * 4 + 1))
let o = 0
for (let y = 0; y < S; y++) {
  raw[o++] = 0 // filter: none
  for (let x = 0; x < S; x++) {
    const t = (x + y) / (2 * (S - 1))
    let r = lerp(a[0], b[0], t)
    let g = lerp(a[1], b[1], t)
    let bl = lerp(a[2], b[2], t)
    const d = Math.hypot(x - cx, y - cy)
    // White ring + center dot ("hub").
    const inRing = d >= 150 && d <= 184
    const inDot = d <= 62
    if (inRing || inDot) {
      r = g = bl = 255
    }
    raw[o++] = r
    raw[o++] = g
    raw[o++] = bl
    raw[o++] = 255
  }
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
console.log(`wrote build/icon.png (${png.length} bytes)`)
