import type { CastRunId } from './cast-runs';

/** The six "Sprites": cast avatars in Buddy List order. `index` is the Buddy
 * Info entry in AimExperience; SmarterChild (index 6) is not a Sprite. */
export type Sprite = {
  art: CastRunId; name: string; screenName: string; index: number;
  /** Production lines, cycled Celebrate → Bummer → Extra on each Sprite click. */
  lines?: readonly [celebrate: string, bummer: string, extra: string];
  /** Optional recording for each line (same order), under /2006/. Played on the click that says it. */
  lineAudio?: readonly (string | undefined)[];
};

export const SPRITES: readonly Sprite[] = [
  { art: 'mk', name: 'MK', screenName: 'mkashe9', index: 0, lines: ['Nice', 'Dang', 'Seriously?'] },
  { art: 'jen', name: 'Jen', screenName: 'SBconfetti', index: 1, lines: ['Oh yeaaaah!', 'Er mer gerd!', 'TROGDOOOOOR!'] },
  { art: 'lip', name: 'Lip', screenName: 'x0x_BlueShellVictim_x0x', index: 2, lines: ['Schweet!', 'That’s Bogus…', 'Schfifty five'] },
  { art: 'yongwoo', name: 'Yongwoo', screenName: 'neodafunky', index: 3, lines: ['Huzzah!', 'ghey', '*trip*'] },
  { art: 'emma', name: 'Emma', screenName: 'EmmaIsNine', index: 4, lines: ['Yay', ':P', 'I’m Nine'] },
  { art: 'alec', name: 'Alec', screenName: 'bbulldogs48', index: 5, lines: ['Sick', 'Ain’t no way', 'boop'] },
];

/** Use the supplied lines, with a fallback for a Sprite without production copy. */
export function spriteLines(sprite: Sprite): readonly string[] {
  return sprite.lines?.length ? sprite.lines
    : [`Hi! I’m ${sprite.name}.`, 'Welcome to 2006!', `Find me on AIM: ${sprite.screenName}.`];
}
