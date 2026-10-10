/** Pure parsers + stubbed OFFICIAL metadata API. No live credentials/requests. */
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId, makeYouTubeVideoPlaybackId, makeYouTubeVideoUrl,
  parseYouTubeVideoPlaybackId, extractYouTubePlaylistId,
} from '../lib/youtube';
import { fetchYouTubeVideoMetadata, parseYouTubeDuration, YouTubeVideoValidationError } from '../lib/youtube-video';

const ID = 'AbCdE_fG-12';
async function main() {
  for (const input of [ID, `https://www.youtube.com/watch?v=${ID}&list=PL1234567890`,
    `https://youtu.be/${ID}?t=30`, `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`, `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/live/${ID}`]) assert.equal(extractYouTubeVideoId(input), ID);
  for (const input of ['', 'too-short', `https://youtube.com.evil.test/watch?v=${ID}`,
    `https://youtu.be.evil.test/${ID}`, `javascript://youtube.com/watch?v=${ID}`,
    `https://evil.test@youtube.com/watch?v=${ID}`, 'https://www.youtube.com/playlist?list=PL1234567890',
    `https://youtu.be/${ID}/extra`, `https://youtube.com/watch?v=${ID}x`]) assert.throws(() => extractYouTubeVideoId(input));
  assert.equal(makeYouTubeVideoPlaybackId(ID), `youtube:video:${ID}`);
  assert.equal(parseYouTubeVideoPlaybackId(`youtube:video:${ID}`), ID);
  assert.equal(parseYouTubeVideoPlaybackId(`youtube:playlist:${ID}`), null);
  assert.equal(parseYouTubeVideoPlaybackId('youtube:video:bad'), null);
  assert.equal(makeYouTubeVideoUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(extractYouTubePlaylistId('https://www.youtube.com/playlist?list=PL1234567890'), 'PL1234567890');
  for (const [input, expected] of [['PT3M1.5S', 181.5], ['P1DT2H3M4S', 93784], ['PT60S', 60],
    ['PT0S', null], ['P', null], ['PT', null], ['P1Y', null], ['P2M', null], ['PTInfinityS', null], ['PT-1S', null]] as const) {
    assert.equal(parseYouTubeDuration(input), expected, input);
  }
  console.log('PASS: video URL/ID normalization is strict, canonical and independent from playlists; finite ISO durations preserve fractions.');

  const oldFetch = globalThis.fetch;
  const oldKey = process.env.YOUTUBE_API_KEY;
  let requests = 0;
  const video = (overrides: object = {}) => ({ id: ID, snippet: { title: 'Captioned video', liveBroadcastContent: 'none' },
    contentDetails: { duration: 'PT3M1.5S', caption: 'true' },
    status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' }, ...overrides });
  const respond = (body: unknown, status = 200) => {
    globalThis.fetch = async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/videos');
      assert.equal(url.searchParams.get('id'), ID);
      assert.equal(url.searchParams.get('part'), 'snippet,contentDetails,status');
      assert.equal(init?.cache, 'no-store');
      assert(init?.signal, 'Metadata request is bounded by a timeout');
      return new Response(JSON.stringify(body), { status });
    };
  };
  try {
    delete process.env.YOUTUBE_API_KEY;
    await assert.rejects(fetchYouTubeVideoMetadata(ID), /not configured/);
    assert.equal(requests, 0);
    process.env.YOUTUBE_API_KEY = 'isolated-test-key-not-a-secret';
    respond({ items: [video()] });
    const metadata = await fetchYouTubeVideoMetadata(ID);
    assert.equal(metadata.durationSeconds, 181.5);
    assert.equal(metadata.captionsAvailable, true);
    assert.equal(metadata.title, 'Captioned video');
    assert.deepEqual(metadata.warnings, []);
    for (const caption of ['false', undefined, 'unexpected']) {
      respond({ items: [video({ contentDetails: { duration: 'PT3M1.5S', caption } })] });
      const automatic = await fetchYouTubeVideoMetadata(ID);
      assert.equal(automatic.captionsAvailable, null, 'Negative/missing metadata is unverified, not proof of absent captions');
      assert.equal(automatic.durationSeconds, 181.5);
      assert.equal(automatic.title, 'Captioned video');
      assert.equal(automatic.warnings.length, 1);
      assert.match(automatic.warnings[0], /unverified.*Auto-generated captions.*embedded player/);
    }
    for (const item of [
      video({ status: { embeddable: false } }), video({ status: { privacyStatus: 'private' } }),
      video({ snippet: { liveBroadcastContent: 'live' } }), video({ snippet: { liveBroadcastContent: 'upcoming' } }),
      video({ contentDetails: { duration: 'PT0S', caption: 'true' } }),
      video({ contentDetails: { duration: 'PT3M', caption: 'true', contentRating: { ytRating: 'ytAgeRestricted' } } }),
      video({ status: { uploadStatus: 'failed' } }),
      video({ contentDetails: { duration: 'PT3M', caption: 'false' }, status: { embeddable: false } }),
      video({ contentDetails: { duration: 'PT3M', caption: 'false', contentRating: { ytRating: 'ytAgeRestricted' } } }),
      video({ contentDetails: { duration: 'PT0S', caption: 'false' } }),
    ]) {
      respond({ items: [item] });
      await assert.rejects(fetchYouTubeVideoMetadata(ID), YouTubeVideoValidationError);
    }
    respond({ items: [] });
    await assert.rejects(fetchYouTubeVideoMetadata(ID), YouTubeVideoValidationError);
    respond({ items: [video({ status: {}, contentDetails: { duration: 'PT3M', regionRestriction: { blocked: ['US'] } } })] });
    const uncertain = await fetchYouTubeVideoMetadata(ID);
    assert.equal(uncertain.captionsAvailable, null);
    assert.equal(uncertain.warnings.length, 3);
    respond({ error: { message: 'Upstream test URL?key=isolated-test-key-not-a-secret' } }, 403);
    await assert.rejects(fetchYouTubeVideoMetadata(ID), (error: Error) => {
      assert.doesNotMatch(error.message, /isolated-test-key|Upstream|key=/);
      return /unavailable \(403\)/.test(error.message);
    });
    globalThis.fetch = async () => { throw new Error('Network request https://secret.test/?key=do-not-log'); };
    await assert.rejects(fetchYouTubeVideoMetadata(ID), (error: Error) => !error.message.includes('do-not-log'));
    console.log('PASS: official metadata validates captioned finite embeds; known unsuitable videos are hard failures, uncertain metadata warns and upstream secrets never escape.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = oldKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
