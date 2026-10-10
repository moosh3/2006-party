import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import type { ScheduleAccent, ScheduleEntry, ScheduleSettings } from '@/app/schedule/config';
import {
  emptyCaptionTrack,
  getCaptionTrack,
  normalizeCaptionFilename,
  type CaptionTrackFields,
} from '@/lib/captions';
import {
  MUX_SOURCE_TYPE,
  YOUTUBE_PLAYLIST_SOURCE_TYPE,
  parseYouTubePlaylistPlaybackId,
  type MediaSourceType,
} from '@/lib/youtube';

export type PlayoutMode = 'manual' | 'schedule';
export type ShowtimeAssetKind = 'vod' | 'live';
export type ScheduleStatus = 'before' | 'movie' | 'gap' | 'ended-early' | 'after';

type RawShowtime = {
  event?: RawEvent;
  assets?: Record<string, RawAsset>;
  schedule?: RawSlot[];
};

type RawEvent = {
  slug?: string;
  title?: string;
  date?: string;
  timezone?: string;
  channel?: string;
  defaultHoldAsset?: string;
  brandLine?: string;
  tagline?: string;
  stamp?: string;
  tzLabel?: string;
  homeHref?: string;
  joinUrl?: string;
  marathonArt?: string;
  ticker?: string[];
};

type RawAsset = {
  title?: string;
  playbackId?: string;
  assetId?: string;
  kind?: ShowtimeAssetKind;
  sourceType?: MediaSourceType;
  youtubePlaylistId?: string;
  sourceUrl?: string;
  durationSeconds?: number;
  rating?: string;
  runtime?: string;
  still?: string;
  captions?: string;
  blurb?: string;
  accent?: string;
};

type RawSlot = {
  id?: string;
  start?: string;
  end?: string;
  asset?: string;
  title?: string;
  blurb?: string;
  accent?: string;
};

export type ShowtimeEvent = Required<
  Pick<RawEvent, 'slug' | 'title' | 'date' | 'timezone' | 'channel' | 'defaultHoldAsset'>
> &
  Omit<RawEvent, 'slug' | 'title' | 'date' | 'timezone' | 'channel' | 'defaultHoldAsset'>;

export type ShowtimeAsset = Required<Pick<RawAsset, 'title' | 'playbackId'>> &
  RawAsset & {
    key: string;
    kind: ShowtimeAssetKind;
    sourceType: MediaSourceType;
    youtubePlaylistId?: string;
    sourceUrl?: string;
  };

export type ShowtimeSlot = Required<Pick<RawSlot, 'start' | 'end' | 'asset'>> &
  RawSlot & {
    id: string;
    asset: string;
    startMinute: number;
    endMinute: number;
    absoluteStartMinute: number;
    absoluteEndMinute: number;
    startUtcMs: number;
    endUtcMs: number;
    startIso: string;
    endIso: string;
    assetDetails: ShowtimeAsset;
  };

export type Showtime = {
  event: ShowtimeEvent;
  assets: Record<string, ShowtimeAsset>;
  schedule: ShowtimeSlot[];
};

export type ScheduleDisplayData = {
  settings: ScheduleSettings;
  schedule: ScheduleEntry[];
};

export type ResolvedSchedulePlayout = {
  mode: 'schedule';
  status: ScheduleStatus;
  playbackId: string;
  title: string;
  kind: ShowtimeAssetKind;
  isHoldScreen: boolean;
  playbackState: 'playing';
  playbackPosition: number;
  playbackUpdatedAt: string;
  playbackElapsedMs: number;
  activeSlotId: string | null;
  activeAssetKey: string | null;
  nextTransitionAt: string | null;
  eventSlug: string;
  scheduleTitle: string;
  sourceType: MediaSourceType;
  youtubePlaylistId: string | null;
  sourceUrl: string | null;
} & CaptionTrackFields;

let cachedShowtime: Showtime | null = null;
let cachedMtimeMs = 0;

