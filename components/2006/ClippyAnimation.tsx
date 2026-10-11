'use client';

import { useEffect, useRef, useState } from 'react';

const CLIPS = { hello: 3200, curious: 3520, tap: 3520, spin: 3840 } as const;
type Clip = keyof typeof CLIPS;

/** Original one-shot GIFs, with a static fallback and no broadcast side effects. */
export default function ClippyAnimation({ reaction = 'curious', paused = false, active = true }: {
  reaction?: Clip; paused?: boolean; active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [localPaused, setLocalPaused] = useState(false);
  const [run, setRun] = useState<{ clip: Clip; id: string } | null>(null);
  const [remark, setRemark] = useState('Click me. I’m very qualified.');
  const clicks = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canAnimate = active && onScreen && !paused && !localPaused && !reduced;
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRun(null);
  };
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    const hide = () => { if (document.hidden) stop(); };
    update();
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', hide);
    return () => {
      preference.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', hide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRun(canAnimate && !document.hidden ? { clip: reaction, id: crypto.randomUUID() } : null);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [reaction, canAnimate]);
  const poke = () => {
    const count = ++clicks.current;
    setRemark(count % 2 ? 'Yes, this counts as procrastinating.' : 'A little spin. Now back to your masterpiece.');
    if (!canAnimate || run || document.hidden) return;
    setRun({ clip: count % 2 ? 'tap' : 'spin', id: crypto.randomUUID() });
  };
  return <div ref={host} className="show2006-clippy-animation">
    <button type="button" className="show2006-clippy-poke" onClick={poke} aria-label="Poke Clippy" title="Poke Clippy">
      {/* Keep the production's original GIF frames and timing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={run?.id || 'idle'} src={run && canAnimate ? `/2006/clippy/${run.clip}.gif?play=${run.id}` : '/2006/clippy/idle.png'} width="112" height="112" alt="" draggable={false}
        onLoad={() => {
          if (!run || timer.current) return;
          timer.current = setTimeout(stop, CLIPS[run.clip]);
        }} onError={stop} />
    </button>
    <small role="status">{remark}</small>
    {!reduced && !paused && <button type="button" className="show2006-clippy-motion" aria-pressed={localPaused} onClick={() => setLocalPaused(value => !value)}>{localPaused ? 'Resume Clippy' : 'Pause Clippy'}</button>}
  </div>;
}
