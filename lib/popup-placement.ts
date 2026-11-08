// Places a floating popup (trivia) in the largest free space around the
// program player, so it never covers the video or its captions.
export type Box = { left: number; top: number; right: number; bottom: number };
export type Placement =
  | { mode: 'floating'; left: number; top: number; width: number; maxHeight: number }
  | { mode: 'collapsed' };

const GAP = 12;
export const POPUP_MIN_WIDTH = 260;
export const POPUP_MAX_WIDTH = 380;
export const POPUP_MIN_HEIGHT = 200;

/** `avoid` is the player; `viewport` is the usable screen (minus menu bar and
 * dock). With no player on screen, the popup sits bottom-right. Spaces where
 * the whole popup (`contentHeight`) fits win over larger ones where it scrolls,
 * so the popup does not jump between spaces or hide its buttons. */
export function placePopup(viewport: Box, avoid: Box | null, contentHeight = 0): Placement {
  const visible = avoid && avoid.right > viewport.left && avoid.left < viewport.right
    && avoid.bottom > viewport.top && avoid.top < viewport.bottom ? avoid : null;
  const regions: Box[] = visible ? [
    { left: visible.right + GAP, top: viewport.top, right: viewport.right, bottom: viewport.bottom },
    { left: viewport.left, top: viewport.top, right: visible.left - GAP, bottom: viewport.bottom },
    { left: viewport.left, top: visible.bottom + GAP, right: viewport.right, bottom: viewport.bottom },
    { left: viewport.left, top: viewport.top, right: viewport.right, bottom: visible.top - GAP },
  ] : [viewport];
  const fitting = regions
    .map(r => ({ r, w: r.right - r.left, h: r.bottom - r.top }))
    .filter(({ w, h }) => w >= POPUP_MIN_WIDTH && h >= POPUP_MIN_HEIGHT)
    .sort((a, b) => Number(b.h >= contentHeight) - Number(a.h >= contentHeight) || b.w * b.h - a.w * a.h);
  const best = fitting[0];
  if (!best) return { mode: 'collapsed' };
  const width = Math.min(POPUP_MAX_WIDTH, best.w);
  // Hug the bottom-right of the chosen space, like a notification.
  return { mode: 'floating', left: best.r.right - width, top: best.r.top, width, maxHeight: best.h };
}