export function loadShowtime(): Showtime {
  const filePath = getShowtimePath();
  const stats = fs.statSync(filePath);

  if (cachedShowtime && cachedMtimeMs === stats.mtimeMs) {
    return cachedShowtime;
  }

  const showtime = parseShowtimeYaml(fs.readFileSync(filePath, 'utf8'));

  cachedShowtime = showtime;
  cachedMtimeMs = stats.mtimeMs;

  return showtime;
}

export function parseShowtimeYaml(source: string): Showtime {
  return validateAndNormalize(parse(source) as RawShowtime);
}

export function getScheduleDisplayData(): ScheduleDisplayData {
  const showtime = loadShowtime();

  return {
    settings: {
      channel: showtime.event.channel,
      brandLine: showtime.event.brandLine || "WATCHIN' DA MOVIES",
      date: formatEventDate(showtime.event.date, showtime.event.timezone),
      stamp: showtime.event.stamp || 'All times CT',
      eventDate: showtime.event.date,
      timezone: showtime.event.timezone,
      tzLabel: showtime.event.tzLabel || 'CT',
      homeHref: showtime.event.homeHref || '/',
      joinUrl: showtime.event.joinUrl || '/event',
      stillsDir: '/assets/images/movie-stills',
      marathonArt:
        showtime.event.marathonArt ||
        '/assets/images/movie-stills/national-treasure.jpg',
      ticker: showtime.event.ticker || [
        'Schedule locked to Central Time',
        'Volume, captions, and fullscreen are yours',
        'Playback stays synced for the whole room',
      ],
      footerLeft: `© 2026 damovies.watch · ${showtime.event.title.toLowerCase()}`,
      footerRight: `CH 1 · ${showtime.event.channel} · all times ${showtime.event.tzLabel || 'CT'}`,
    },
    schedule: showtime.schedule.map((slot) => ({
      start: formatDisplayTime(slot.start),
      end: formatDisplayTime(slot.end),
      title: slot.title || slot.assetDetails.title,
      blurb: slot.blurb || slot.assetDetails.blurb || '',
      rating: slot.assetDetails.rating || '',
      runtime: slot.assetDetails.runtime || '',
      still: slot.assetDetails.still || '',
      accent: normalizeAccent(slot.accent || slot.assetDetails.accent),
      assetKey: slot.asset,
      playbackId: slot.assetDetails.playbackId,
      assetId: slot.assetDetails.assetId,
      captions: slot.assetDetails.captions,
      sourceType: slot.assetDetails.sourceType,
      youtubePlaylistId: slot.assetDetails.youtubePlaylistId,
      sourceUrl: slot.assetDetails.sourceUrl,
    })),
  };
}

export function resolveShowtimePlayout(
  now = new Date(),
  earlyEndedSlotId?: string | null,
  earlyEndedAt?: string | null
): ResolvedSchedulePlayout {
  return resolveShowtimePlayoutFor(loadShowtime(), now, earlyEndedSlotId, earlyEndedAt);
}

export function findShowtimeAssetByPlaybackId(playbackId?: string | null): ShowtimeAsset | null {
  if (!playbackId) return null;

  const showtime = loadShowtime();
  return Object.values(showtime.assets).find((asset) => asset.playbackId === playbackId) || null;
}

export function getCaptionTrackForPlaybackId(playbackId?: string | null): CaptionTrackFields {
  const asset = findShowtimeAssetByPlaybackId(playbackId);
  return getCaptionTrackForAsset(asset);
}

export function getCaptionTrackForAsset(asset?: ShowtimeAsset | null): CaptionTrackFields {
  return asset?.captions ? getCaptionTrack(asset.captions) : emptyCaptionTrack();
}

