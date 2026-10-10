import assert from 'node:assert/strict';
import { getCaptionTrack, srtToWebVtt } from '../lib/captions';
import { loadShowtime, parseShowtimeYaml, resolveShowtimePlayoutFor } from '../lib/showtime';
import {
  extractYouTubePlaylistId,
  makeYouTubePlaylistPlaybackId,
  mapYouTubePlaylistApiItem,
  parseYouTubePlaylistPlaybackId,
} from '../lib/youtube';
import { fetchYouTubePlaylistItems } from '../lib/youtube-playlist';

const baseYaml = `
event:
  slug: test-show
  title: Test Show
  date: 2026-07-04
  timezone: America/Chicago
  channel: TEST
  defaultHoldAsset: hold
assets:
  hold:
    title: Hold
    playbackId: hold-playback
  movie:
    title: Movie
    playbackId: movie-playback
schedule:
  - id: movie-one
    start: "09:00"
    end: "10:00"
    asset: movie
`;

function expectInvalid(source: string, message: RegExp) {
  assert.throws(() => parseShowtimeYaml(source), message);
}

const showtime = loadShowtime();

assert.equal(showtime.event.slug, 'cage-a-thon-2026');
assert.equal(showtime.assets['national-treasure'].assetId, 'lYOIuSPBfwair3597nD8P5JTlLX5VsArV3A8KDK8kow');
assert.equal(showtime.assets['national-treasure'].playbackId, '5K0001THGMsHg02oRgspFcKcR1sEqtr00ZpcvM8AUdOtO1A');
assert.equal(showtime.assets['national-treasure'].captions, 'national-treasure-2004.srt');
assert.equal(showtime.assets['easter-hold'].sourceType, 'youtube_playlist');
assert.equal(showtime.assets['easter-hold'].youtubePlaylistId, 'PLsTN7jx6BmIkqKbcU_HeUo3YRbEn9OGZh');
assert.equal(showtime.schedule.at(-1)?.id, 'national-treasure-encore');
assert.ok(showtime.schedule.at(-1)!.absoluteEndMinute > showtime.schedule.at(-1)!.absoluteStartMinute);

const captionTrack = getCaptionTrack(showtime.assets['valley-girl'].captions);
assert.equal(captionTrack.captionUrl, '/api/captions/valley-girl-1983.vtt');
assert.equal(captionTrack.captionLanguage, 'en');

const convertedCaptions = srtToWebVtt('1\n00:00:01,250 --> 00:00:03,000\nhi');
assert.match(convertedCaptions, /^WEBVTT/);
assert.match(convertedCaptions, /00:00:01\.250 --> 00:00:03\.000/);

const before = resolveShowtimePlayoutFor(showtime, new Date('2026-07-04T13:30:00.000Z'));
assert.equal(before.status, 'before');
assert.equal(before.isHoldScreen, true);
assert.equal(before.playbackPosition, 0);
assert.equal(before.sourceType, 'youtube_playlist');
assert.equal(before.youtubePlaylistId, 'PLsTN7jx6BmIkqKbcU_HeUo3YRbEn9OGZh');
assert.equal(before.captionUrl, null);

const nationalTreasure = resolveShowtimePlayoutFor(showtime, new Date('2026-07-04T15:00:00.000Z'));
assert.equal(nationalTreasure.status, 'movie');
assert.equal(nationalTreasure.activeSlotId, 'national-treasure-am');
assert.equal(nationalTreasure.playbackPosition, 1800);
assert.equal(nationalTreasure.captionUrl, '/api/captions/national-treasure-2004.vtt');

const firstGap = resolveShowtimePlayoutFor(showtime, new Date('2026-07-04T16:50:00.000Z'));
assert.equal(firstGap.status, 'gap');
assert.equal(firstGap.isHoldScreen, true);
assert.equal(firstGap.playbackPosition, 0);

const endedEarly = resolveShowtimePlayoutFor(
  showtime,
  new Date('2026-07-04T16:20:00.000Z'),
  'national-treasure-am',
  '2026-07-04T16:15:00.000Z'
);
assert.equal(endedEarly.status, 'ended-early');
assert.equal(endedEarly.isHoldScreen, true);
assert.equal(endedEarly.playbackPosition, 0);

const timedShow = parseShowtimeYaml(baseYaml.replace('playbackId: movie-playback', 'playbackId: movie-playback\n    durationSeconds: 600'));
const automaticScheduledHold = resolveShowtimePlayoutFor(timedShow, new Date('2026-07-04T14:11:00.000Z'));
assert.equal(automaticScheduledHold.status, 'ended-early');
assert.equal(automaticScheduledHold.isHoldScreen, true);
assert.equal(automaticScheduledHold.playbackPosition, 60);

