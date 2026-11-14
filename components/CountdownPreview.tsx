'use client';
import { useEffect, useState } from 'react';
import CountdownMachine from './CountdownMachine';
import './countdown-introduction.css';

/** Local design rehearsal only; never connects to or changes the show feed. */
export default function CountdownPreview() {
  const [rank, setRank] = useState(5);
  const [origin, setOrigin] = useState<number>();
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(3);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    setOrigin(performance.now());
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const replay = (next = rank) => { setRank(next); setRemaining(3); setOrigin(performance.now()); setPaused(false); };
  useEffect(() => {
    if (paused || origin === undefined) return;
    const timer = setTimeout(() => { setRemaining(3); setOrigin(performance.now()); }, remaining * 1000 + 1600);
    return () => clearTimeout(timer);
  }, [origin, paused, remaining]);
  return <main style={{ minHeight: '100vh', background: '#090c1d', color: '#eaf4ff', padding: '24px', fontFamily: 'Arial, sans-serif' }}>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
      <strong style={{ marginRight: 'auto' }}>Countdown motion preview</strong>
      {[5,4,3,2,1].map(n => <button key={n} aria-pressed={rank === n} onClick={() => replay(n)} style={{ minWidth: 44, minHeight: 44, background: rank === n ? '#c5ff21' : '#252d47', color: rank === n ? '#101326' : '#eaf4ff', border: '1px solid #687897', borderRadius: 4 }}>{n}</button>)}
      <button onClick={() => replay()} style={{ minHeight: 44, padding: '0 16px' }}>Replay</button>
      <button style={{ minHeight: 44, padding: '0 16px' }} onClick={() => {
        if (!paused) setRemaining(Math.max(0, remaining - (performance.now() - (origin ?? performance.now())) / 1000));
        setOrigin(performance.now()); setPaused(!paused);
      }}>{paused ? 'Resume' : 'Pause'}</button>
    </div>
    <div className="countdown-picture" style={{ position: 'relative', width: '100%', aspectRatio: '5 / 3', overflow: 'hidden', border: '1px solid #39425b' }}>
      <CountdownMachine rank={rank} duration={3} remaining={remaining} receivedAt={origin} paused={paused} reducedMotion={reducedMotion} active />
    </div>
    <p style={{ color: '#aab9d2', fontSize: 14 }}>Three-second reveal, then a short hold. Loops for review. Select any number to reveal its bay in the same machine.</p>
  </main>;
}
