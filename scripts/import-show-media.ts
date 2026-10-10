/** Plan by default. --apply adds only missing media-library rows; never
 * queues videos, starts playback, edits Mux assets, or copies credentials. */
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import Mux from '@mux/mux-node';
import { createClient } from '@supabase/supabase-js';
import { SHOW_MEDIA } from '../lib/show-media';

async function main() {
  const args = process.argv.slice(2);
  const muxEnvIndex = args.indexOf('--mux-env');
  const muxEnvFile = muxEnvIndex >= 0 ? args[muxEnvIndex + 1] : '.env.local';
  if (!muxEnvFile || muxEnvFile.startsWith('--')) throw new Error('--mux-env requires a local environment-file path');
  const muxEnv = parse(readFileSync(muxEnvFile));
  const dbEnv = parse(readFileSync('.env.local'));
  if (!muxEnv.MUX_TOKEN_ID || !muxEnv.MUX_TOKEN_SECRET || !dbEnv.NEXT_PUBLIC_SUPABASE_URL || !dbEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Required server credentials are missing; no changes made');
  }
  const mux = new Mux({ tokenId: muxEnv.MUX_TOKEN_ID, tokenSecret: muxEnv.MUX_TOKEN_SECRET });
  const db = createClient(dbEnv.NEXT_PUBLIC_SUPABASE_URL, dbEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const readState = async () => {
    const [stream, queue] = await Promise.all([
      db.from('current_stream').select('id,playback_id,playback_state,playback_session_id,playout_mode,auto_advance_enabled,hold_screen_enabled').eq('id', 1),
      db.from('video_queue').select('id,mux_item_id,position').order('position'),
    ]);
    if (stream.error || queue.error) throw new Error('Unable to inspect current feed and queue; no playback changes made');
    return JSON.stringify({ stream: stream.data, queue: queue.data });
  };
  const before = await readState();
  const verified = [];
  // Five bounded sequential reads avoid adding to dashboard/API rate pressure.
  for (const media of SHOW_MEDIA) {
    const asset = await mux.video.assets.retrieve(media.assetId, { timeout: 10_000, maxRetries: 0 });
    const playback = asset.playback_ids?.find(p => p.id === media.playbackId && p.policy === 'public');
    // This Mux SDK predates the metadata field; validate the returned API value.
    const metadata = (asset as typeof asset & { meta?: { title?: string } }).meta;
    if (asset.status !== 'ready' || !playback || metadata?.title !== media.title
      || typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0
      || Math.abs(asset.duration - media.durationSeconds) > 0.001) {
      throw new Error(`Mux metadata differs for ${media.key}; no library changes made`);
    }
    verified.push({ playback_id: media.playbackId, label: media.title, kind: 'vod', duration_seconds: asset.duration,
      source_type: 'mux', youtube_playlist_id: null, source_url: null });
  }
  const existing = await db.from('mux_items').select('id,playback_id,label,duration_seconds').in('playback_id', verified.map(m => m.playback_id));
  if (existing.error) throw new Error('Unable to inspect media library');
  const present = new Set(existing.data.map(m => m.playback_id));
  const missing = verified.filter(m => !present.has(m.playback_id));
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'plan', verified: verified.length,
    alreadyPresent: existing.data.length, additions: missing.map(m => ({ title: m.label, durationSeconds: m.duration_seconds })) }));
  if (args.includes('--apply') && missing.length) {
    // Ignore a simultaneous duplicate without overwriting operator metadata.
    const added = await db.from('mux_items').upsert(missing, { onConflict: 'playback_id', ignoreDuplicates: true }).select('id,playback_id,label,duration_seconds');
    if (added.error) throw new Error(`Media-library insertion failed (${added.error.code}); current feed and queue were not edited`);
    console.log(JSON.stringify({ inserted: added.data.length, items: added.data }));
  }
  const after = await readState();
  console.log(JSON.stringify({ feedAndQueueUnchanged: before === after }));
  if (before !== after) console.warn('Playback state changed during import, possibly by an operator; it was not restored or overwritten.');
}

main().catch((error: unknown) => {
  // Never print provider error bodies/headers or credential values.
  const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
  if (status !== undefined) console.error(`Provider request failed (HTTP ${String(status)}); credentials were not disclosed.`);
  else console.error(error instanceof Error ? error.message : 'Media import failed');
  process.exitCode = 1;
});
