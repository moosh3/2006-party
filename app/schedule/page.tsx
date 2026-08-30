import Link from 'next/link';
import AimWindow from '@/components/aim/AimWindow';
import { RUN_OF_SHOW } from '@/lib/run-of-show';

const SURFACE_LABELS = {
  all: 'ALL FEEDS',
  'online-and-room': 'ONLINE + ROOM',
  'online-only': 'ONLINE ONLY',
  live: 'LIVE',
} as const;

export default function SchedulePage() {
  return (
    <div className="aim-desktop run-sheet-page">
      <a className="skip-link" href="#run-sheet-main">Skip to run of show</a>
      <main id="run-sheet-main" className="run-sheet-main">
        <AimWindow
          title="2006 — Run of Show"
          menuItems={['File', 'Edit', 'View', 'Help']}
          status={`${RUN_OF_SHOW.length} cues · timing not locked`}
        >
          <div className="run-sheet-note">
            <strong>Working sequence</strong>
            <span>Exact durations, transition times, and media IDs are still production inputs.</span>
          </div>

          <ol className="run-sheet-list">
            {RUN_OF_SHOW.map((cue, index) => (
              <li key={cue.id}>
                <span className="run-sheet-number">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{cue.label}</strong>
                  <span>{cue.performerCue}</span>
                </div>
                <span className={`run-sheet-surface run-sheet-surface-${cue.surface}`}>
                  {SURFACE_LABELS[cue.surface]}
                </span>
              </li>
            ))}
          </ol>

          <nav className="run-sheet-actions" aria-label="Show surfaces">
            <Link className="aim-xp-button" href="/event">Audience view</Link>
            <Link className="aim-xp-button aim-xp-button-primary" href="/stage">Stage display</Link>
          </nav>
        </AimWindow>
      </main>
      <style>{`
        .run-sheet-page { min-height: 100dvh; padding: 20px; }
        .run-sheet-main { width: min(100%, 900px); margin: 0 auto; }
        .run-sheet-note { display: grid; gap: 3px; margin: 8px; padding: 10px 12px; border: 1px solid #b9b3a0; background: #fff7cf; font-size: 12px; }
        .run-sheet-note span { color: #555; }
        .run-sheet-list { margin: 8px; padding: 0; border: 1px solid #808080; background: #fff; list-style: none; box-shadow: inset 1px 1px 0 #4a4a4a; }
        .run-sheet-list li { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 10px; border-bottom: 1px solid #ddd; }
        .run-sheet-list li:last-child { border-bottom: 0; }
        .run-sheet-list li > div { display: grid; min-width: 0; gap: 2px; }
        .run-sheet-list li > div strong { color: #1a3d6e; font-size: 13px; }
        .run-sheet-list li > div span { color: #555; font-size: 11px; line-height: 1.35; }
        .run-sheet-number { color: #777; font-family: 'Courier New', monospace; font-size: 13px; font-variant-numeric: tabular-nums; }
        .run-sheet-surface { border: 1px solid #7d7d7d; background: #ece9d8; color: #333; font-size: 9px; font-weight: 700; padding: 3px 5px; white-space: nowrap; }
        .run-sheet-surface-live { border-color: #003c74; background: #316ac5; color: #fff; }
        .run-sheet-surface-online-only { border-color: #8a6500; background: #ffd652; color: #4a3000; }
        .run-sheet-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 8px 10px; }
        .run-sheet-actions a { display: inline-flex; align-items: center; text-decoration: none; }
        @media (max-width: 620px) {
          .run-sheet-page { padding: 8px; }
          .run-sheet-list li { grid-template-columns: 32px minmax(0, 1fr); }
          .run-sheet-surface { grid-column: 2; justify-self: start; }
        }
      `}</style>
    </div>
  );
}
