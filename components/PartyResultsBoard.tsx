'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartyResults } from '@/lib/party-results';
import { renderResults, resultPages } from '@/public/2006/results/render.mjs';
import StageScene from './StageScene';
import '@/public/2006/results/results.css';

/** One results page. React rewrites innerHTML whenever it is handed a new
 * markup object, which restarts every entrance animation, so the object is
 * kept until the markup itself changes. A page whose numbers change while it
 * is on screen updates in place instead of making its entrance again. */
function ResultsPage({ html }: { html: string }) {
  const first = useRef(html);
  const markup = useMemo(() => ({ __html: html }), [html]);
  return <div data-updated={html !== first.current || undefined} dangerouslySetInnerHTML={markup} />;
}

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
    <ResultsPage key={visiblePage} html={renderResults(data, visiblePage)} />
    {interactive && <div className="party-page-controls">
      <button aria-label="Previous results" onClick={() => setPage(p => (p - 1 + count) % count)}><span aria-hidden="true">◀</span> Back</button>
      <button aria-pressed={loopPaused} onClick={() => setLoopPaused(p => !p)}>{loopPaused ? 'Resume' : 'Pause'}</button>
      <span className="party-page-count">{visiblePage + 1} / {count}</span>
      <button aria-label="Next results" onClick={() => setPage(p => (p + 1) % count)}>Next <span aria-hidden="true">▶</span></button>
    </div>}
  </div>;
  return interactive ? content : <StageScene>{content}</StageScene>;
}
