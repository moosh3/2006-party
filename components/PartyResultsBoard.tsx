'use client';
import { useEffect, useState } from 'react';
import type { PartyResults } from '@/lib/party-results';
import { renderResults, resultPages } from '@/public/2006/results/render.mjs';
import StageScene from './StageScene';
import '@/public/2006/results/results.css';

export default function PartyResultsBoard({ data, interactive = false, paused = false, position }: {
  data: PartyResults; interactive?: boolean; paused?: boolean; position?: number;
}) {
  const [page, setPage] = useState(0);
  const [loopPaused, setLoopPaused] = useState(false);
  const count = resultPages(data).length;
  const sharedClock = !interactive && position !== undefined;
  useEffect(() => {
    if (sharedClock || loopPaused || paused) return;
    const timer = window.setInterval(() => setPage(p => (p + 1) % count), 10000);
    return () => window.clearInterval(timer);
  }, [count, loopPaused, paused, sharedClock]);
  const visiblePage = sharedClock ? Math.floor(Math.max(0, position!) / 10) % count : Math.min(page, count - 1);
  const content = <div className={`party-loop ${!interactive ? 'party-projector' : ''} ${paused || loopPaused ? 'party-loop-paused' : ''}`}
    data-shared-clock={sharedClock || undefined} data-revealed={sharedClock ? position! % 10 >= 3 : undefined}>
    <div key={visiblePage} dangerouslySetInnerHTML={{ __html: renderResults(data, visiblePage) }} />
    {interactive && <div className="party-page-controls">
      <button onClick={() => setPage(p => (p - 1 + count) % count)}>Previous results</button>
      <button onClick={() => setLoopPaused(p => !p)}>{loopPaused ? 'Resume loop' : 'Pause loop'}</button>
      <button onClick={() => setPage(p => (p + 1) % count)}>Next results</button>
    </div>}
  </div>;
  return interactive ? content : <StageScene>{content}</StageScene>;
}
