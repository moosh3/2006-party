'use client';
import { useRef, useState } from 'react';
import { COUNTDOWN_LENGTHS, countdownError, type CountdownCue } from '@/lib/countdown';

type Media = { id: string; label: string; duration_seconds?: number | string | null; kind: string; source_type?: string };
export default function CountdownEditor({ media, initial, onSaved, onCancel }: {
  media: Media[];
  initial?: { id: string; mux_item_id: string; countdown: CountdownCue | null };
  onSaved: () => void; onCancel: () => void;
}) {
  const [rank, setRank] = useState(initial?.countdown?.rank || 5);
  const [mediaId, setMediaId] = useState(initial?.mux_item_id || '');
  const [start, setStart] = useState(String(initial?.countdown?.startSeconds || 0));
  const [length, setLength] = useState(String(initial?.countdown?.durationSeconds || 15));
  const [banner, setBanner] = useState(initial?.countdown?.bannerUrl || '');
  const command = useRef<{ payload: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const videos = media.filter(m => m.kind !== 'live' && ['mux', 'youtube_video'].includes(m.source_type || 'mux') && Number(m.duration_seconds) > 0);
  const duration = Number(videos.find(m => m.id === mediaId)?.duration_seconds || 0);
  const cue: CountdownCue = { rank, startSeconds: rank === 1 ? 0 : start.trim() ? Number(start) : NaN,
    durationSeconds: rank === 1 ? duration : length.trim() ? Number(length) : NaN, bannerUrl: banner.trim() || null };
  const validation = countdownError(cue, duration);
  const input = 'block w-full mt-1 min-h-[44px] rounded border border-twitch-border bg-white text-twitch-text px-3';
  async function save() {
    if (busy || validation) return;
    const payload = JSON.stringify({ muxItemId: mediaId, queueId: initial?.id, countdown: cue });
    if (command.current?.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/queue/countdown', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), commandId: command.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to save cue.');
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save cue. Refresh the queue before retrying.'); }
    finally { setBusy(false); }
  }
  return <form className="mb-5 border border-twitch-purple rounded p-4 space-y-3" aria-label="Countdown cue" onSubmit={e => { e.preventDefault(); void save(); }}>
    <h4 className="font-semibold">{initial ? 'Edit upcoming countdown cue' : 'Add countdown cue'}</h4>
    <p className="text-sm text-twitch-text-alt">Assign a song to a numbered slot. Your custom videos can go between slots. Moving a cue keeps its number, timing and banner together.</p>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block text-sm">Countdown position<select autoFocus className={input} value={rank} onChange={e => { const value = Number(e.target.value); setRank(value); setLength(String(COUNTDOWN_LENGTHS[value] || duration)); setBanner(''); }}>
        {[5,4,3,2,1].map(n => <option key={n} value={n}>#{n}{n === 1 ? ' — full video' : ` — ${COUNTDOWN_LENGTHS[n]} seconds${n === 5 ? '' : ' (editable)'}`}</option>)}
      </select></label>
      <label className="block text-sm">Music video<select className={input} value={mediaId} onChange={e => setMediaId(e.target.value)}><option value="">Choose from the library</option>{videos.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      {rank !== 1 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm">Highlight starts at (seconds)<input className={input} type="number" min="0" step="0.1" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="text-sm">Play for (seconds)<input className={input} type="number" min="0.1" step="0.1" value={length} disabled={rank === 5} onChange={e => setLength(e.target.value)} /></label>
      </div>}
      {mediaId && <p className="text-sm" role="status">{validation || (rank === 1 ? `Plays the full ${duration}-second video.` : `Plays ${cue.startSeconds}s–${Number((cue.startSeconds + cue.durationSeconds).toFixed(3))}s of the original video.`)}</p>}
      <label className="block text-sm">#{rank} footer banner URL (optional)<input className={input} value={banner} onChange={e => setBanner(e.target.value)} placeholder={`https://…/number-${rank}.webm`} /></label>
      <p className="text-xs text-twitch-text-alt">Use the file with #{rank} already on it: a direct MP4, WebM, or image URL. Transparent WebM depends on the viewing browser; rehearse your file. Without a file, viewers see a simple #{rank}. Changing position clears the banner so the old number cannot carry over.</p>
      <p className="text-xs text-twitch-text-alt">Auto-advance moves to the next cue when this excerpt ends. With auto-advance off, it pauses at the end until you press Play Next.</p>
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={!!validation || !mediaId} className="min-h-[44px] rounded bg-twitch-purple text-white px-4 disabled:opacity-50">{busy ? 'Saving…' : initial ? 'Save cue' : 'Add to queue'}</button><button type="button" onClick={onCancel} className="min-h-[44px] px-4 rounded border border-twitch-border">Cancel</button></div>
    </fieldset>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </form>;
}