export function resolveShowtimePlayoutFor(
  showtime: Showtime,
  now = new Date(),
  earlyEndedSlotId?: string | null,
  earlyEndedAt?: string | null
): ResolvedSchedulePlayout {
  const nowMs = now.getTime();
  const holdAsset = showtime.assets[showtime.event.defaultHoldAsset];
  const firstSlot = showtime.schedule[0] ?? null;
  const lastSlot = showtime.schedule[showtime.schedule.length - 1] ?? null;

  if (!firstSlot || !lastSlot) {
    return holdPlayout(showtime, holdAsset, now, 'after', null, null, null, nowMs);
  }

  if (nowMs < firstSlot.startUtcMs) {
    return holdPlayout(
      showtime,
      holdAsset,
      now,
      'before',
      firstSlot.startIso,
      null,
      null,
      zonedDateTimeToUtcMs(showtime.event.date, 0, 0, showtime.event.timezone)
    );
  }

  for (let index = 0; index < showtime.schedule.length; index += 1) {
    const slot = showtime.schedule[index];
    const nextSlot = showtime.schedule[index + 1] ?? null;

    if (nowMs >= slot.startUtcMs && nowMs < slot.endUtcMs) {
      const duration = slot.assetDetails.durationSeconds;
      const mediaEndsAt = duration && slot.assetDetails.kind !== 'live'
        ? slot.startUtcMs + duration * 1000 : null;
      if (earlyEndedSlotId === slot.id || (mediaEndsAt !== null && nowMs >= mediaEndsAt)) {
        return holdPlayout(
          showtime,
          holdAsset,
          now,
          'ended-early',
          nextSlot?.startIso ?? slot.endIso,
          slot.id,
          slot.asset,
          mediaEndsAt !== null && nowMs >= mediaEndsAt ? mediaEndsAt : parseTimestamp(earlyEndedAt) ?? nowMs
        );
      }

      return {
        mode: 'schedule',
        status: 'movie',
        playbackId: slot.assetDetails.playbackId,
        title: slot.title || slot.assetDetails.title,
        kind: slot.assetDetails.kind,
        sourceType: slot.assetDetails.sourceType,
        youtubePlaylistId: slot.assetDetails.youtubePlaylistId || null,
        sourceUrl: slot.assetDetails.sourceUrl || null,
        isHoldScreen: false,
        playbackState: 'playing',
        playbackPosition: Math.max(0, (nowMs - slot.startUtcMs) / 1000),
        playbackUpdatedAt: now.toISOString(),
        playbackElapsedMs: 0,
        activeSlotId: slot.id,
        activeAssetKey: slot.asset,
        nextTransitionAt: slot.endIso,
        eventSlug: showtime.event.slug,
        scheduleTitle: showtime.event.title,
        ...getCaptionTrackForAsset(slot.assetDetails),
      };
    }

    if (nextSlot && nowMs >= slot.endUtcMs && nowMs < nextSlot.startUtcMs) {
      return holdPlayout(
        showtime,
        holdAsset,
        now,
        'gap',
        nextSlot.startIso,
        null,
        null,
        slot.endUtcMs
      );
    }
  }

  return holdPlayout(showtime, holdAsset, now, 'after', null, null, null, lastSlot.endUtcMs);
}

export function canMarkActiveSlotEnded(
  slotId: string,
  playbackId: string,
  now = new Date()
): boolean {
  const showtime = loadShowtime();
  const slot = showtime.schedule.find((entry) => entry.id === slotId);

  if (!slot || slot.assetDetails.playbackId !== playbackId) {
    return false;
  }

  const nowMs = now.getTime();
  if (nowMs < slot.startUtcMs || nowMs >= slot.endUtcMs) {
    return false;
  }

  const elapsedSeconds = (nowMs - slot.startUtcMs) / 1000;
  const scheduledSeconds = (slot.endUtcMs - slot.startUtcMs) / 1000;

  return elapsedSeconds >= Math.min(scheduledSeconds * 0.85, scheduledSeconds - 60);
}

function getShowtimePath() {
  return path.join(process.cwd(), 'showtime.yaml');
}

function validateAndNormalize(raw: RawShowtime): Showtime {
  if (!raw || typeof raw !== 'object') {
    throw new Error('showtime.yaml must contain an object');
  }

  const event = requireEvent(raw.event);
  const assets = requireAssets(raw.assets);
  const holdAsset = assets[event.defaultHoldAsset];

  if (!holdAsset) {
    throw new Error(`event.defaultHoldAsset "${event.defaultHoldAsset}" is not defined in assets`);
  }

  const schedule = requireSchedule(raw.schedule, event, assets);

  return { event, assets, schedule };
}

