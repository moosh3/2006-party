/**
 * Complete one-shot GIFs supplied by the show team from their Photos library.
 * The GIF already choreographs the character across its transparent canvas.
 * Keep the original bytes/timings; restart by mounting a fresh image request.
 */
export type CastRunAsset = {
  src: string;
  sourceUUID: string;
  sourceSubdirectory: string;
  width: number;
  height: number;
  frames: number;
  delaysMs: readonly number[];
  durationMs: number;
  bytes: number;
  sha256: string;
  /** No looping extension: the browser plays the complete animation once. */
  loop: null;
};

export const CAST_RUNS = {
  mk: {
    src: '/2006/cast/runs/mk.gif',
    sourceUUID: 'D07A3A11-D8FC-4E23-B5F6-C84EC18C9869',
    sourceSubdirectory: 'D',
    width: 430, height: 430, frames: 22,
    delaysMs: [100, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100, 100, 100],
    durationMs: 2400, bytes: 351176,
    sha256: 'dda4e6085565047590fe2e3dadd2d742f1a76201b7a9309e11a01663bee2a68b',
    loop: null,
  },
  jen: {
    src: '/2006/cast/runs/jen.gif',
    sourceUUID: '10301E81-00A3-4ADE-8684-E7A2D184A63F',
    sourceSubdirectory: '1',
    width: 366, height: 366, frames: 28,
    delaysMs: [120, 120, 120, 120, 120, 240, 120, 120, 120, 120, 240, 120, 120, 120, 120, 120, 240, 120, 120, 120, 120, 240, 120, 120, 120, 120, 120, 120],
    durationMs: 3840, bytes: 347880,
    sha256: '8cdeced73bca27c738aeeb878b45ff9984496b96978fdcf86aa387441db9afe4',
    loop: null,
  },
  lip: {
    src: '/2006/cast/runs/lip.gif',
    sourceUUID: 'B8E1F7C1-0D8C-4FA2-AC38-6BD34B9403DA',
    sourceSubdirectory: 'B',
    width: 366, height: 366, frames: 29,
    delaysMs: [100, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100, 100, 200, 100, 100, 100, 100, 100, 100, 100],
    durationMs: 3200, bytes: 355903,
    sha256: '665242ac340bec36111722406f0a4abf32f71aa23449a03c6ea21d895b76f1c9',
    loop: null,
  },
  yongwoo: {
    src: '/2006/cast/runs/yongwoo.gif',
    sourceUUID: 'FC2759A6-E152-4C07-9B92-4A31F4D63B3C',
    sourceSubdirectory: 'F',
    width: 366, height: 366, frames: 27,
    delaysMs: [50, 50, 50, 50, 100, 50, 50, 50, 100, 50, 50, 50, 50, 100, 50, 50, 50, 100, 50, 50, 50, 100, 50, 50, 50, 50, 50],
    durationMs: 1600, bytes: 351198,
    sha256: 'd2ccca4afaab5372c5e4558b6cbeb024356cbecdb5f3acdac5328460899ec561',
    loop: null,
  },
  emma: {
    src: '/2006/cast/runs/emma.gif',
    sourceUUID: '06980F22-5516-404E-9716-E144A8423FB8',
    sourceSubdirectory: '0',
    width: 366, height: 366, frames: 26,
    delaysMs: [60, 60, 60, 120, 60, 60, 60, 120, 60, 60, 120, 60, 60, 60, 120, 60, 60, 120, 60, 60, 60, 120, 60, 60, 60, 60],
    durationMs: 1920, bytes: 299536,
    sha256: '29fa15df730facf91d2b0062b707c54b0ed8016a0d62d547346e31e28e5f3301',
    loop: null,
  },
  alec: {
    src: '/2006/cast/runs/alec.gif',
    sourceUUID: '117FF880-ABF9-4925-9E99-84F1A0F4323B',
    sourceSubdirectory: '1',
    width: 430, height: 430, frames: 31,
    delaysMs: [120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120],
    durationMs: 3720, bytes: 340594,
    sha256: '8ffe9e879a1e3d040c8579d835d46fa56fe9c71ed16ea5309548f6b58f3c1692',
    loop: null,
  },
} as const satisfies Record<string, CastRunAsset>;

export type CastRunId = keyof typeof CAST_RUNS;

/** Representative upright body bounds, not the padded GIF canvas or a clipped entrance.
 * Ground-only shadow pixels are excluded. One fixed scale keeps every pose natural.
 * Idle artwork has a 160px canvas; its visible body is slightly shorter for each person.
 */
export const CAST_RUN_SIZING = {
  mk: { bodyHeight: 277, referenceFrame: 8, idleBodyHeight: 154 },
  jen: { bodyHeight: 216, referenceFrame: 5, idleBodyHeight: 150 },
  lip: { bodyHeight: 167, referenceFrame: 9, idleBodyHeight: 150 },
  yongwoo: { bodyHeight: 219, referenceFrame: 0, idleBodyHeight: 150 },
  emma: { bodyHeight: 192, referenceFrame: 8, idleBodyHeight: 158 },
  alec: { bodyHeight: 282, referenceFrame: 7, idleBodyHeight: 158 },
} as const satisfies Record<CastRunId, { bodyHeight: number; referenceFrame: number; idleBodyHeight: number }>;

/** Multiply the original idle image's rendered height by this to size the entire run canvas. */
export function getCastRunCanvasScale(art: CastRunId): number {
  const sizing = CAST_RUN_SIZING[art];
  return CAST_RUNS[art].height * sizing.idleBodyHeight / (160 * sizing.bodyHeight);
}
