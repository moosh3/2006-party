import type { CastRunId } from './cast-runs';

/** The six "Sprites": cast avatars in Buddy List order. `index` is the Buddy
 * Info entry in AimExperience; SmarterChild (index 6) is not a Sprite. */
export type Sprite = {
  art: CastRunId; name: string; screenName: string; index: number;
  /** Approved by MK. Leave unset rather than inventing a line. */
  catchphrase?: string;
  /** Recorded clip under /2006/, played only on request. */
  catchphraseAudio?: string;
};

export const SPRITES: readonly Sprite[] = [
  { art: 'mk', name: 'MK', screenName: 'mkashe9', index: 0 },
  { art: 'jen', name: 'Jen', screenName: 'SBconfetti', index: 1 },
  { art: 'lip', name: 'Lip', screenName: 'x0x_BlueShellVictim_x0x', index: 2 },
  { art: 'yongwoo', name: 'Yongwoo', screenName: 'neodafunky', index: 3 },
  { art: 'emma', name: 'Emma', screenName: 'EmmaIsNine', index: 4 },
  { art: 'alec', name: 'Alec', screenName: 'bbulldogs48', index: 5 },
];
