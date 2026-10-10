'use client';

import { useEffect, useState } from 'react';
import {
  AUDIENCE_MOMENT_ACTIONS,
  AUDIENCE_MOMENT_ACTION_LABEL,
  AUDIENCE_MOMENT_MAX_LENGTH,
  AUDIENCE_MOMENT_PRESETS,
  AUDIENCE_MOMENT_TTL_MS,
  defaultActionLabel,
  type AudienceMoment,
  type AudienceMomentAction,
  type AudienceMomentInput,
} from '@/lib/audience-moments';

function sentAgo(sentAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(sentAt)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

export default function AudienceMoments() {
  const [current, setCurrent] = useState<AudienceMoment | null>(null);
  const [message, setMessage] = useState('');
  const [action, setAction] = useState<AudienceMomentAction>('none');
  const [autoOpen, setAutoOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    fetch('/api/admin/audience-moment')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load');
        setCurrent(data.moment || null);
      })
      .catch((error: Error) => setFeedback({ type: 'error', text: error.message }));

    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function post(body: Record<string, unknown>) {
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/admin/audience-moment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send');
      setCurrent(data.moment || null);
      setFeedback({ type: 'success', text: data.moment ? 'Sent to everyone online' : 'Cleared' });
      return true;
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Failed to send' });
      return false;
    } finally {
      setSending(false);
    }
  }

  const send = (moment: AudienceMomentInput) => post(moment);

  async function sendCustom(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    const ok = await send({ message: message.trim(), action, actionLabel: defaultActionLabel(action), autoOpen });
    if (ok) setMessage('');
  }

  const live = current && now - Date.parse(current.sentAt) <= AUDIENCE_MOMENT_TTL_MS;

  return (
    <div className="twitch-card p-4">
      <h2 className="text-lg font-semibold mb-1 text-twitch-text">Audience Moments</h2>
      <p className="text-xs text-twitch-text-alt mb-4">
        Push a Clippy line to every online viewer at once. Viewers who join in the next
        {' '}{AUDIENCE_MOMENT_TTL_MS / 60_000} minutes see it too.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-4">
        {AUDIENCE_MOMENT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={sending}
            onClick={() => send(preset.moment)}
            title={preset.moment.message}
            className="twitch-button text-sm min-h-[44px] disabled:opacity-50"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form onSubmit={sendCustom} className="space-y-2 mb-4">
        <label className="block text-xs font-semibold text-twitch-text-alt" htmlFor="moment-message">Custom Clippy line</label>
        <textarea
          id="moment-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={AUDIENCE_MOMENT_MAX_LENGTH}
          rows={2}
          placeholder="It looks like you're…"
          className="twitch-input w-full text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as AudienceMomentAction)}
            className="twitch-input text-sm flex-1 min-w-[140px]"
            aria-label="Button target"
          >
            {AUDIENCE_MOMENT_ACTIONS.map((value) => (
              <option key={value} value={value}>{AUDIENCE_MOMENT_ACTION_LABEL[value]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-twitch-text-alt">
            <input
              type="checkbox"
              checked={autoOpen && action !== 'none'}
              disabled={action === 'none'}
              onChange={(event) => setAutoOpen(event.target.checked)}
            />
            open it for them
          </label>
          <button type="submit" disabled={sending || !message.trim()} className="twitch-button text-sm min-h-[44px] disabled:opacity-50">
            Send
          </button>
        </div>
      </form>

      <div className="border-t border-twitch-border pt-3 text-xs">
        {current && live ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-twitch-text-alt uppercase tracking-wide mb-1">Showing · sent {sentAgo(current.sentAt, now)}</p>
              <p className="text-twitch-text">{current.message}</p>
              {current.action !== 'none' && (
                <p className="text-twitch-text-alt mt-1">
                  → {AUDIENCE_MOMENT_ACTION_LABEL[current.action]}{current.autoOpen ? ' (auto-opened)' : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={sending}
              onClick={() => post({ clear: true })}
              className="twitch-button-secondary text-xs min-h-[36px] px-3 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        ) : (
          <p className="text-twitch-text-alt">Nothing showing right now.</p>
        )}
        {feedback && (
          <p className={`mt-2 ${feedback.type === 'error' ? 'text-red-400' : 'text-green-400'}`} role="status">{feedback.text}</p>
        )}
      </div>
    </div>
  );
}