function requireEvent(rawEvent?: RawEvent): ShowtimeEvent {
  if (!rawEvent) {
    throw new Error('showtime.yaml missing event');
  }

  const required: Array<keyof ShowtimeEvent> = [
    'slug',
    'title',
    'date',
    'timezone',
    'channel',
    'defaultHoldAsset',
  ];

  for (const key of required) {
    if (!rawEvent[key]) {
      throw new Error(`event.${key} is required`);
    }
  }

  return rawEvent as ShowtimeEvent;
}

function requireAssets(rawAssets?: Record<string, RawAsset>): Record<string, ShowtimeAsset> {
  if (!rawAssets || typeof rawAssets !== 'object' || Object.keys(rawAssets).length === 0) {
    throw new Error('showtime.yaml must define at least one asset');
  }

  return Object.fromEntries(
    Object.entries(rawAssets).map(([key, asset]) => {
      if (!asset?.title) {
        throw new Error(`assets.${key}.title is required`);
      }
      if (!asset.playbackId) {
        throw new Error(`assets.${key}.playbackId is required`);
      }
      if (asset.durationSeconds !== undefined && (!Number.isFinite(asset.durationSeconds) || asset.durationSeconds <= 0)) {
        throw new Error(`assets.${key}.durationSeconds must be greater than 0`);
      }
      const sourceType = normalizeAssetSourceType(asset, key);
      const youtubePlaylistId =
        sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE
          ? asset.youtubePlaylistId || parseYouTubePlaylistPlaybackId(asset.playbackId) || undefined
          : undefined;

      if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE && !youtubePlaylistId) {
        throw new Error(`assets.${key}.youtubePlaylistId is required for YouTube playlist assets`);
      }

      const captions = asset.captions ? normalizeCaptionFilename(asset.captions) : undefined;

      return [
        key,
        {
          ...asset,
          key,
          title: asset.title,
          playbackId: asset.playbackId,
          captions,
          kind: asset.kind || 'vod',
          sourceType,
          youtubePlaylistId,
        },
      ];
    })
  );
}

function normalizeAssetSourceType(asset: RawAsset, key: string): MediaSourceType {
  const inferredSourceType = parseYouTubePlaylistPlaybackId(asset.playbackId)
    ? YOUTUBE_PLAYLIST_SOURCE_TYPE
    : MUX_SOURCE_TYPE;
  const sourceType = asset.sourceType || inferredSourceType;

  if (sourceType !== MUX_SOURCE_TYPE && sourceType !== YOUTUBE_PLAYLIST_SOURCE_TYPE) {
    throw new Error(`assets.${key}.sourceType must be mux or youtube_playlist`);
  }

  return sourceType;
}

function requireSchedule(
  rawSchedule: RawSlot[] | undefined,
  event: ShowtimeEvent,
  assets: Record<string, ShowtimeAsset>
): ShowtimeSlot[] {
  if (!Array.isArray(rawSchedule) || rawSchedule.length === 0) {
    throw new Error('showtime.yaml must define at least one schedule slot');
  }

  let dayOffset = 0;
  let previousStartMinute = -1;
  let previousEndMinute = -1;

  return rawSchedule.map((slot, index) => {
    if (!slot.start || !slot.end || !slot.asset) {
      throw new Error(`schedule[${index}] must include start, end, and asset`);
    }

    const asset = assets[slot.asset];
    if (!asset) {
      throw new Error(`schedule[${index}] references unknown asset "${slot.asset}"`);
    }

    const startMinute = parseClock(slot.start, `schedule[${index}].start`);
    const endMinute = parseClock(slot.end, `schedule[${index}].end`);

    if (endMinute === startMinute) {
      throw new Error(`schedule[${index}] end must be after start`);
    }

    if (startMinute < previousStartMinute) {
      dayOffset += 1;
    }

    const endDayOffset = endMinute <= startMinute ? dayOffset + 1 : dayOffset;
    const absoluteStartMinute = dayOffset * 1440 + startMinute;
    const absoluteEndMinute = endDayOffset * 1440 + endMinute;

    if (absoluteEndMinute <= absoluteStartMinute) {
      throw new Error(`schedule[${index}] end must be after start`);
    }

    if (previousEndMinute > absoluteStartMinute) {
      throw new Error(`schedule[${index}] overlaps the previous schedule slot`);
    }

    previousStartMinute = startMinute;
    previousEndMinute = absoluteEndMinute;

    const startUtcMs = zonedDateTimeToUtcMs(event.date, dayOffset, startMinute, event.timezone);
    const endUtcMs = zonedDateTimeToUtcMs(event.date, endDayOffset, endMinute, event.timezone);
    const id = slot.id || `${slugify(slot.asset)}-${slot.start.replace(':', '')}`;

    return {
      ...slot,
      id,
      start: slot.start,
      end: slot.end,
      asset: slot.asset,
      startMinute,
      endMinute,
      absoluteStartMinute,
      absoluteEndMinute,
      startUtcMs,
      endUtcMs,
      startIso: new Date(startUtcMs).toISOString(),
      endIso: new Date(endUtcMs).toISOString(),
      assetDetails: asset,
    };
  });
}

