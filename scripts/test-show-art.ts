import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Original animation files from artisticaccessibility.com/2006/show.
// Captured source checksums and centisecond timings make verification permanent,
// even after the browser's temporary source bundle has been removed.
const original = {
  mk: {
    sourceId: '561c7e9cd25738bb',
    sha256: '45e29d09388f0de1af6c2244c7af991c031e2f0e05fafda64087fbb20abe2e9e',
    bytes: 26342,
    width: 100,
  },
  jen: {
    sourceId: '14365ce69217a37d',
    sha256: 'b3f45b124a623c57720c9e7e5b782f608c67512b244d3d1fcfd1727c8d0a60d2',
    bytes: 28398,
    width: 102,
  },
  lip: {
    sourceId: '2a7418d09f283265',
    sha256: 'f10f5075009a7355aff2210bdba3b7b97e2c2cc12cfdcdff3698d8840a463fcd',
    bytes: 22737,
    width: 83,
  },
  yongwoo: {
    sourceId: '6269cc6d347098e2',
    sha256: '4aded9fc883eb4377827e86e52a7f2cea30255d2bdb0333405c29d2530e238c0',
    bytes: 22953,
    width: 87,
  },
  emma: {
    sourceId: 'e69b0039c0e6b570',
    sha256: '2b9f74ec03455da7c1168fdc6a35a64f59c8acf4af7833ad1aad711bdb34dabe',
    bytes: 30382,
    width: 129,
  },
  alec: {
    sourceId: '943fa6703d9a77e7',
    sha256: '1c2acb796f83580f75aace2fc07ccc6f81cf6ad73b52a70b83098c8c50fb7c51',
    bytes: 23845,
    width: 106,
  },
} as const;

const originalAnimation = {
  height: 160,
  delaysCs: [13, 13, 13, 13, 13, 13, 13, 13],
  durationMs: 1040,
  loop: 0, // NETSCAPE repeat count: zero means repeat forever.
} as const;

function inspectGif(data: Buffer, name: string) {
  let offset = 0;
  function take(size: number): Buffer {
    assert(Number.isInteger(size) && size >= 0 && offset + size <= data.length,
      `${name}: truncated GIF block at byte ${offset}`);
    const bytes = data.subarray(offset, offset + size);
    offset += size;
    return bytes;
  }
  const byte = () => take(1)[0];
  function subBlocks(): Buffer {
    const chunks: Buffer[] = [];
    for (;;) {
      const size = byte();
      if (size === 0) return Buffer.concat(chunks);
      chunks.push(take(size));
    }
  }

  const header = take(6).toString('ascii');
  assert(header === 'GIF87a' || header === 'GIF89a', `${name}: invalid GIF signature`);
  const screen = take(7);
  const width = screen.readUInt16LE(0);
  const height = screen.readUInt16LE(2);
  assert(width > 0 && height > 0, `${name}: empty logical screen`);
  if (screen[4] & 0x80) take(3 * (1 << ((screen[4] & 0x07) + 1)));

  const delaysCs: number[] = [];
  let pendingDelayCs = 0;
  let loop: number | null = null;
  for (;;) {
    const marker = byte();
    if (marker === 0x3b) {
      assert.equal(offset, data.length, `${name}: unexpected bytes after GIF trailer`);
      break;
    }
    if (marker === 0x21) {
      const extension = byte();
      if (extension === 0xf9) {
        assert.equal(byte(), 4, `${name}: invalid graphic control size`);
        const control = take(4);
        pendingDelayCs = control.readUInt16LE(1);
        assert.equal(byte(), 0, `${name}: missing graphic control terminator`);
      } else if (extension === 0xff) {
        const application = take(byte()).toString('ascii');
        const payload = subBlocks();
        if (application === 'NETSCAPE2.0' || application === 'ANIMEXTS1.0') {
          assert.equal(payload.length, 3, `${name}: invalid animation loop block`);
          assert.equal(payload[0], 1, `${name}: invalid animation loop identifier`);
          loop = payload.readUInt16LE(1);
        }
      } else {
        // Comment, plain-text and unknown extension payloads are sub-block chains.
        // A plain-text rendering block consumes the preceding graphic control.
        subBlocks();
        if (extension === 0x01) pendingDelayCs = 0;
      }
      continue;
    }

    assert.equal(marker, 0x2c, `${name}: unexpected GIF marker at byte ${offset - 1}`);
    const image = take(9);
    const left = image.readUInt16LE(0);
    const top = image.readUInt16LE(2);
    const imageWidth = image.readUInt16LE(4);
    const imageHeight = image.readUInt16LE(6);
    assert(imageWidth > 0 && imageHeight > 0, `${name}: empty frame`);
    assert(left + imageWidth <= width && top + imageHeight <= height,
      `${name}: frame extends beyond logical screen`);
    if (image[8] & 0x80) take(3 * (1 << ((image[8] & 0x07) + 1)));
    const codeSize = byte();
    assert(codeSize >= 2 && codeSize <= 8, `${name}: invalid LZW minimum code size`);
    assert(subBlocks().length > 0, `${name}: empty frame image data`);
    delaysCs.push(pendingDelayCs);
    pendingDelayCs = 0;
  }

  assert(delaysCs.length > 1, `${name}: must retain more than one animation frame`);
  const durationMs = delaysCs.reduce((sum, delay) => sum + delay, 0) * 10;
  assert(durationMs > 0, `${name}: animation must have a nonzero duration`);
  return { width, height, frames: delaysCs.length, delaysCs, durationMs, loop };
}

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--source-dir'),
  'Usage: tsx scripts/test-show-art.ts [--source-dir PATH]');
const sourceDir = args.length ? resolve(args[1]) : null;
const castDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', '2006', 'cast');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const [name, expected] of Object.entries(original)) {
  const data = readFileSync(join(castDir, `${name}.gif`));
  const metadata = inspectGif(data, name);
  const sha256 = createHash('sha256').update(data).digest('hex');
  assert.equal(data.length, expected.bytes, `${name}: source byte length changed`);
  assert.equal(sha256, expected.sha256, `${name}: GIF differs from original source`);
  assert.equal(metadata.width, expected.width, `${name}: width changed`);
  assert.equal(metadata.height, originalAnimation.height, `${name}: height changed`);
  assert.deepEqual(metadata.delaysCs, originalAnimation.delaysCs, `${name}: frame timing changed`);
  assert.equal(metadata.durationMs, originalAnimation.durationMs, `${name}: cycle duration changed`);
  assert.equal(metadata.loop, originalAnimation.loop, `${name}: loop behavior changed`);

  const fallback = readFileSync(join(castDir, `${name}.png`));
  assert(fallback.subarray(0, 8).equals(pngSignature), `${name}: PNG fallback missing or invalid`);
  if (sourceDir) {
    const source = readFileSync(join(sourceDir, `${expected.sourceId}.gif`));
    assert(data.equals(source), `${name}: copied GIF is not byte-for-byte identical to source`);
  }
  console.log(`${name.padEnd(7)} ${metadata.width}×${metadata.height}  ${metadata.frames} frames × 130ms = ${metadata.durationMs}ms  loop=forever  sha256=${sha256}`);
}
console.log(`Show artwork verified: all 6 originals retain every frame and timing; PNG fallbacks exist${sourceDir ? '; source bytes match exactly' : ''}.`);
