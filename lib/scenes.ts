// Timed scene cues: interactive program segments that occupy the player for an
// exact operator-entered length on the shared queue clock (sql/028_scene_cues.sql).
export const SCENE_SOURCE_TYPE = 'scene' as const;

export const SCENES = {
  'rules-of-the-game': { label: 'Rules of the Game', stageLine: 'Happening online' },
  'check-our-scores': { label: "Let's Check Our Scores", stageLine: '' },
} as const;

export type SceneId = keyof typeof SCENES;

export const MAX_SCENE_SECONDS = 7200;

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SCENES, value);
}

/** `scene:<scene-id>:<uuid>` → scene id, or null for any other playback id. */
export function parseScenePlaybackId(playbackId: string | null | undefined): SceneId | null {
  const match = /^scene:([a-z0-9-]{1,40}):[0-9a-f-]{36}$/.exec(playbackId || '');
  return match && isSceneId(match[1]) ? match[1] : null;
}

export function sceneLengthError(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_SCENE_SECONDS
    ? null : 'Enter the scene length in seconds (more than 0, up to two hours).';
}

/** Scenes started by queue advances (newest first is fine); duplicates removed. */
export function scenesAiredSince(actions: readonly { details?: unknown }[]): SceneId[] {
  const aired = new Set<SceneId>();
  for (const action of actions) {
    const details = action.details && typeof action.details === 'object' ? action.details as Record<string, unknown> : null;
    const scene = parseScenePlaybackId(typeof details?.to_playback_id === 'string' ? details.to_playback_id : null);
    if (scene) aired.add(scene);
  }
  return [...aired];
}