function holdPlayout(
  showtime: Showtime,
  holdAsset: ShowtimeAsset,
  now: Date,
  status: Exclude<ScheduleStatus, 'movie'>,
  nextTransitionAt: string | null,
  activeSlotId: string | null,
  activeAssetKey: string | null = null,
  holdSinceMs: number = now.getTime()
): ResolvedSchedulePlayout {
  const elapsedSeconds = (now.getTime() - holdSinceMs) / 1000;
  const playbackPosition = holdAsset.durationSeconds
    ? positiveModulo(elapsedSeconds, holdAsset.durationSeconds)
    : holdAsset.sourceType === MUX_SOURCE_TYPE ? Math.max(0, elapsedSeconds) : 0;

  return {
    mode: 'schedule',
    status,
    playbackId: holdAsset.playbackId,
    title: holdAsset.title,
    kind: holdAsset.kind,
    sourceType: holdAsset.sourceType,
    youtubePlaylistId: holdAsset.youtubePlaylistId || null,
    sourceUrl: holdAsset.sourceUrl || null,
    isHoldScreen: true,
    playbackState: 'playing',
    playbackPosition,
    playbackUpdatedAt: now.toISOString(),
    playbackElapsedMs: 0,
    activeSlotId,
    activeAssetKey,
    nextTransitionAt,
    eventSlug: showtime.event.slug,
    scheduleTitle: showtime.event.title,
    ...getCaptionTrackForAsset(holdAsset),
  };
}

function parseTimestamp(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function parseClock(clock: string, label: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  if (!match) {
    throw new Error(`${label} must be in HH:mm 24-hour format`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatDisplayTime(clock: string) {
  const minutes = parseClock(clock, 'time');
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? 'AM' : 'PM';

  return `${hour12}:${minute.toString().padStart(2, '0')} ${suffix}`;
}

function formatEventDate(date: string, timezone: string) {
  const dateTime = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).formatToParts(dateTime);

  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  const year = parts.find((part) => part.type === 'year')?.value || '';

  return `${weekday}, ${month} ${day} · ${year}`.toUpperCase();
}

function zonedDateTimeToUtcMs(
  eventDate: string,
  dayOffset: number,
  minuteOfDay: number,
  timezone: string
) {
  const target = addDays(eventDate, dayOffset);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desiredUtcMs = Date.UTC(target.year, target.month - 1, target.day, hour, minute, 0);
  let guess = desiredUtcMs;

  for (let index = 0; index < 4; index += 1) {
    const parts = getZonedParts(new Date(guess), timezone);
    const actualUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    guess -= actualUtcMs - desiredUtcMs;
  }

  return guess;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAccent(value?: string): ScheduleAccent {
  const accents: ScheduleAccent[] = ['lime', 'mint', 'yellow', 'frost2', 'frost3', 'pink', 'cream'];
  return accents.includes(value as ScheduleAccent) ? (value as ScheduleAccent) : 'lime';
}