const wallClockTakeover = resolveShowtimePlayoutFor(
  showtime,
  new Date('2026-07-04T17:05:00.000Z'),
  'national-treasure-am'
);
assert.equal(wallClockTakeover.status, 'movie');
assert.equal(wallClockTakeover.activeSlotId, 'valley-girl');

const after = resolveShowtimePlayoutFor(showtime, new Date('2026-07-05T08:00:00.000Z'));
assert.equal(after.status, 'after');
assert.equal(after.isHoldScreen, true);

expectInvalid(
  baseYaml.replace('playbackId: movie-playback', ''),
  /assets\.movie\.playbackId is required/
);

expectInvalid(
  baseYaml.replace('asset: movie', 'asset: missing-movie'),
  /references unknown asset/
);

expectInvalid(
  baseYaml.replace(
    '  - id: movie-one\n    start: "09:00"\n    end: "10:00"\n    asset: movie',
    '  - id: movie-one\n    start: "09:00"\n    end: "10:00"\n    asset: movie\n  - id: overlap\n    start: "09:30"\n    end: "11:00"\n    asset: movie'
  ),
  /overlaps/
);

expectInvalid(
  baseYaml.replace('end: "10:00"', 'end: "09:00"'),
  /end must be after start/
);

const overnight = parseShowtimeYaml(
  baseYaml.replace('end: "10:00"', 'end: "01:00"')
);
assert.equal(overnight.schedule[0].absoluteEndMinute, 1500);

const playlistId = 'PL1234567890abcdef';
assert.equal(
  extractYouTubePlaylistId(`https://www.youtube.com/playlist?list=${playlistId}`),
  playlistId
);
assert.equal(
  extractYouTubePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${playlistId}`),
  playlistId
);
assert.equal(
  extractYouTubePlaylistId(`https://youtu.be/dQw4w9WgXcQ?list=${playlistId}`),
  playlistId
);
assert.equal(extractYouTubePlaylistId(playlistId), playlistId);
assert.equal(parseYouTubePlaylistPlaybackId(makeYouTubePlaylistPlaybackId(playlistId)), playlistId);
assert.throws(() => extractYouTubePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), /list/);
assert.throws(() => extractYouTubePlaylistId('not a playlist'), /Invalid/);

const mappedVideo = mapYouTubePlaylistApiItem(
  {
    snippet: {
      title: 'Clip One',
      position: 7,
      thumbnails: {
        default: { url: 'https://img.youtube.com/default.jpg' },
        high: { url: 'https://img.youtube.com/high.jpg' },
      },
      resourceId: { videoId: 'abc123' },
      publishedAt: '2026-07-04T10:00:00Z',
    },
    contentDetails: {
      videoPublishedAt: '2026-07-04T11:00:00Z',
    },
  },
  0
);
assert.deepEqual(mappedVideo, {
  videoId: 'abc123',
  title: 'Clip One',
  thumbnailUrl: 'https://img.youtube.com/high.jpg',
  position: 7,
  publishedAt: '2026-07-04T11:00:00Z',
});
assert.equal(
  mapYouTubePlaylistApiItem({ snippet: { title: 'Private video', position: 0 } }, 0),
  null
);

async function testYouTubePlaylistFetch() {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.YOUTUBE_API_KEY;
  const requestedUrls: string[] = [];

  process.env.YOUTUBE_API_KEY = 'test-youtube-key';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    const parsed = new URL(url);
    const pageToken = parsed.searchParams.get('pageToken');

    if (!pageToken) {
      return new Response(JSON.stringify({
        nextPageToken: 'page-2',
        items: [
          {
            snippet: {
              title: 'First Clip',
              position: 0,
              thumbnails: { medium: { url: 'https://img.youtube.com/first.jpg' } },
              resourceId: { videoId: 'first-video' },
            },
            contentDetails: { videoPublishedAt: '2026-07-04T12:00:00Z' },
          },
        ],
      }), { status: 200 });
    }

    return new Response(JSON.stringify({
      items: [
        {
          snippet: {
            title: 'Second Clip',
            position: 1,
            thumbnails: { maxres: { url: 'https://img.youtube.com/second.jpg' } },
            resourceId: { videoId: 'second-video' },
          },
          contentDetails: { videoPublishedAt: '2026-07-04T12:05:00Z' },
        },
      ],
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const videos = await fetchYouTubePlaylistItems('PL1234567890abcdef');

    assert.equal(videos.length, 2);
    assert.equal(videos[0].videoId, 'first-video');
    assert.equal(videos[1].videoId, 'second-video');
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /playlistId=PL1234567890abcdef/);
    assert.match(requestedUrls[1], /pageToken=page-2/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = originalApiKey;
    }
  }
}

testYouTubePlaylistFetch()
  .then(() => {
    console.log('showtime validation passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
