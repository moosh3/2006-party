import Mux from '@mux/mux-node';
import { SignJWT, importPKCS8, decodeJwt } from 'jose';
import { createHash, createPrivateKey } from 'node:crypto';
import { isDevelopment } from './config';

let muxClient: Mux | null = null;

function getMuxClient() {
  if (muxClient) return muxClient;

  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new Error('Mux API credentials are required for asset administration.');
  }

  muxClient = new Mux({ tokenId, tokenSecret });
  return muxClient;
}

export interface PlaybackTokenOptions {
  type?: 'video' | 'thumbnail' | 'storyboard';
  expiration?: string;
  params?: Record<string, any>;
  expiresAtEpochSeconds?: number;
}

function normalizeMuxPrivateKey(value: string): string {
  const normalizedValue = value.trim().replace(/\\n/g, '\n');
  const keyMaterial = normalizedValue.includes('-----BEGIN')
    ? normalizedValue
    : Buffer.from(normalizedValue, 'base64').toString('utf8').trim();

  // Mux signing keys have historically been supplied as either PKCS#1 or
  // PKCS#8 PEM. jose requires PKCS#8, so normalize both forms before import.
  return createPrivateKey(keyMaterial.replace(/\\n/g, '\n'))
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
}

export async function generatePlaybackToken(
  playbackId: string,
  options: PlaybackTokenOptions = {}
): Promise<string> {
  const {
    type = 'video',
    expiration = '1h',
    params = {},
    expiresAtEpochSeconds,
  } = options;

  // The built-in waiting slate is not a Mux asset.
  if (playbackId === 'demo-playback-id') {
    return 'unsigned';
  }

  // Check if signing keys are configured
  const hasSigningKeys = process.env.MUX_SIGNING_KEY_ID && 
                         process.env.MUX_SIGNING_KEY_PRIVATE &&
                         !isDevelopment();

  // If no signing keys, use unsigned playback (only works for public playback policies)
  if (!hasSigningKeys) {
    console.warn('⚠️ Mux signing keys not configured - using unsigned playback');
    console.warn('⚠️ This only works if your Mux playback policy is set to "public"');
    return 'unsigned'; // Special token that tells the player to use unsigned mode
  }

  try {
    // Generate signed token using jose library (already a dependency)
    // Mux uses RS256 with a private signing key.
    if (process.env.MUX_SIGNING_KEY_PRIVATE) {
      const privateKeyPem = normalizeMuxPrivateKey(process.env.MUX_SIGNING_KEY_PRIVATE);
      
      const token = await new SignJWT({
        sub: playbackId,
        aud: { video: 'v', thumbnail: 't', storyboard: 's' }[type],
        exp: expiresAtEpochSeconds ?? Math.floor(Date.now() / 1000) + (60 * 60),
      })
        .setProtectedHeader({ 
          alg: 'RS256',
          kid: process.env.MUX_SIGNING_KEY_ID,
        })
        .sign(await importPKCS8(privateKeyPem, 'RS256'));
      
      return token;
    }

    // If no private key, fall back to unsigned
    console.warn('⚠️ Could not generate signed token, falling back to unsigned playback');
    return 'unsigned';
  } catch (error) {
    console.error('Error generating Mux playback token:', error);
    console.warn('⚠️ Falling back to unsigned playback due to error');
    return 'unsigned';
  }
}

interface ProgramPlaybackToken {
  token: string;
  expiresAt: string;
}
const programTokenCache = new Map<string, ProgramPlaybackToken & { reuseUntil: number }>();
const pendingProgramTokens = new Map<string, Promise<ProgramPlaybackToken>>();
const playbackPolicyCache = new Map<string, { policy: string; expires: number }>();
const pendingPlaybackPolicies = new Map<string, Promise<string>>();

