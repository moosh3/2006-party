/** Trivia popup placement never overlaps the program player. Pure geometry. */
import assert from 'node:assert/strict';
import { placePopup, POPUP_MIN_WIDTH, type Box } from '../lib/popup-placement';

const overlaps = (a: Box, b: Box) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
const check = (name: string, viewport: Box, video: Box | null, expect: 'floating' | 'collapsed') => {
  const p = placePopup(viewport, video);
  assert.equal(p.mode, expect, name);
  if (p.mode === 'floating') {
    const box = { left: p.left, top: p.top, right: p.left + p.width, bottom: p.top + p.maxHeight };
    if (video) assert.ok(!overlaps(box, video), `${name}: popup clears the video`);
    assert.ok(box.left >= viewport.left && box.right <= viewport.right && box.top >= viewport.top && box.bottom <= viewport.bottom, `${name}: inside the screen`);
    assert.ok(p.width >= POPUP_MIN_WIDTH, `${name}: readable width`);
  }
  return p;
};
// 1024×768 floating desktop: video on the left, room on the right.
const desk = check('desktop 1024', { left: 12, top: 32, right: 1012, bottom: 680 }, { left: 13, top: 217, right: 699, bottom: 609 }, 'floating');
assert.ok(desk.mode === 'floating' && desk.left > 699);
// 1024×768 with a tall popup: the space beside the video (fits) beats the wider space below it (would scroll).
const tall = placePopup({ left: 12, top: 32, right: 1012, bottom: 690 }, { left: 13, top: 120, right: 699, bottom: 469 }, 420);
assert.ok(tall.mode === 'floating' && tall.left > 699 && tall.maxHeight >= 420, 'Tall popup goes where it fits whole');
// Wide screen: plenty of room.
check('desktop 1440', { left: 12, top: 32, right: 1428, bottom: 800 }, { left: 13, top: 200, right: 900, bottom: 700 }, 'floating');
// Phone: video across the top, sheet below it.
const phone = check('phone 375', { left: 0, top: 0, right: 375, bottom: 812 }, { left: 0, top: 100, right: 375, bottom: 311 }, 'floating');
assert.ok(phone.mode === 'floating' && phone.top > 311);
// Video scrolled off screen or absent: bottom-right of the viewport.
check('no video', { left: 12, top: 32, right: 1012, bottom: 680 }, null, 'floating');
check('video scrolled away', { left: 0, top: 0, right: 375, bottom: 812 }, { left: 0, top: -400, right: 375, bottom: -190 }, 'floating');
// Video fills the screen (zoomed window): nothing fits, so it collapses.
check('zoomed video', { left: 12, top: 32, right: 1012, bottom: 680 }, { left: 20, top: 40, right: 1000, bottom: 670 }, 'collapsed');
console.log('PASS: trivia popup placement clears the player on desktop, wide and phone layouts, and collapses when no space is free.');
