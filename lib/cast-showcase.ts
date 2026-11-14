import type { CastRunId } from './cast-runs';

// Original complete Drive animations, verified November 13, 2026.
// No frames, transparency, timing or looping metadata changed.
export const CAST_SHOWCASE = {
  "mk": {
    "src": "/2006/cast/showcase/mk.gif",
    "sourceName": "walking MK.gif",
    "sourceUrl": "https://drive.google.com/file/d/1LDexwPsEB6-EbHlGyV035qmVdeWt4bB9/view",
    "width": 1024,
    "height": 1024,
    "frames": 12,
    "durationMs": 1440,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120
    ],
    "sha256": "39b8824426e46f3d7bb732d60553199a5a8da8fe38c9ac7ba473741f5f90e39d",
    "bytes": 791796
  },
  "jen": {
    "src": "/2006/cast/showcase/jen.gif",
    "sourceName": "Jen trip.gif",
    "sourceUrl": "https://drive.google.com/file/d/1YEfWrBSwvH6zyoqPRPemPJYDf0yuDE8f/view",
    "width": 1024,
    "height": 1024,
    "frames": 22,
    "durationMs": 2640,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120
    ],
    "sha256": "bf0bc1c912e37cde086f7bf44fe5d2d2701ad63575e5267109199168840d90ae",
    "bytes": 1463836
  },
  "lip": {
    "src": "/2006/cast/showcase/lip.gif",
    "sourceName": "Run chain Lip.gif",
    "sourceUrl": "https://drive.google.com/file/d/1FPLpRlZfrM6FItPXktNLiTg9L-lvWKRs/view",
    "width": 1024,
    "height": 1024,
    "frames": 4,
    "durationMs": 480,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120
    ],
    "sha256": "c3c52b45ec63186cc0001932fa57943a29071fc81d46eb1f09f66dff6c6a699b",
    "bytes": 322123
  },
  "yongwoo": {
    "src": "/2006/cast/showcase/yongwoo.gif",
    "sourceName": "YWhandstand run.gif",
    "sourceUrl": "https://drive.google.com/file/d/1Bsb00Ir3pvRaClSV51XvAy-KxUtzuOQp/view",
    "width": 1024,
    "height": 1024,
    "frames": 5,
    "durationMs": 600,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120,
      120
    ],
    "sha256": "05aaaa7c7b680b41c17563649a74a423be2a22321142b2bce1fafbea4209680b",
    "bytes": 389886
  },
  "emma": {
    "src": "/2006/cast/showcase/emma.gif",
    "sourceName": "Emma skip.gif",
    "sourceUrl": "https://drive.google.com/file/d/1gIp-Zq8W2Uwn8_GSHAQAl03Q5OB2ktLc/view",
    "width": 1024,
    "height": 1024,
    "frames": 11,
    "durationMs": 1320,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120,
      120
    ],
    "sha256": "aa3a6eed6055a886c86f8713e551fdf891c1c28929976fe4fb98bebc2e99022d",
    "bytes": 766294
  },
  "alec": {
    "src": "/2006/cast/showcase/alec.gif",
    "sourceName": "Alec run glasses.gif",
    "sourceUrl": "https://drive.google.com/file/d/1CmCEaRSIYB4s5ycgPHFBHs85uR2oY14_/view",
    "width": 1024,
    "height": 1024,
    "frames": 5,
    "durationMs": 600,
    "loop": 0,
    "delaysMs": [
      120,
      120,
      120,
      120,
      120
    ],
    "sha256": "4925b57797cdf630b1a2034c24deee851308c88059adcef9652d39409accf13e",
    "bytes": 347019
  }
} as const satisfies Record<CastRunId, { src: string; sourceName: string; sourceUrl: string; width: number; height: number; frames: number; durationMs: number; loop: number; delaysMs: readonly number[]; sha256: string; bytes: number }>;