async function getPlaybackPolicy(playbackId: string): Promise<string> {
  const cached = playbackPolicyCache.get(playbackId);
  if (cached && cached.expires > Date.now()) return cached.policy;
  const pending = pendingPlaybackPolicies.get(playbackId);
  if (pending) return pending;
  const lookup = (async () => {
    const playback = await getMuxClient().video.playbackIds.retrieve(playbackId, { timeout: 10_000, maxRetries: 0 });
    if (!['public', 'signed'].includes(playback.policy)) throw new Error('Unsupported Mux playback policy');
    playbackPolicyCache.delete(playbackId);
    playbackPolicyCache.set(playbackId, { policy: playback.policy, expires: Date.now() + 3_600_000 });
    while (playbackPolicyCache.size > 128) playbackPolicyCache.delete(playbackPolicyCache.keys().next().value!);
    return playback.policy;
  })();
  pendingPlaybackPolicies.set(playbackId, lookup);
  while (pendingPlaybackPolicies.size > 128) pendingPlaybackPolicies.delete(pendingPlaybackPolicies.keys().next().value!);
  try { return await lookup; } finally {
    if (pendingPlaybackPolicies.get(playbackId) === lookup) pendingPlaybackPolicies.delete(playbackId);
  }
}

/** Keep a program's HLS URL stable across frequent clock snapshots. Tokens are
 * shared by the existing public program endpoint, not viewer-specific grants. */
