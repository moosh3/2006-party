'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeHealth, type RealtimeHealthStatus } from '@/hooks/useRealtimeHealth';
import {
  CHANNEL_NAMES,
  DATABASE_TABLES,
  PLAYBACK_ACTIONS,
} from '@/lib/constants';

interface HoldScreenMuxItem {
  id: string;
  playback_id: string;
  label: string;
  kind: string;
  duration_seconds?: number;
}

type PlayoutMode = 'manual' | 'schedule';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatTransition(value?: string | null) {
  if (!value) return 'None scheduled';

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

// A websocket reconnect can be momentary while the server-status poll remains
// healthy. Show a warning only after it persists; confirmed offline is immediate.
export function useSustainedRealtimeHealth(health: RealtimeHealthStatus) {
  const [displayedHealth, setDisplayedHealth] = useState<RealtimeHealthStatus>('healthy');
  useEffect(() => {
    if (health === displayedHealth) return;
    if (health === 'offline') {
      setDisplayedHealth(health);
      return;
    }
    const timer = window.setTimeout(() => setDisplayedHealth(health), health === 'healthy' ? 3000 : 5000);
    return () => window.clearTimeout(timer);
  }, [health, displayedHealth]);
  return displayedHealth;
}

export default function PlaybackControls() {
  const [playbackState, setPlaybackState] = useState<'playing' | 'paused'>('paused');
  const [playoutMode, setPlayoutMode] = useState<PlayoutMode>('schedule');
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<string | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [nextTransitionAt, setNextTransitionAt] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [playbackSessionId, setPlaybackSessionId] = useState<string | null>(null);
  const [stateUnavailable, setStateUnavailable] = useState(true);
  const [hasCheckedState, setHasCheckedState] = useState(false);
  const stateRequestSequenceRef = useRef(0);
  const stateControllerRef = useRef<AbortController | null>(null);
  const messageTimerRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  
  // Hold screen state
  const [holdScreenEnabled, setHoldScreenEnabled] = useState(false);
  const [holdScreenMuxItem, setHoldScreenMuxItem] = useState<HoldScreenMuxItem | null>(null);
  const realtimeHealth = useSustainedRealtimeHealth(useRealtimeHealth());
  const [dismissedHealthAlert, setDismissedHealthAlert] = useState(false);

  const clearMessageTimer = useCallback(() => {
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = null;
  }, []);

  const loadState = useCallback(async () => {
    const sequence = ++stateRequestSequenceRef.current;
    stateControllerRef.current?.abort();
    const controller = new AbortController();
    stateControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/admin/playback-control', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Playback status returned ${response.status}`);
      const data = await response.json();
      if (sequence !== stateRequestSequenceRef.current) return false;
      if (!['playing', 'paused'].includes(data.playback_state) || !['manual', 'schedule'].includes(data.playout_mode)) {
        throw new Error('Incomplete playback status');
      }
      const manualSessionId = data.playout_mode === 'manual'
        && typeof data.playback_session_id === 'string' && UUID.test(data.playback_session_id)
        ? data.playback_session_id : null;
      if (data.playout_mode === 'manual' && !manualSessionId) throw new Error('Manual cue identity unavailable');
      setPlaybackSessionId(manualSessionId);
      setStateUnavailable(false);
      setHasCheckedState(true);
      setPlaybackState(data.playback_state);
      setPlayoutMode(data.playout_mode);
      setAutoAdvanceEnabled(data.auto_advance_enabled === true);
      setScheduleStatus(data.schedule_status || null);
      setActiveSlotId(data.active_slot_id || null);
      setNextTransitionAt(data.next_transition_at || null);
      setActiveTitle(data.title || null);
      return true;
    } catch (err) {
      if (sequence !== stateRequestSequenceRef.current) return false;
      // A failed read must never leave controls armed with an old cue UUID.
      setPlaybackSessionId(null);
      setStateUnavailable(true);
      setHasCheckedState(true);
      console.error('Failed to load playback state:', err);
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (stateControllerRef.current === controller) stateControllerRef.current = null;
    }
  }, []);

  const invalidateStateRead = useCallback(() => {
    stateRequestSequenceRef.current += 1;
    stateControllerRef.current?.abort();
    stateControllerRef.current = null;
    clearMessageTimer();
  }, [clearMessageTimer]);

  useEffect(() => {
    if (realtimeHealth === 'healthy') {
      setDismissedHealthAlert(false);
    }
  }, [realtimeHealth]);

  useEffect(() => {
    // Load hold screen status
    async function loadHoldScreenStatus() {
      try {
        const response = await fetch('/api/admin/hold-screen');
        if (response.ok) {
          const data = await response.json();
          setHoldScreenEnabled(data.hold_screen_enabled);
          setHoldScreenMuxItem(data.mux_item);
        }
      } catch (err) {
        console.error('Failed to load hold screen status:', err);
      }
    }
    
    loadState();
    loadHoldScreenStatus();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(CHANNEL_NAMES.PLAYBACK_CONTROL_UPDATES)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: DATABASE_TABLES.CURRENT_STREAM,
          filter: 'id=eq.1',
        },
        () => {
          void loadState();
          void loadHoldScreenStatus();
        }
      )
      .subscribe();
    const interval = window.setInterval(() => {
      if (!stateControllerRef.current) void loadState();
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
      stateRequestSequenceRef.current += 1;
      stateControllerRef.current?.abort();
      clearMessageTimer();
    };
  }, [loadState, clearMessageTimer]);

  async function handlePlaybackControl(action: 'play' | 'pause') {
    if (playoutMode === 'schedule') {
      setMessage({ type: 'error', text: 'Schedule mode is active. Switch to queue mode before sending playback commands.' });
      return;
    }
    if (!playbackSessionId || stateUnavailable) {
      setMessage({ type: 'error', text: 'Current cue status is unavailable. Reconnect before sending a playback command.' });
      void loadState();
      return;
    }

    const expectedSessionId = playbackSessionId;
    invalidateStateRead();
    setLoading(true);
    setMessage(null);

    // ISSUE #11: Optimistic update - immediately update UI
    const previousState = playbackState;
    setPlaybackState(action === 'play' ? 'playing' : 'paused');

    try {
      const response = await fetch('/api/admin/playback-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, commandId: crypto.randomUUID(), expectedSessionId }),
      });

      const data = await response.json();

      if (response.ok) {
        setPlaybackState(data.playback_state);
        setMessage({ 
          type: 'success', 
          text: `${action === 'play' ? 'Started' : 'Paused'} playback for all viewers` 
        });
        
        // Clear message after 3 seconds
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
        await loadState();
      } else {
        // Revert optimistic update on error
        setPlaybackState(previousState);
        setMessage({ type: 'error', text: data.error || 'Failed to control playback' });
        if (response.status === 409) {
          setPlaybackSessionId(null);
          await loadState();
        }
      }
    } catch (error) {
      // Revert optimistic update on error
      setPlaybackState(previousState);
      setMessage({ type: 'error', text: 'Network error occurred' });
      setPlaybackSessionId(null);
      await loadState();
    } finally {
      setLoading(false);
    }
  }

  async function handleRestart() {
    if (playoutMode === 'schedule') {
      setMessage({ type: 'error', text: 'Schedule mode is active. Switch to queue mode before restarting playback.' });
      return;
    }
    if (!playbackSessionId || stateUnavailable) {
      setMessage({ type: 'error', text: 'Current cue status is unavailable. Reconnect before restarting playback.' });
      void loadState();
      return;
    }

    const expectedSessionId = playbackSessionId;
    invalidateStateRead();
    setLoading(true);
    setMessage(null);

    // ISSUE #11: Add optimistic update
    setPlaybackState('playing');

    try {
      // ISSUE #10: Use atomic restart action instead of separate seek + play
      const response = await fetch('/api/admin/playback-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: PLAYBACK_ACTIONS.RESTART, commandId: crypto.randomUUID(), expectedSessionId }),
      });

      const data = await response.json();

      if (response.ok) {
        setPlaybackState(data.playback_state);
        setMessage({ 
          type: 'success', 
          text: 'Restarted video for all viewers' 
        });
        
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
        await loadState();
      } else {
        // Revert optimistic update on error
        setMessage({ type: 'error', text: data.error || 'Failed to restart' });
        // Reload actual state
        setPlaybackSessionId(null);
        await loadState();
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
      // Revert optimistic update on error
      setPlaybackSessionId(null);
      await loadState();
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleHoldScreen() {
    if (playoutMode === 'schedule') {
      setMessage({ type: 'error', text: 'Schedule mode uses the scheduled hold screen during gaps. Switch to queue mode for queue hold screen control.' });
      return;
    }

    if (!holdScreenMuxItem && !holdScreenEnabled) {
      setMessage({ type: 'error', text: 'No hold screen configured. Set one in the library first.' });
      return;
    }

    invalidateStateRead();
    setPlaybackSessionId(null);
    setLoading(true);
    setMessage(null);

    const previousState = holdScreenEnabled;
    const action = holdScreenEnabled ? 'disable' : 'enable';
    
    // Optimistic update
    setHoldScreenEnabled(!holdScreenEnabled);

    try {
      const response = await fetch('/api/admin/hold-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, commandId: crypto.randomUUID() }),
      });

      const data = await response.json();

      if (response.ok) {
        setHoldScreenEnabled(data.hold_screen_enabled);
        setMessage({ 
          type: 'success', 
          text: data.hold_screen_enabled 
            ? `Hold screen enabled${holdScreenMuxItem ? ` - "${holdScreenMuxItem.label}"` : ''}` 
            : 'Hold screen disabled - resumed normal playback'
        });
        
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
      } else {
        // Revert optimistic update on error
        setHoldScreenEnabled(previousState);
        setMessage({ type: 'error', text: data.error || 'Failed to toggle hold screen' });
      }
    } catch (error) {
      // Revert optimistic update on error
      setHoldScreenEnabled(previousState);
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      await loadState();
      setLoading(false);
    }
  }

  async function handleModeChange(mode: PlayoutMode) {
    invalidateStateRead();
    setPlaybackSessionId(null);
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/playout-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, commandId: crypto.randomUUID() }),
      });
      const data = await response.json();

      if (response.ok) {
        setPlayoutMode(data.mode || mode);
        setScheduleStatus(data.schedule?.status || null);
        setActiveSlotId(data.schedule?.activeSlotId || null);
        setNextTransitionAt(data.schedule?.nextTransitionAt || null);
        setActiveTitle(data.schedule?.title || null);
        setMessage({
          type: 'success',
          text: mode === 'schedule' ? 'Schedule mode is now active' : 'Queue mode is now active',
        });
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change playout mode' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      await loadState();
      setLoading(false);
    }
  }

  const scheduleLocked = playoutMode === 'schedule';
  const playbackLocked = scheduleLocked || stateUnavailable || !playbackSessionId;
  const showRealtimeAlert = realtimeHealth !== 'healthy' && !dismissedHealthAlert;
  const statusTitle = stateUnavailable
    ? hasCheckedState ? 'Current cue unavailable' : 'Checking current cue…'
    : showRealtimeAlert
      ? realtimeHealth === 'offline' ? 'Live updates unavailable' : 'Live updates reconnecting'
      : 'Playback status current';
  const statusDetail = stateUnavailable
    ? 'Playback controls stay disabled until cue status reconnects.'
    : 'Server status refreshes every 3 seconds.';

  return (
    <div className="twitch-card p-4 border-t-4 border-twitch-purple">
      <h3 className="text-lg font-semibold mb-3 text-twitch-text flex items-center gap-2">
        <div className="w-2 h-2 bg-twitch-purple rounded-full" aria-hidden="true"></div>
        Playback
      </h3>
      
      <div className="bg-twitch-darker border border-twitch-border rounded-lg p-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Show control</p>
            <p className="text-sm text-twitch-text">
              <strong>{stateUnavailable ? 'Checking mode…' : scheduleLocked ? 'Schedule' : 'Queue'}</strong>
              {scheduleLocked && scheduleStatus ? ` · ${scheduleStatus}` : ''}
            </p>
            <p className="text-xs text-twitch-text-alt mt-1">
              {scheduleLocked
                ? `${activeTitle || activeSlotId || 'Hold screen'} · next transition ${formatTransition(nextTransitionAt)}`
                : stateUnavailable ? 'Waiting for current show status.' : autoAdvanceEnabled ? playbackState === 'paused' ? 'Auto-advance on. Resume playback to continue the queue.' : 'Auto-advance on: the next cue starts when this video ends.' : 'Auto-advance off: you choose when to play the next cue.'}
            </p>
          </div>
          <div className="flex shrink-0 rounded-lg overflow-hidden border border-twitch-border">
            <button
              type="button"
              onClick={() => handleModeChange('schedule')}
              disabled={loading || playoutMode === 'schedule'}
              className={`px-3 py-2 text-xs font-semibold min-h-[40px] ${
                playoutMode === 'schedule'
                  ? 'bg-twitch-purple text-white'
                  : 'bg-twitch-hover text-twitch-text hover:bg-twitch-gray'
              }`}
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('manual')}
              disabled={loading || playoutMode === 'manual'}
              className={`px-3 py-2 text-xs font-semibold min-h-[40px] ${
                playoutMode === 'manual'
                  ? 'bg-twitch-purple text-white'
                  : 'bg-twitch-hover text-twitch-text hover:bg-twitch-gray'
              }`}
            >
              Queue
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div className={`rounded p-3 mb-3 text-sm ${
          message.type === 'success' 
            ? 'bg-success/10 border border-success text-success' 
            : 'bg-error/10 border border-error text-error'
        }`}>
          {message.text}
        </div>
      )}

      <div role="status" aria-live="polite" className={`rounded border p-3 mb-3 min-h-[88px] text-sm flex items-start gap-3 ${
        stateUnavailable && hasCheckedState || showRealtimeAlert
          ? realtimeHealth === 'offline' && !stateUnavailable
            ? 'bg-error/10 border-error text-error'
            : 'bg-yellow-500/10 border-yellow-500 text-yellow-300'
          : 'bg-twitch-hover/50 border-twitch-border text-twitch-text-alt'
      }`}>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{statusTitle}</p>
          <p className="text-xs mt-1">{statusDetail}</p>
        </div>
        {showRealtimeAlert && !stateUnavailable && (
          <button
            type="button"
            onClick={() => setDismissedHealthAlert(true)}
            className="text-xs font-semibold hover:underline min-h-[44px] shrink-0"
          >
            Dismiss
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Current State */}
        <div className="flex items-center justify-between bg-twitch-hover p-3 rounded">
          <span className="text-sm text-twitch-text">Current State:</span>
          <span className={`font-semibold text-sm px-3 py-1 rounded ${
            playbackState === 'playing' 
              ? 'bg-success/20 text-success' 
              : 'bg-twitch-gray text-twitch-text-alt'
          }`}>
            {playbackState === 'playing' ? '▶ Playing' : '⏸ Paused'}
          </span>
        </div>

        {/* Hold Screen Status */}
        {holdScreenMuxItem && (
          <div className={`flex items-center justify-between p-3 rounded border ${
            holdScreenEnabled 
              ? 'bg-yellow-500/10 border-yellow-500' 
              : 'bg-twitch-hover border-twitch-border'
          }`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-twitch-text">Hold Screen:</span>
                <span className={`font-semibold text-sm px-2 py-1 rounded ${
                  holdScreenEnabled 
                    ? 'bg-yellow-500/20 text-yellow-500' 
                    : 'bg-twitch-gray text-twitch-text-alt'
                }`}>
                  {holdScreenEnabled ? '★ Active' : 'Ready'}
                </span>
              </div>
              {holdScreenMuxItem && (
                <p className="text-xs text-twitch-text-alt mt-1 truncate">
                  {holdScreenMuxItem.label}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Control Buttons */}
        <div className="operator-transport">
          <button
            onClick={() => handlePlaybackControl('play')}
            disabled={loading || playbackLocked || playbackState === 'playing'}
            className={`py-3 px-4 rounded font-medium text-sm transition-all min-h-[44px] ${
              playbackLocked || playbackState === 'playing'
                ? 'bg-twitch-gray text-twitch-text-alt cursor-not-allowed'
                : 'bg-success hover:bg-green-600 text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              <span>Play</span>
            </div>
          </button>

          <button
            onClick={() => handlePlaybackControl('pause')}
            disabled={loading || playbackLocked || playbackState === 'paused'}
            className={`py-3 px-4 rounded font-medium text-sm transition-all min-h-[44px] ${
              playbackLocked || playbackState === 'paused'
                ? 'bg-twitch-gray text-twitch-text-alt cursor-not-allowed'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Pause</span>
            </div>
          </button>

          <button
            onClick={handleRestart}
            disabled={loading || playbackLocked}
            className={`py-3 px-4 rounded font-medium text-sm transition-all min-h-[44px] ${
              playbackLocked
                ? 'bg-twitch-gray text-twitch-text-alt cursor-not-allowed'
                : 'bg-twitch-purple hover:bg-purple-700 text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
              <span>Restart</span>
            </div>
          </button>

          <button
            onClick={handleToggleHoldScreen}
            disabled={loading || scheduleLocked || (!holdScreenMuxItem && !holdScreenEnabled)}
            className={`py-3 px-4 rounded font-medium text-sm transition-all min-h-[44px] ${
              scheduleLocked || (!holdScreenMuxItem && !holdScreenEnabled)
                ? 'bg-twitch-gray text-twitch-text-alt cursor-not-allowed'
                : holdScreenEnabled
                ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white border-2 border-yellow-500'
            }`}
            title={scheduleLocked ? 'Switch to queue mode to control the hold screen' : !holdScreenMuxItem && !holdScreenEnabled ? 'Set a hold screen in the library first' : holdScreenEnabled ? 'Disable hold screen' : 'Enable hold screen'}
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span>{holdScreenEnabled ? 'Hold ON' : 'Hold Screen'}</span>
            </div>
          </button>
        </div>


      </div>
    </div>
  );
}
