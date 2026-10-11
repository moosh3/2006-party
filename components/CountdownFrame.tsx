'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CountdownCue } from '@/lib/countdown';

/** Fullscreen the composition, so the numbered artwork stays with the picture. */
export default function CountdownFrame({ cue, sessionId, paused, children }: {
  cue: CountdownCue; sessionId?: string; paused: boolean; children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const isVideo = !!cue.bannerUrl && /\.(mp4|webm|mov)(?:[?#]|$)/i.test(cue.bannerUrl);
  useEffect(() => { setFailed(false); }, [cue.bannerUrl, sessionId]);
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
    <div className="countdown-picture relative w-full">
    {children}
    <div className="countdown-banner absolute left-0 right-0 pointer-events-none z-10" style={{ bottom: 8 }} aria-label={`Countdown number ${cue.rank}`}>
      {cue.bannerUrl && !failed ? isVideo
        ? <video key={`${sessionId}:${cue.bannerUrl}`} ref={video} src={cue.bannerUrl} muted playsInline loop onError={() => setFailed(true)} className="w-full max-h-28 object-contain object-bottom" aria-hidden="true" />
        // Operator-provided artwork has variable dimensions and may be transparent.
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={cue.bannerUrl} alt="" onError={() => setFailed(true)} className="w-full max-h-28 object-contain object-bottom" />
        : <span className="inline-block ml-4 bg-black/80 text-white px-4 py-2 text-2xl font-bold">#{cue.rank}</span>}
    </div>
    </div>
    <button type="button" className="countdown-fullscreen absolute top-2 right-2 z-20 rounded bg-black/80 text-white text-xs min-h-[44px] px-3" onClick={async () => {
      try { if (document.fullscreenElement === frame.current) await document.exitFullscreen(); else await frame.current?.requestFullscreen(); setFullscreenError(''); }
      catch { setFullscreenError('Fullscreen with banner is unavailable in this browser. Use the stage display or browser fullscreen.'); }
    }}>Fullscreen with banner</button>
    <style>{`
      .countdown-frame:fullscreen { display: grid; place-items: center; height: 100vh; }
      .countdown-frame:fullscreen .countdown-picture { max-width: min(100vw, 177.7778vh); }
      .countdown-frame:fullscreen .countdown-fullscreen { opacity: 0; }
      .countdown-frame:fullscreen:hover .countdown-fullscreen,
      .countdown-frame:fullscreen:focus-within .countdown-fullscreen { opacity: 1; }
    `}</style>
    {fullscreenError && <p role="status" className="text-white bg-black p-2 text-sm">{fullscreenError}</p>}
  </div>;
}