export async function getProgramPlaybackToken(playbackId: string, durationSeconds?: number | null): Promise<ProgramPlaybackToken> {
  const unsigned = () => ({ token: 'unsigned', expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  if (playbackId === 'demo-playback-id' || isDevelopment()) return unsigned();
  // Mux explicitly rejects tokenized URLs for public playback IDs. Resolve
  // policy once per worker, rather than assuming all media needs signing.
  const policy = hasMuxApiCredentials() ? await getPlaybackPolicy(playbackId) : null;
  if (policy === 'public') return unsigned();
  if (!process.env.MUX_SIGNING_KEY_ID || !process.env.MUX_SIGNING_KEY_PRIVATE) {
    if (policy === 'signed') throw new Error('Mux signed playback requires configured signing keys');
    return unsigned();
  }
  // Every serverless worker must produce the SAME program URL. An in-memory
  // cache alone changes JWT expiry on cold starts or a different warm worker,
  // which can make HLS reload during a clock poll. RS256 is deterministic;
  // align program expiry to a shared 30-minute window (minimum 30-minute TTL).
  const windowMs = 1_800_000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const minimumLifetime = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.ceil(durationSeconds / 1800) * windowMs + windowMs : 3_600_000;
  const expiresAtEpochSeconds = (windowStart + Math.max(3_600_000, minimumLifetime)) / 1000;
  const keyFingerprint = createHash('sha256').update(process.env.MUX_SIGNING_KEY_PRIVATE).digest('hex');
  const key = `${process.env.MUX_SIGNING_KEY_ID}:${keyFingerprint}:${playbackId}:${windowStart}:${expiresAtEpochSeconds}`;
  const cached = programTokenCache.get(key);
  if (cached && cached.reuseUntil > Date.now()) {
    programTokenCache.delete(key);
    programTokenCache.set(key, cached);
    return { token: cached.token, expiresAt: cached.expiresAt };
  }
  programTokenCache.delete(key);
  const pending = pendingProgramTokens.get(key);
  if (pending) return pending;
  const generation = (async () => {
    const token = await generatePlaybackToken(playbackId, { expiresAtEpochSeconds });
    // Public playback already returned above. A signing failure must preserve
    // the last good client snapshot via 503, not send a guaranteed broken URL.
    if (token === 'unsigned') throw new Error('Signed Mux playback token unavailable');
    const expiry = Number(decodeJwt(token).exp) * 1000;
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Generated playback token has no valid expiry');
    const value = { token, expiresAt: new Date(expiry).toISOString() };
    programTokenCache.set(key, { ...value, reuseUntil: Math.min(windowEnd, expiry - 300_000) });
    while (programTokenCache.size > 128) programTokenCache.delete(programTokenCache.keys().next().value!);
    return value;
  })();
  pendingProgramTokens.set(key, generation);
  // Keep both maps bounded even if many distinct IDs are requested concurrently.
  while (pendingProgramTokens.size > 128) pendingProgramTokens.delete(pendingProgramTokens.keys().next().value!);
  try { return await generation; } finally {
    if (pendingProgramTokens.get(key) === generation) pendingProgramTokens.delete(key);
  }
}

export async function getMuxAsset(assetId: string) {
  const asset = await getMuxClient().video.assets.retrieve(assetId);
  return asset;
}

export function hasMuxApiCredentials(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

export class MuxVodTypeError extends Error {}

/** Resolve a playback ID to its VOD asset and use Mux's authoritative duration. */
export async function getMuxPlaybackDuration(playbackId: string): Promise<number> {
  const client = getMuxClient();
  const options = { timeout: 10_000, maxRetries: 0 };
  const playback = await client.video.playbackIds.retrieve(playbackId, options);
  if (playback.object.type !== 'asset') {
    throw new MuxVodTypeError('This playback ID belongs to a live stream. Add it with kind live; it cannot be used in an automatic VOD queue.');
  }
  const asset = await client.video.assets.retrieve(playback.object.id, options);
  if (asset.status !== 'ready' || typeof asset.duration !== 'number' || !Number.isFinite(asset.duration) || asset.duration <= 0) {
    throw new Error('The Mux asset is not ready or does not have a positive duration yet.');
  }
  return asset.duration;
}

export async function listMuxAssets() {
  const assets = await getMuxClient().video.assets.list({ limit: 100 });
  return assets;
}

export interface SubtitleTrackOptions {
  url: string;              // Public URL to the .srt file
  languageCode?: string;    // ISO 639-1 language code (e.g., 'en', 'es', 'fr')
  name?: string;            // Display name (e.g., 'English', 'Spanish')
  closedCaptions?: boolean; // Whether this is closed captions (default: false)
}

/**
 * Add a subtitle/caption track to a Mux VOD asset
 * 
 * @param assetId - The Mux asset ID (e.g., 'xAuUQlV5XNVAA02eLuzqoeSBWtA026GWIqsjQGFKs7XDs')
 * @param options - Subtitle track configuration
 * @returns The created track object
 * 
 * @example
 * ```typescript
 * await addSubtitleTrack('asset-id', {
 *   url: 'https://example.com/subtitles/english.srt',
 *   languageCode: 'en',
 *   name: 'English',
 *   closedCaptions: true
 * });
 * ```
 */
export async function addSubtitleTrack(
  assetId: string,
  options: SubtitleTrackOptions
) {
  const {
    url,
    languageCode = 'en',
    name = 'English',
    closedCaptions = false,
  } = options;

  try {
    const track = await getMuxClient().video.assets.createTrack(assetId, {
      url,
      type: 'text',
      text_type: 'subtitles',
      language_code: languageCode,
      name,
      closed_captions: closedCaptions,
    });

    console.log(`✅ Added subtitle track "${name}" to asset ${assetId}`);
    return track;
  } catch (error) {
    console.error(`❌ Failed to add subtitle track to asset ${assetId}:`, error);
    throw error;
  }
}

/**
 * Delete a subtitle track from a Mux VOD asset
 * 
 * @param assetId - The Mux asset ID
 * @param trackId - The track ID to delete
 */
export async function deleteSubtitleTrack(assetId: string, trackId: string) {
  try {
    await getMuxClient().video.assets.deleteTrack(assetId, trackId);
    console.log(`✅ Deleted subtitle track ${trackId} from asset ${assetId}`);
  } catch (error) {
    console.error(`❌ Failed to delete subtitle track ${trackId}:`, error);
    throw error;
  }
}

/**
 * List all tracks (including subtitles) for a Mux VOD asset
 * 
 * @param assetId - The Mux asset ID
 * @returns Array of tracks
 */
export async function listAssetTracks(assetId: string) {
  try {
    const asset = await getMuxClient().video.assets.retrieve(assetId);
    return asset.tracks || [];
  } catch (error) {
    console.error(`❌ Failed to list tracks for asset ${assetId}:`, error);
    throw error;
  }
}
