'use client';

import type { AudienceCue } from '@/lib/audience-cues';
import './audience-cues.css';

function feedbackHref(value: string): string | null {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || /[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith('//')) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value, 'https://audience-cues.invalid/');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || (!hasScheme && parsed.origin !== 'https://audience-cues.invalid')) return null;
    return value;
  } catch {
    return null;
  }
}

function cueCopy(cue: AudienceCue): { context: string; action: string } | null {
  switch (cue.action.type) {
    case 'poll':
      switch (cue.action.kind) {
        case 'trl': return { context: 'TRL voting time.', action: 'Open TRL' };
        case 'trivia': return { context: 'Pop quiz: 2006 edition.', action: 'Open Trivia' };
        case 'superlative': return { context: 'Pick a 2006er.', action: 'Open Superlatives' };
        default: return null;
      }
    case 'essay': return { context: 'Your essay is due.', action: 'Open essay' };
    case 'feedback': return { context: 'How was the show?', action: 'Open feedback form ↗' };
    case 'awards': return { context: 'Tonight’s winners.', action: 'View results' };
    case 'commercial':
    default: return null;
  }
}

/** An invitation only: opening an audience task always requires a viewer click. */
export default function AudienceCueBar({ cue, onAction, onDismiss }: {
  cue: AudienceCue | null;
  onAction: (cue: AudienceCue) => void;
  onDismiss: () => void;
}) {
  if (!cue || !cue.enabled || cue.action.type === 'commercial') return null;
  const copy = cueCopy(cue);
  if (!copy) return null;
  const href = cue.action.type === 'feedback' ? feedbackHref(cue.action.formUrl) : null;
  if (cue.action.type === 'feedback' && !href) return null;

  return (
    <aside className="show2006-audience-cue" aria-label="Show prompt" data-cue-id={cue.id} data-cue-action={cue.action.type}>
      <span className="show2006-audience-cue-copy" role="status">{copy.context}</span>
      {href ? (
        <a className="show2006-audience-cue-action" href={href} target="_blank" rel="noopener noreferrer" aria-label="Open feedback form (opens a new tab)">{copy.action}</a>
      ) : (
        <button type="button" className="show2006-audience-cue-action" onClick={() => onAction(cue)}>{copy.action}</button>
      )}
      <button type="button" className="show2006-audience-cue-dismiss" onClick={onDismiss} aria-label="Dismiss show prompt" title="Dismiss show prompt">×</button>
    </aside>
  );
}
