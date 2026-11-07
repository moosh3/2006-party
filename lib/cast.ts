import type { CastRunId } from './cast-runs';

/** The six "Sprites": cast avatars in Buddy List order. `index` is the Buddy
 * Info entry in AimExperience; SmarterChild (index 6) is not a Sprite. */
export type Sprite = {
  art: CastRunId; name: string; screenName: string; index: number;
  /** Three lines from MK, said in turn each time a guest clicks the Sprite. */
  lines?: readonly string[];
  /** Optional recording for each line (same order), under /2006/. Played on the click that says it. */
  lineAudio?: readonly (string | undefined)[];
};

export const SPRITES: readonly Sprite[] = [
  { art: 'mk', name: 'MK', screenName: 'mkashe9', index: 0 },
  { art: 'jen', name: 'Jen', screenName: 'SBconfetti', index: 1 },
  { art: 'lip', name: 'Lip', screenName: 'x0x_BlueShellVictim_x0x', index: 2 },
  { art: 'yongwoo', name: 'Yongwoo', screenName: 'neodafunky', index: 3 },
  { art: 'emma', name: 'Emma', screenName: 'EmmaIsNine', index: 4 },
  { art: 'alec', name: 'Alec', screenName: 'bbulldogs48', index: 5 },
];

/** Placeholder lines until MK sends each Sprite's three; replace via `lines`. */
export function spriteLines(sprite: Sprite): readonly string[] {
  return sprite.lines?.length ? sprite.lines
    : [`Hi! I’m ${sprite.name}.`, 'Welcome to 2006!', `Find me on AIM: ${sprite.screenName}.`];
}
