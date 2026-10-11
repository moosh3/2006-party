'use client';

import { useState, useEffect, useRef } from 'react';
import CountdownEditor from './CountdownEditor';
import type { CountdownCue } from '@/lib/countdown';
import type { ProgramStream } from '@/lib/program-stream';
import { MUX_SOURCE_TYPE, YOUTUBE_VIDEO_SOURCE_TYPE, YOUTUBE_PLAYLIST_SOURCE_TYPE } from '@/lib/youtube';

function mediaSourceLabel(sourceType?: string) {
  if (!sourceType || sourceType === MUX_SOURCE_TYPE) return 'Mux';
  if (sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) return 'YouTube Video';
  if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE) return 'YouTube Playlist';
  return 'Unknown source';
}

function timedDuration(value: unknown): number | null {
  // PostgreSQL numeric values can cross the API boundary as decimal strings.
  // Reject blanks, arbitrary coercions and non-finite values rather than
  // disabling valid fractional videos or accepting malformed queue timers.
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Number((seconds % 60).toFixed(3));
  return `${minutes + (remainder === 60 ? 1 : 0)}m ${remainder === 60 ? 0 : remainder}s`;
}

interface QueueItem {
  id: string;
  position: number;
  mux_item_id: string;
  created_at: string;
  countdown: CountdownCue | null;
  mux_items: {
    id: string;
    playback_id: string;
    label: string;
    kind: string;
    duration_seconds?: number | string | null;
    source_type?: string;
  };
}

interface MediaItem {
  id: string;
  playback_id: string;
  label: string;
  kind: string;
  duration_seconds?: number | string | null;
  source_type?: string;
}

