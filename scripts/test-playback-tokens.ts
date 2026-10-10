/** Isolated signing regression. Uses an ephemeral key, no dotenv/live services. */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { decodeJwt } from 'jose';
import { PlaybackIDs } from '@mux/mux-node/resources/video/playback-ids';

async function main() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  Object.assign(process.env, { NODE_ENV: 'production' });
  process.env.NEXT_PUBLIC_DEV_MODE = 'false';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://isolated-token-test.invalid';
  process.env.MUX_SIGNING_KEY_ID = 'isolated-test-key';
  delete process.env.MUX_TOKEN_ID;
  delete process.env.MUX_TOKEN_SECRET;
  process.env.MUX_SIGNING_KEY_PRIVATE = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const { getProgramPlaybackToken } = await import('../lib/mux');
  const originalNow = Date.now;
  let now = Math.floor(originalNow() / 1_800_000) * 1_800_000 + 60_000;
  Date.now = () => now;
  try {
    const first = await getProgramPlaybackToken('isolated-playback-id');
    const payload = decodeJwt(first.token);
    assert.equal(payload.sub, 'isolated-playback-id');
    assert.equal(payload.aud, 'v');
    assert(Number(payload.exp) * 1000 - now >= 1_800_000);
    const expiry = first.expiresAt;
    now += 300_000;
    assert.deepEqual(await getProgramPlaybackToken('isolated-playback-id'), first);
    const coldWorker = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `Date.now=()=>${now}; const m=await import('./lib/mux.ts'); const f=m.getProgramPlaybackToken||m.default.getProgramPlaybackToken; console.log(JSON.stringify(await f('isolated-playback-id')));`],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(coldWorker), first, 'Another cold worker must sign the identical program URL');
    now = Math.floor(now / 1_800_000) * 1_800_000 + 1_800_000;
    const renewed = await getProgramPlaybackToken('isolated-playback-id');
    assert.notEqual(renewed.token, first.token);
    assert.notEqual(renewed.expiresAt, expiry);
    assert.equal(Number(decodeJwt(renewed.token).exp) * 1000 - now, 3_600_000);
    const longVideo = await getProgramPlaybackToken('isolated-long-video', 7_201.5);
    assert(Number(decodeJwt(longVideo.token).exp) * 1000 - now > 7_201_500);
    assert.equal((await getProgramPlaybackToken('demo-playback-id')).token, 'unsigned');
    const apiPrototype = PlaybackIDs.prototype as unknown as { retrieve: (id: string) => unknown };
    const originalRetrieve = apiPrototype.retrieve;
    const originalKey = process.env.MUX_SIGNING_KEY_PRIVATE;
    let lookups = 0;
    Object.assign(process.env, { MUX_TOKEN_ID: 'isolated-api-id', MUX_TOKEN_SECRET: 'isolated-api-secret' });
    apiPrototype.retrieve = async (id) => {
      lookups++;
      return { id, policy: id.includes('public') ? 'public' : 'signed', object: { type: 'asset', id: 'isolated-asset' } };
    };
    try {
      const publics = await Promise.all([getProgramPlaybackToken('isolated-public'), getProgramPlaybackToken('isolated-public')]);
      assert(publics.every((value) => value.token === 'unsigned'));
      assert.equal(lookups, 1, 'Concurrent policy lookup is deduplicated');
      assert.equal((await getProgramPlaybackToken('isolated-public')).token, 'unsigned');
      assert.equal(lookups, 1, 'Public policy lookup is cached');
      assert.equal(decodeJwt((await getProgramPlaybackToken('isolated-signed')).token).aud, 'v');
      delete process.env.MUX_SIGNING_KEY_PRIVATE;
      await assert.rejects(getProgramPlaybackToken('isolated-signed-missing-key'), /requires configured signing keys/);
      assert.equal((await getProgramPlaybackToken('isolated-public')).token, 'unsigned');
    } finally {
      apiPrototype.retrieve = originalRetrieve;
      process.env.MUX_SIGNING_KEY_PRIVATE = originalKey;
      delete process.env.MUX_TOKEN_ID;
      delete process.env.MUX_TOKEN_SECRET;
    }
    console.log('PASS: warm and cold workers use identical signed program URLs within a clock window; expiry renews safely.');
    console.log('PASS: public IDs are never signed; signed IDs use aud v and reject missing keys; policy lookups are cached/deduplicated.');
  } finally { Date.now = originalNow; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
