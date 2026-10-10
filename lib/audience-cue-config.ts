import type { AudienceCue } from './audience-cues';

export type AudienceCueConfig = {
  enabled: boolean;
  /** A unique show run, not the date of an asset upload or a playback revision. */
  showId: string;
  cues: readonly AudienceCue[];
};

/** Deliberately unarmed. Fill explicit real media IDs and offsets after rehearsal.
 * Public media metadata is in show-media.ts; titles do not imply cue behavior. */
const DISABLED_AUDIENCE_CUES: AudienceCueConfig = {
  enabled: false,
  showId: '',
  cues: [],
};

// Explicit synthetic offsets for scripts/playout-preview.ts only. Next removes
// this branch in production; a URL or viewer cannot enable production cues.
const REHEARSAL_AUDIENCE_CUES: AudienceCueConfig = {
  enabled: true,
  showId: 'isolated-cue-rehearsal-v1',
  cues: [
    { id: 'rehearsal-essay', enabled: true, match: { playbackId: 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs' },
      startSeconds: 40, endSeconds: 60, action: { type: 'essay', promptIndex: 0 } },
    { id: 'rehearsal-commercial', enabled: true, match: { playbackId: 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs' },
      startSeconds: 80, endSeconds: 100, action: { type: 'commercial' } },
    { id: 'rehearsal-poll', enabled: true, match: { playbackId: 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs' },
      startSeconds: 80, endSeconds: 100, action: { type: 'poll', kind: 'superlative', promptId: 'c0000000-0000-4000-8000-000000000002' } },
    { id: 'rehearsal-feedback', enabled: true, match: { playbackId: 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs' },
      startSeconds: 120, endSeconds: 140, action: { type: 'feedback', formUrl: '/?rehearsal=feedback' } },
    { id: 'rehearsal-awards', enabled: true, match: { playbackId: 'EcHgOK9coz5K4rjSwOkoE7Y7O01201YMIC200RI6lNxnhs' },
      startSeconds: 160, endSeconds: 180, action: { type: 'awards' } },
  ],
};

export const SHOW_AUDIENCE_CUES = process.env.NODE_ENV !== 'production'
  && process.env.NEXT_PUBLIC_AUDIENCE_CUE_REHEARSAL === '1' ? REHEARSAL_AUDIENCE_CUES : DISABLED_AUDIENCE_CUES;
