import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST_RUNS } from '../lib/cast-runs';

// Structural inspection stays dependency-free and never opens a live service.
// SHA-256 proves all compressed pixel data is unchanged, not just the timing.
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

  const delaysMs: number[] = [];
  const transparentFrames: boolean[] = [];
  let pendingDelayMs = 0;
  let pendingTransparency = false;
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
        pendingDelayMs = control.readUInt16LE(1) * 10;
        pendingTransparency = Boolean(control[0] & 0x01);
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
        subBlocks();
        if (extension === 0x01) {
          pendingDelayMs = 0;
          pendingTransparency = false;
        }
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
    delaysMs.push(pendingDelayMs);
    transparentFrames.push(pendingTransparency);
    pendingDelayMs = 0;
    pendingTransparency = false;
  }

  return { width, height, frames: delaysMs.length, delaysMs,
    durationMs: delaysMs.reduce((sum, delay) => sum + delay, 0), loop, transparentFrames };
}

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--source-dir'),
  'Usage: node --import tsx scripts/test-cast-runs.ts [--source-dir PHOTOS_ORIGINALS_DIRECTORY]');
const sourceDir = args.length ? resolve(args[1]) : null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [name, expected] of Object.entries(CAST_RUNS)) {
  const data = readFileSync(join(root, 'public', expected.src));
  const metadata = inspectGif(data, name);
  const sha256 = createHash('sha256').update(data).digest('hex');
  assert.equal(data.length, expected.bytes, `${name}: source byte length changed`);
  assert.equal(sha256, expected.sha256, `${name}: GIF differs from the Photos original`);
  assert.equal(metadata.width, expected.width, `${name}: canvas width changed`);
  assert.equal(metadata.height, expected.height, `${name}: canvas height changed`);
  assert.equal(metadata.frames, expected.frames, `${name}: frames were added or dropped`);
  assert.deepEqual(metadata.delaysMs, expected.delaysMs, `${name}: original frame timing changed`);
  assert.equal(metadata.durationMs, expected.durationMs, `${name}: full animation duration changed`);
  assert.equal(metadata.loop, expected.loop, `${name}: one-shot behavior changed`);
  assert(metadata.delaysMs.every(delay => delay > 0), `${name}: zero-delay frame`);
  assert(metadata.transparentFrames.every(Boolean), `${name}: a frame lost its transparency flag`);
  if (sourceDir) {
    const source = readFileSync(join(sourceDir, expected.sourceSubdirectory, `${expected.sourceUUID}.gif`));
    assert(data.equals(source), `${name}: copied GIF is not byte-for-byte identical to the Photos original`);
  }
  console.log(`${name.padEnd(7)} ${metadata.width}×${metadata.height}  ${metadata.frames} frames  ${metadata.durationMs}ms  transparent/one-shot  sha256=${sha256}`);
}
console.log(`Running artwork verified: all six originals retain every frame, delay and transparent pixel${sourceDir ? '; Photos source bytes match exactly' : ''}.`);
