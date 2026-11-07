'use client';
import { useEffect, useState } from 'react';
import type { ScoresPayload } from '@/lib/scores';

const REFRESH_MS = 5000;
const TOP_OPTIONS = 3;

/** Let's Check Our Scores: live superlative totals, the countdown so far and
 * tonight's essays. Guests can open an essay; the stage shows names only. */
export default function ScoresBoard({ interactive }: { interactive: boolean }) {
  const [scores, setScores] = useState<ScoresPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/scores', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!cancelled) { setScores(data); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const ready = scores?.available;
  return (
    <section className={`scene-frame scores-board ${interactive ? 'scores-board-audience' : 'scores-board-stage'}`}
      aria-label="Let's Check Our Scores">
      <h2>Let’s Check Our Scores!</h2>
      {!ready ? (
        <p className="scores-status" role="status">{failed ? 'Reconnecting to the scoreboard…' : 'Tallying the scores…'}</p>
      ) : (
        <div className="scores-panels">
          <section aria-labelledby="scores-superlatives">
            <h3 id="scores-superlatives">Superlatives</h3>
            {scores.superlatives.length === 0 ? <p>No superlatives yet.</p> : (
              <ol className="scores-categories">
                {scores.superlatives.map(category => {
                  const ranked = [...category.options].sort((a, b) => b.count - a.count);
                  const total = ranked.reduce((sum, option) => sum + option.count, 0);
                  const lead = ranked[0]?.count || 0;
                  return (
                    <li key={category.id}>
                      <p className="scores-question">{category.question}{category.status === 'open' ? ' · voting open' : ''}</p>
                      <ul>
                        {ranked.slice(0, TOP_OPTIONS).map(option => (
                          <li key={option.label} data-leading={lead > 0 && option.count === lead || undefined}>
                            <span>{option.label}</span>
                            <span className="scores-count">{option.count} {option.count === 1 ? 'vote' : 'votes'}</span>
                            <span className="scores-bar" aria-hidden="true" style={{ width: `${total ? (100 * option.count) / total : 0}%` }} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section aria-labelledby="scores-countdown">
            <h3 id="scores-countdown">The countdown so far</h3>
            {scores.countdown.length === 0 ? <p>No countdown videos yet.</p> : (
              <ol className="scores-countdown">
                {scores.countdown.map(video => <li key={video.rank}><strong>#{video.rank}</strong> {video.title}</li>)}
              </ol>
            )}
            <p className="scores-next">#1 is still to come…</p>
          </section>
          <section aria-labelledby="scores-essays">
            <h3 id="scores-essays">Essays ({scores.essays.length})</h3>
            {scores.essays.length === 0 ? <p>No essays submitted yet.</p> : interactive ? (
              <ul className="scores-essays">
                {scores.essays.map(essay => (
                  <li key={essay.id}>
                    <details>
                      <summary>{essay.screenName}</summary>
                      <p className="scores-essay-prompt">{essay.prompt}</p>
                      <p className="scores-essay-body">{essay.body}</p>
                    </details>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="scores-essays scores-essay-names">
                {scores.essays.map(essay => <li key={essay.id}>{essay.screenName}</li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