export default function QueueManager({ program, onStreamRefresh }: { program?: ProgramStream | null; onStreamRefresh?: () => void }) {
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [countdownEditor, setCountdownEditor] = useState<QueueItem | 'new' | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [muxItems, setMuxItems] = useState<MediaItem[]>([]);
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [holdScreenEnabled, setHoldScreenEnabled] = useState(false);
  const [holdScreenMuxItemId, setHoldScreenMuxItemId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [destination, setDestination] = useState('1');
  const [undo, setUndo] = useState<{ before: QueueItem[]; after: string[] } | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const orderBusy = useRef(false);
  const queueRequest = useRef(0);
  const nextCommand = useRef<{ commandId: string; expectedSessionId?: string } | null>(null);

  useEffect(() => {
    loadQueue();
    loadMuxItems();
    loadAutoAdvanceStatus();
    loadHoldScreenStatus();

    // Refresh periodically
    const interval = setInterval(() => {
      loadQueue();
      loadMuxItems();
      loadAutoAdvanceStatus();
      loadHoldScreenStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  async function loadQueue() {
    if (orderBusy.current) return;
    const request = ++queueRequest.current;
    try {
      const response = await fetch('/api/admin/queue');
      if (response.ok) {
        const data = await response.json();
        if (request !== queueRequest.current || orderBusy.current) return;
        const nextQueue: QueueItem[] = data.queue || [];
        setQueue(nextQueue);
        setSelectedIds(ids => ids.filter(id => nextQueue.some(item => item.id === id)));
        setUndo(previous => previous && previous.after.join(',') === nextQueue.map(item => item.id).join(',') ? previous : null);
      }
    } catch (error) {
      console.error('Failed to load queue:', error);
    }
  }

  async function loadMuxItems() {
    try {
      const response = await fetch('/api/admin/mux-items');
      if (response.ok) {
        const data = await response.json();
        setMuxItems(data.items || []);
      }
    } catch (error) {
      console.error('Failed to load mux items:', error);
    }
  }

  async function loadAutoAdvanceStatus() {
    try {
      const response = await fetch('/api/admin/queue/auto-advance');
      if (response.ok) {
        const data = await response.json();
        setAutoAdvanceEnabled(data.auto_advance_enabled || false);
      }
    } catch (error) {
      console.error('Failed to load auto-advance status:', error);
    }
  }

  async function loadHoldScreenStatus() {
    try {
      const response = await fetch('/api/admin/hold-screen');
      if (response.ok) {
        const data = await response.json();
        setHoldScreenEnabled(data.hold_screen_enabled || false);
        setHoldScreenMuxItemId(data.hold_screen_mux_item_id || null);
      }
    } catch (error) {
      console.error('Failed to load hold screen status:', error);
    }
  }

  async function handleAddToQueue(muxItemId: string, label: string) {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muxItemId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Added "${label}" to queue` });
        await loadQueue();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add to queue' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function handleRemoveFromQueue(queueItemId: string, label: string) {
    if (!confirm(`Remove "${label}" from queue?`)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/queue/${queueItemId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Removed "${label}" from queue` });
        await loadQueue();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to remove from queue' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  const selected = queue.filter(item => selectedIds.includes(item.id));
  const moveButton = 'min-h-[44px] px-3 py-2 rounded border border-twitch-border bg-[oklch(0.93_0.015_250)] text-twitch-text text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

  function selectCue(id: string, range: boolean) {
    if (loading) return;
    const anchor = queue.findIndex(item => item.id === selectionAnchor.current);
    const index = queue.findIndex(item => item.id === id);
    if (range && anchor >= 0) {
      const rangeIds = queue.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map(item => item.id);
      setSelectedIds(ids => Array.from(new Set([...ids, ...rangeIds])));
    } else {
      setSelectedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
      selectionAnchor.current = id;
    }
  }

  async function moveSelection(direction: 'up' | 'down' | 'top' | 'bottom' | 'position') {
    if (!selected.length || loading) return;
    let next = [...queue];
    if (direction === 'up') {
      for (let i = 1; i < next.length; i++) {
        if (selectedIds.includes(next[i].id) && !selectedIds.includes(next[i - 1].id)) {
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
        }
      }
    } else if (direction === 'down') {
      for (let i = next.length - 2; i >= 0; i--) {
        if (selectedIds.includes(next[i].id) && !selectedIds.includes(next[i + 1].id)) {
          [next[i + 1], next[i]] = [next[i], next[i + 1]];
        }
      }
    } else {
      const rest = queue.filter(item => !selectedIds.includes(item.id));
      const position = direction === 'top' ? 1 : direction === 'bottom' ? rest.length + 1 : Number(destination);
      if (!Number.isInteger(position) || position < 1 || position > rest.length + 1) {
        setMessage({ type: 'error', text: `Choose a position from 1 to ${rest.length + 1}.` });
        return;
      }
      next = [...rest.slice(0, position - 1), ...selected, ...rest.slice(position - 1)];
    }
    await updateQueueOrder(next);
  }

  async function updateQueueOrder(next: QueueItem[], isUndo = false) {
    if (orderBusy.current || next.every((item, index) => item.id === queue[index]?.id)) return;
    orderBusy.current = true;
    ++queueRequest.current; // Ignore polling responses started before this edit.
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next.map((item, index) => ({ id: item.id, position: index + 1 })) }),
      });
      if (response.ok) {
        setUndo(isUndo ? null : { before: queue, after: next.map(item => item.id) });
        setQueue(next.map((item, index) => ({ ...item, position: index + 1 })));
        setMessage({ type: 'success', text: isUndo ? 'Move undone.' : 'Queue order saved.' });
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Could not save the move. Refreshing the queue.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Could not confirm the move. Refreshing the queue; check the order before retrying.' });
    } finally {
      orderBusy.current = false;
      await loadQueue();
      setLoading(false);
    }
  }

  async function handleToggleAutoAdvance() {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/queue/auto-advance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !autoAdvanceEnabled, commandId: crypto.randomUUID() }),
      });

      const data = await response.json();

      if (response.ok) {
        setAutoAdvanceEnabled(data.auto_advance_enabled);
        onStreamRefresh?.();
        setMessage({
          type: 'success',
          text: `Auto-advance ${data.auto_advance_enabled ? 'enabled' : 'disabled'}`
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to toggle auto-advance' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function handleNextVideo() {
    if (queue.length === 0) {
      setMessage({ type: 'error', text: 'No videos in queue' });
      return;
    }

    if (!confirm('Advance to next video in queue?')) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      if (!nextCommand.current) nextCommand.current = {
        commandId: crypto.randomUUID(),
        expectedSessionId: program?.playoutMode === 'manual' ? program.playbackSessionId : undefined,
      };
      const response = await fetch('/api/admin/queue/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextCommand.current),
      });

      const data = await response.json();

      if (response.ok) {
        nextCommand.current = null;
        onStreamRefresh?.();
        setMessage({
          type: 'success',
          text: `Now playing: ${data.advanced_to.title}`
        });
        await loadQueue();
      } else {
        if (response.status < 500) nextCommand.current = null;
        setMessage({ type: 'error', text: data.error || 'Failed to advance to next video' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  const isInQueue = (muxItemId: string) => {
    return queue.some(item => item.mux_item_id === muxItemId);
  };

  const queueableItems = muxItems.filter((item) => {
    const sourceType = item.source_type || MUX_SOURCE_TYPE;
    return (sourceType === MUX_SOURCE_TYPE || sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) && item.kind !== 'live';
  });

  async function handleSetHoldScreen(muxItemId: string, label: string) {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/hold-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_item',
          muxItemId
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: `Hold screen set to "${label}"` });
        setHoldScreenMuxItemId(muxItemId);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to set hold screen' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  async function handleToggleHoldScreen() {
    if (!holdScreenMuxItemId && !holdScreenEnabled) {
      setMessage({ type: 'error', text: 'Please select a hold screen video first' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/hold-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: holdScreenEnabled ? 'disable' : 'enable'
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setHoldScreenEnabled(data.hold_screen_enabled);
        setMessage({
          type: 'success',
          text: `Hold screen ${data.hold_screen_enabled ? 'enabled' : 'disabled'}`
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to toggle hold screen' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  return (
    <div className="space-y-4">
      <div className="twitch-card operator-queue-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold text-twitch-text flex items-center gap-4">
          <span className="flex items-center gap-2">
            <svg className="w-5 h-5 text-twitch-purple" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            </svg>
            <span>Show queue</span>
          </span>
          <span className="text-sm font-normal text-twitch-text-alt">
            {queue.length} {queue.length === 1 ? 'video' : 'videos'}
          </span>
        </h3>
        <button type="button" className="min-h-[44px] px-4 rounded border border-twitch-purple text-twitch-purple font-semibold" disabled={loading} onClick={() => setCountdownEditor('new')}>Add countdown cue</button>
        </div>

        {message && (
          <div role="status" aria-live="polite" className={`rounded p-3 mb-3 text-sm ${
            message.type === 'success'
              ? 'bg-[oklch(0.95_0.025_150)] border border-[oklch(0.7_0.08_150)] text-[oklch(0.35_0.08_150)]'
              : 'bg-error/10 border border-error text-error'
          }`}>
            {message.text}
          </div>
        )}


        {countdownEditor && <CountdownEditor key={countdownEditor === 'new' ? 'new' : countdownEditor.id} media={muxItems} initial={countdownEditor === 'new' ? undefined : countdownEditor} onCancel={() => setCountdownEditor(null)} onSaved={() => { setCountdownEditor(null); void loadQueue(); setMessage({ type: 'success', text: 'Countdown cue saved. Playback is unchanged.' }); }} />}

        {/* Adding media is preparation; the running order stays in focus. */}
        <details className="operator-queue-library mb-4" open={libraryOpen} onToggle={event => setLibraryOpen(event.currentTarget.open)}>
          <summary className="min-h-[44px] cursor-pointer text-sm font-semibold text-twitch-text py-3">Add videos from library</summary>
          <label className="block text-sm font-medium mb-3">Search videos
            <input type="search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} className="twitch-input w-full mt-2" placeholder="Find a video by title…" />
          </label>
          {queueableItems.length === 0 ? (
            <p className="text-sm text-twitch-text-alt text-center py-4">
              No Mux or individual YouTube videos in library. Add a video from the main controls; playlists cannot enter the timed queue.
            </p>
          ) : (
            <div className="operator-queue-library-list">
              {!queueableItems.some(item => item.label.toLowerCase().includes(librarySearch.trim().toLowerCase())) && <p className="py-4 text-sm">No videos match “{librarySearch}”.</p>}
              {queueableItems.filter(item => item.label.toLowerCase().includes(librarySearch.trim().toLowerCase())).map((item) => {
                const duration = timedDuration(item.duration_seconds);
                return (
                <div key={item.id} className="operator-queue-library-row">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-twitch-text truncate">
                          {item.label}
                        </p>
                        <p className="text-xs text-twitch-text-alt mt-1">{mediaSourceLabel(item.source_type)}</p>
                        {duration !== null && (
                          <p className="text-xs text-twitch-text-alt mt-1">
                            {formatDuration(duration)}
                          </p>
                        )}
                        {duration === null && <p className="text-xs text-yellow-500 mt-1">An exact positive duration is required for the timed queue.</p>}
                      </div>
                      <button
                        onClick={() => handleAddToQueue(item.id, item.label)}
                        disabled={loading || isInQueue(item.id) || duration === null}
                        className={`w-full sm:w-auto px-4 py-2 rounded text-sm font-medium transition-colors min-h-[44px] ${
                          isInQueue(item.id) || duration === null
                            ? 'bg-twitch-hover text-twitch-text-alt cursor-not-allowed'
                            : 'bg-twitch-purple hover:bg-purple-600 text-white'
                        }`}
                      >
                        {isInQueue(item.id) ? 'In Queue' : duration === null ? 'Needs Duration' : 'Add to Queue'}
                      </button>
                    </div>

                  </div>
                </div>
                );
              })}
            </div>
          )}
        </details>

        {/* Manual Next Button */}
        <button
          onClick={handleNextVideo}
          disabled={loading || queue.length === 0}
          className="operator-go w-full mb-4 bg-[oklch(0.42_0.1_150)] hover:bg-[oklch(0.36_0.1_150)] disabled:bg-twitch-gray disabled:cursor-not-allowed text-[oklch(0.98_0.008_150)] py-3 px-4 rounded font-medium text-sm transition-colors min-h-[44px]"
        >
          {queue.length > 0 ? '▶ Play Next in Queue' : 'Queue is Empty'}
        </button>

        {/* Select and arrange independently of playback. */}
        <section className="mb-5" aria-label="Arrange queue" aria-busy={loading}>
          <h4 className="font-semibold text-twitch-text">Upcoming cues</h4>
          <p className="text-sm text-twitch-text-alt mt-1 mb-3">Select cues to move them. Shift-click selects a range. Moving never starts playback.</p>
          <div className="border border-twitch-border rounded overflow-hidden">
            {queue.length > 0 && <div className="p-3 bg-[oklch(0.97_0.008_250)] border-b border-twitch-border space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-twitch-text mr-auto" role="status">{selected.length} selected</span>
                <button className={moveButton} disabled={loading || !queue.length} onClick={() => setSelectedIds(queue.map(item => item.id))}>Select all</button>
                <button className={moveButton} disabled={loading || !selected.length} onClick={() => setSelectedIds([])}>Clear</button>
              </div>
              <div className="flex flex-wrap gap-2" hidden={!selected.length && !undo}>
                <button className={moveButton} disabled={loading || !selected.length} onClick={() => moveSelection('up')}>↑ Up</button>
                <button className={moveButton} disabled={loading || !selected.length} onClick={() => moveSelection('down')}>↓ Down</button>
                <button className={moveButton} disabled={loading || !selected.length} onClick={() => moveSelection('top')}>Move to top</button>
                <button className={moveButton} disabled={loading || !selected.length} onClick={() => moveSelection('bottom')}>Move to end</button>
                <button className={moveButton} disabled={loading || !undo} onClick={() => undo && updateQueueOrder(undo.before, true)}>Undo move</button>
              </div>
              <details hidden={!selected.length}>
              <summary className="cursor-pointer text-sm py-2">Move to a specific position</summary>
              <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); void moveSelection('position'); }}>
                <label className="text-sm text-twitch-text flex flex-wrap items-center gap-2">Move selection to position
                  <input type="number" min="1" max={queue.length - selected.length + 1} step="1" value={destination} onChange={event => setDestination(event.target.value)} disabled={loading || !selected.length} className="twitch-input w-20 min-h-[44px] px-2" />
                </label>
                <button className={moveButton} disabled={loading || !selected.length} type="submit">Move</button>
              </form>
              </details>
            </div>}
            <ol className="max-h-[60vh] overflow-y-auto divide-y divide-twitch-border" aria-label="Upcoming videos">
              {queue.map((item, index) => {
                const muxItem = Array.isArray(item.mux_items) ? item.mux_items[0] : item.mux_items;
                const duration = timedDuration(muxItem?.duration_seconds);
                const isSelected = selectedIds.includes(item.id);
                return (
                  <li key={item.id} className={`flex flex-wrap items-center gap-2 p-2 ${isSelected ? 'bg-[oklch(0.9_0.045_250)]' : 'bg-[oklch(0.97_0.008_250)]'}`}>
                    <button type="button" aria-pressed={isSelected} aria-label={`Select cue ${index + 1}: ${muxItem?.label || 'Unknown'}`} disabled={loading}
                      onClick={event => selectCue(item.id, event.shiftKey)}
                      className="flex flex-1 basis-60 items-center gap-3 text-left min-w-0 min-h-[60px] p-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                      <span aria-hidden="true" className="text-lg text-twitch-text">{isSelected ? '☑' : '☐'}</span>
                      <span className="text-sm tabular-nums text-twitch-text-alt w-6 shrink-0">{index + 1}</span>
                      <span className="min-w-0">
                        {index === 0 && <span className="block text-xs font-bold text-twitch-purple">UP NEXT</span>}
                        <span className="block font-medium text-sm text-twitch-text break-words">{muxItem?.label || 'Unknown'}</span>
                        <span className="block text-xs text-twitch-text-alt mt-1">{item.countdown ? `TRL #${item.countdown.rank} · ${item.countdown.rank === 1 ? 'Full video' : `${item.countdown.durationSeconds}s from ${item.countdown.startSeconds}s`} · ${item.countdown.bannerUrl ? 'Banner set' : 'Number only'}` : `${mediaSourceLabel(muxItem?.source_type)}${duration !== null ? ` · ${formatDuration(duration)}` : ''}`}</span>
                      </span>
                    </button>
                    <div className="flex gap-2 ml-auto">
                    {item.countdown && <button type="button" className={`${moveButton} shrink-0`} disabled={loading} aria-label={`Edit countdown #${item.countdown.rank}`} onClick={() => setCountdownEditor(item)}>Edit</button>}
                    <button type="button" className={`${moveButton} shrink-0`} aria-label={`Remove ${muxItem?.label || 'video'} from queue`} disabled={loading} onClick={() => handleRemoveFromQueue(item.id, muxItem?.label || 'video')}>Remove</button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {!queue.length && <div className="operator-queue-empty">
              <p className="font-semibold">Your running order starts here.</p>
              <p className="text-sm text-twitch-text-alt mt-2">Add your show videos, then arrange them in the order you’ll play them.</p>
              <button type="button" className="twitch-button min-h-[44px] px-4 mt-4" onClick={() => setLibraryOpen(true)}>Browse library</button>
            </div>}
          </div>
        </section>

        <details className="mb-4">
          <summary className="min-h-[44px] cursor-pointer text-sm font-semibold text-twitch-text py-3">Automation &amp; hold screen settings</summary>
        {/* Auto-advance Toggle */}
        <div className="bg-twitch-darker border border-twitch-border rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-twitch-text">Auto-advance</p>
              <p className="text-xs text-twitch-text-alt">
                Server-timed videos; automatically switches to hold when the queue ends
              </p>
            </div>
            <button
              onClick={handleToggleAutoAdvance}
              disabled={loading}
              type="button"
              role="switch"
              aria-label="Automatic queue advancement"
              aria-checked={autoAdvanceEnabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoAdvanceEnabled ? 'bg-twitch-purple' : 'bg-twitch-gray'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoAdvanceEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {program && (
            <p className="text-xs text-twitch-text-alt mt-2" role="status">
              {program.automationError || `Automation: ${program.automationStatus || 'checking'}`}
              {program.nextTransitionAt && ` · next transition ${new Date(program.nextTransitionAt).toLocaleTimeString()}`}
            </p>
          )}
        </div>

        {/* Hold Screen Toggle */}
        <div className="bg-twitch-darker border border-twitch-border rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-medium text-twitch-text">Hold Screen</p>
              <p className="text-xs text-twitch-text-alt">
                Display a looping video when queue is idle
              </p>
            </div>
            <button
              onClick={handleToggleHoldScreen}
              disabled={loading || (!holdScreenMuxItemId && !holdScreenEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                holdScreenEnabled ? 'bg-success' : 'bg-twitch-gray'
              } ${!holdScreenMuxItemId ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  holdScreenEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {holdScreenMuxItemId && (
            <div className="text-xs text-twitch-text-alt bg-twitch-dark px-2 py-1 rounded">
              <span className="font-medium text-twitch-text">Selected: </span>
              {muxItems.find(item => item.id === holdScreenMuxItemId)?.label || 'Unknown'}
            </div>
          )}
          {!holdScreenMuxItemId && (
            <div className="text-xs text-yellow-500">
              ⚠️ Select a media item from the hold screen source list
            </div>
          )}
        </div>

        {/* Hold Screen Source */}
        <div className="bg-twitch-darker border border-twitch-border rounded-lg p-3 mb-4">
          <p className="text-xs font-semibold text-twitch-text-alt uppercase tracking-wider mb-2">
            Hold Screen Source
          </p>
          {muxItems.length === 0 ? (
            <p className="text-sm text-twitch-text-alt text-center py-4">
              No media items in library. Add one from the main controls.
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {muxItems.map((item) => {
                return (
                  <div key={item.id} className="bg-twitch-dark border border-twitch-border rounded p-3">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-twitch-text truncate">
                            {item.label}
                          </p>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-twitch-purple/20 text-twitch-purple">
                            {mediaSourceLabel(item.source_type)}
                          </span>
                        </div>
                        <p className="text-xs text-twitch-text-alt font-mono truncate">
                          {item.playback_id}
                        </p>
                      </div>
                      <button
                        onClick={() => handleSetHoldScreen(item.id, item.label)}
                        disabled={loading || holdScreenMuxItemId === item.id}
                        className={`w-full px-3 py-2 rounded text-xs font-medium transition-colors min-h-[44px] ${
                          holdScreenMuxItemId === item.id
                            ? 'bg-success/20 text-success border border-success cursor-not-allowed'
                            : 'bg-twitch-gray hover:bg-twitch-hover text-twitch-text'
                        }`}
                      >
                        {holdScreenMuxItemId === item.id ? '✓ Set as Hold Screen' : 'Set as Hold Screen'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        </details>


      </div>
    </div>
  );
}
