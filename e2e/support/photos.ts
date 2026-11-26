import { deflateSync } from 'node:zlib'

export interface PhotoFile {
  name: string
  mimeType: string
  buffer: Buffer
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

let counter = 0

/**
 * A small, valid PNG that is different every call (unless you pass the same seed).
 * The mock model treats two photos as the same problem only when they are byte-identical,
 * so unique photos keep unrelated tests from ever being merged as duplicates.
 */
export function makePhoto(seed: number = Date.now() + ++counter * 7919, name = `report-${seed}.png`): PhotoFile {
  const width = 64
  const height = 48
  const r = (seed * 37) % 256
  const g = (seed * 91) % 256
  const b = (seed * 53) % 256
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 3
      const stripe = (x + y + seed) % 16 < 8 ? 0 : 40
      raw[i] = (r + stripe) % 256
      raw[i + 1] = (g + stripe) % 256
      raw[i + 2] = (b + stripe) % 256
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return { name, mimeType: 'image/png', buffer: png }
}

/** Claims to be a PNG but is plain text (TC-014). */
export function notAnImage(): PhotoFile {
  return { name: 'not-really.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image, just text') }
}

/** Just over the backend's 15 MB limit (TC-015). */
export function oversizedPhoto(): PhotoFile {
  const header = makePhoto().buffer
  return { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.concat([header, Buffer.alloc(15 * 1024 * 1024 + 1024)]) }
}
