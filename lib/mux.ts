import Mux from '@mux/mux-node';
import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'node:crypto';
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
        aud: type,
        exp: Math.floor(Date.now() / 1000) + (60 * 60), // 1 hour from now
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

export async function getMuxAsset(assetId: string) {
  const asset = await getMuxClient().video.assets.retrieve(assetId);
  return asset;
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
