# Show artwork

The colorful wordmark and pixel-art cast portraits are the original artwork from the show's companion site, reused for the same 2006 production. A visible source credit accompanies the portraits.

The six GIF files are the complete original animations, served byte-for-byte with every frame, original timing, transparency and loop behavior intact. No frames are extracted, redrawn or dropped. The matching original PNGs are used only when animations are paused or the browser requests reduced motion.

Each original has 8 frames at 130 ms per frame (1,040 ms per cycle), looping indefinitely. `npm run test:show-art` checks full GIF structure, every frame's timing, loop metadata and captured source SHA-256 hashes. All six copies were also compared directly to the downloaded source bytes.

- `cast/mk.gif`: https://www.artisticaccessibility.com/2006/cast/mk.gif
- `cast/jen.gif`: https://www.artisticaccessibility.com/2006/cast/jen.gif
- `cast/lip.gif`: https://www.artisticaccessibility.com/2006/cast/lip.gif
- `cast/yongwoo.gif`: https://www.artisticaccessibility.com/2006/cast/yongwoo.gif
- `cast/emma.gif`: https://www.artisticaccessibility.com/2006/cast/emma.gif
- `cast/alec.gif`: https://www.artisticaccessibility.com/2006/cast/alec.gif

- `wordmark.png`: https://www.artisticaccessibility.com/2006/wordmark.png
- `cast/mk.png`: https://www.artisticaccessibility.com/2006/cast/mk.png
- `cast/jen.png`: https://www.artisticaccessibility.com/2006/cast/jen.png
- `cast/lip.png`: https://www.artisticaccessibility.com/2006/cast/lip.png
- `cast/yongwoo.png`: https://www.artisticaccessibility.com/2006/cast/yongwoo.png
- `cast/emma.png`: https://www.artisticaccessibility.com/2006/cast/emma.png
- `cast/alec.png`: https://www.artisticaccessibility.com/2006/cast/alec.png

Source: https://www.artisticaccessibility.com/2006/show (visited October 5, 2026). Provenance is recorded here; this is not a claim to authorship or a new license grant.

## Click-to-run animations

The show team supplied six additional running GIFs from their Photos library on October 9, 2026. The files in `cast/runs/` are byte-for-byte copies of those attachments. The Photos originals are not modified. These are the complete original one-shot animations, including their own running, jumping and falling choreography across a transparent canvas; no frames are redrawn, extracted for playback, dropped, cropped or re-encoded.

The character mapping was checked against the existing original portraits. The source UUIDs are retained below and in `lib/cast-runs.ts`, alongside every frame delay, the exact duration, dimensions, byte length and SHA-256 hash. This records provenance, not a claim to authorship or a new license grant.

| Deployed copy | Photos source UUID | Canvas | Frames | Duration |
| --- | --- | --- | --- | --- |
| `cast/runs/mk.gif` | `D07A3A11-D8FC-4E23-B5F6-C84EC18C9869` | 430 × 430 | 22 | 2,400 ms |
| `cast/runs/jen.gif` | `10301E81-00A3-4ADE-8684-E7A2D184A63F` | 366 × 366 | 28 | 3,840 ms |
| `cast/runs/lip.gif` | `B8E1F7C1-0D8C-4FA2-AC38-6BD34B9403DA` | 366 × 366 | 29 | 3,200 ms |
| `cast/runs/yongwoo.gif` | `FC2759A6-E152-4C07-9B92-4A31F4D63B3C` | 366 × 366 | 27 | 1,600 ms |
| `cast/runs/emma.gif` | `06980F22-5516-404E-9716-E144A8423FB8` | 366 × 366 | 26 | 1,920 ms |
| `cast/runs/alec.gif` | `117FF880-ABF9-4925-9E99-84F1A0F4323B` | 430 × 430 | 31 | 3,720 ms |

`node --import tsx scripts/test-cast-runs.ts` checks complete GIF structure, every original delay, transparency flags on all frames, no looping extension and the captured original SHA-256 hashes. To also compare against the supplied Photos originals, append `--source-dir '/path/to/Photos Library.photoslibrary/originals'`. The feature replays the original once when the sprite is activated; motion-disabled and reduced-motion views keep using the existing static portrait.

### Matching the original portrait size

CSS sizing uses representative upright body bounds rather than the transparent GIF canvas. `CAST_RUN_SIZING` records the measured body heights and reference frames: MK 277px (frame 8), Jen 216px (frame 5), Lip 167px (frame 9), Yongwoo 219px (frame 0), Emma 192px (frame 8), Alec 282px (frame 7). Ground-only shadow tails are excluded for MK (5px), Jen (5px) and Yongwoo (1px). Yongwoo's entrance frame is vertically intact; later poses are cartwheels/handstands and are not used to set upright scale.

Original idle PNG alpha heights are 154, 150, 150, 150, 158 and 158px, respectively, inside 160px canvases. The whole running GIF canvas is displayed at `run canvas height × (48 × idle alpha height / 160) / running body height`, approximately 71.72, 76.25, 98.62, 75.21, 90.36 and 72.28px. Every frame uses that same scale. No pixels, frames, timing or source files are altered. The roster wraps on small screens to retain this size.

## Interactive Clippy (October 11, 2026)

Supplied by the production through Messages. GIFs copied byte-for-byte, with original transparency, frames and timing. They play once; the idle PNG is an extracted frame for paused/reduced-motion states. No external image requests.

- `hello.gif`: original `Clippy.gif`, SHA-256 `0489fdf23545c05e803e0fa0c33cdc3892eced39f1ce172c6833a776cab56647`.
- `tap.gif`: original `Clippy tap.gif`, SHA-256 `11baaf170afdf721c2e923c2a6b94cfd646d345cd05537e3f8ca649e222bf92c`.
- `curious.gif`: original `CuriousClippy.gif`, SHA-256 `947c1cc193bb584991cce594e898879c28b9893507a3c47cfb23b2291e6fe9de`.
- `spin.gif`: original `Clippy360.gif`, SHA-256 `796650f73921de584db2e54e8c3972c3a312809776e27f5c088a783fd5dfe00b`.
