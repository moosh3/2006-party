'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COUNTDOWN_BANNERS, type CountdownCue } from '@/lib/countdown';

/** Fullscreen the composition, so the numbered artwork stays with the picture. */
export default function CountdownFrame({ cue, sessionId, paused, children, separateFooter = false }: {
  cue: CountdownCue; sessionId?: string; paused: boolean; children: ReactNode; separateFooter?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(true);
  const isVideo = !!cue.bannerUrl && /\.(mp4|webm|mov)(?:[?#]|$)/i.test(cue.bannerUrl);
  const bundled = cue.bannerUrl === COUNTDOWN_BANNERS[cue.rank]?.video;
  const poster = bundled ? COUNTDOWN_BANNERS[cue.rank].poster : undefined;
  const imageUrl = bundled && (reducedMotion || failed) ? poster : !isVideo ? cue.bannerUrl : null;
  useEffect(() => { setFailed(false); setImageFailed(false); }, [cue.bannerUrl, sessionId]);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    if (paused || reducedMotion) player.pause();
    else void player.play().catch(() => { /* Static first frame remains visible. */ });
  }, [paused, reducedMotion, cue.bannerUrl, sessionId]);
  return <div ref={frame} className="countdown-frame relative bg-black w-full">
    <div className={`countdown-picture relative w-full${separateFooter ? ' countdown-picture--footer' : ''}`}>
    {children}
    <div className={`countdown-banner left-0 right-0 pointer-events-none z-10 ${separateFooter ? 'relative py-2' : 'absolute'}`} style={{ bottom: separateFooter ? undefined : 8 }} aria-label={`Countdown number ${cue.rank}`}>
      {imageUrl && !imageFailed
        // Operator artwork may be transparent; bundled stills also cover reduced motion and unsupported alpha video.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt="" onError={() => setImageFailed(true)} className="w-full max-h-28 object-contain object-bottom" />
        : cue.bannerUrl && !imageUrl && !failed && isVideo
        ? <video key={`${sessionId}:${cue.bannerUrl}`} ref={video} src={cue.bannerUrl} poster={poster} muted playsInline loop onError={() => setFailed(true)} className="w-full max-h-28 object-contain object-bottom" aria-hidden="true" />
        : <span className="inline-block ml-4 bg-black/80 text-white px-4 py-2 text-2xl font-bold">#{cue.rank}</span>}
    </div>
    </div>
    <button type="button" className="countdown-fullscreen absolute top-2 right-2 z-20 rounded bg-black/80 text-white text-xs min-h-[44px] px-3" onClick={async () => {
      try { if (document.fullscreenElement === frame.current) await document.exitFullscreen(); else await frame.current?.requestFullscreen(); setFullscreenError(''); }
      catch { setFullscreenError('Fullscreen with banner is unavailable in this browser. Use the stage display or browser fullscreen.'); }
    }}>Fullscreen with banner</button>
    <style>{`
      /* YouTube captions live inside a cross-origin iframe. Keep artwork outside
         that picture instead of covering captions or native controls. */
      .countdown-picture.countdown-picture--footer { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
      .countdown-frame:fullscreen .countdown-picture--footer > .aspect-video { height: 100%; max-height: 100%; }
      .countdown-frame:fullscreen { display: grid; place-items: center; height: 100vh; }
      .countdown-frame:fullscreen .countdown-picture { max-width: min(100vw, 177.7778vh); }
      .countdown-frame:fullscreen .countdown-picture--footer { height: 100%; max-width: 100%; }
      .countdown-frame:fullscreen .countdown-fullscreen { opacity: 0; }
      .countdown-frame:fullscreen:hover .countdown-fullscreen,
      .countdown-frame:fullscreen:focus-within .countdown-fullscreen { opacity: 1; }
    `}</style>
    {fullscreenError && <p role="status" className="text-white bg-black p-2 text-sm">{fullscreenError}</p>}
  </div>;
}
