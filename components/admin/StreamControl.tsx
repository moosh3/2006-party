'use client';

import { useState, useEffect, useId } from 'react';
import PlaybackControls from './PlaybackControls';
import { MUX_SOURCE_TYPE, YOUTUBE_PLAYLIST_SOURCE_TYPE, YOUTUBE_VIDEO_SOURCE_TYPE } from '@/lib/youtube';

type OperatorMessage = { type: 'success' | 'warning' | 'error'; text: string };

function messageClass(type: OperatorMessage['type']) {
  if (type === 'warning') return 'bg-amber-50 border border-amber-300 text-amber-900';
  if (type === 'error') return 'bg-red-50 border border-red-300 text-red-800';
  return 'bg-green-50 border border-green-300 text-green-800';
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Number((seconds % 60).toFixed(3));
  return `${minutes + (remainder === 60 ? 1 : 0)}m ${remainder === 60 ? 0 : remainder}s`;
}

function mediaSourceLabel(sourceType: string) {
  if (sourceType === MUX_SOURCE_TYPE) return 'Mux';
  if (sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) return 'YouTube Video';
  if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE) return 'YouTube Playlist';
  return 'Unknown source';
}

interface MediaItem {
  id: string;
  playback_id: string;
  label: string;
  kind: string;
  duration_seconds?: number | string | null;
  source_type?: string;
  youtube_playlist_id?: string | null;
  source_url?: string | null;
}

interface CurrentStream {
  playback_id: string;
  title: string;
  kind: string;
  updated_at: string;
  source_type?: string;
  youtube_playlist_id?: string | null;
  source_url?: string | null;
}

interface Poll {
  id: string;
  question: string;
  type: 'fixed' | 'open';
  is_open: boolean;
  created_at: string;
  closed_at: string | null;
  total_votes: number;
  options: {
    id: string;
    label: string;
    vote_count: number;
    percentage: number;
    author_name?: string | null;
  }[];
}

interface DetailedVoteResult {
  option_id: string;
  option_label: string;
  voters: string[];
  vote_count: number;
}

interface StreamControlProps {
  showLibraryControls?: boolean;
  showPlaybackControls?: boolean;
}

export default function StreamControl({ 
  showLibraryControls = true, 
  showPlaybackControls = true 
}: StreamControlProps) {
  const [librarySearch, setLibrarySearch] = useState('');
  const [muxItems, setMuxItems] = useState<MediaItem[]>([]);
  const [currentStream, setCurrentStream] = useState<CurrentStream | null>(null);
  const [customPlaybackId, setCustomPlaybackId] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customDuration, setCustomDuration] = useState('');
  const [youtubePlaylistUrl, setYoutubePlaylistUrl] = useState('');
  const [youtubePlaylistTitle, setYoutubePlaylistTitle] = useState('');
  const [youtubeVideoUrl, setYoutubeVideoUrl] = useState('');
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState('');
  const [youtubeVideoDuration, setYoutubeVideoDuration] = useState('');
  const [youtubeVideoCheckResult, setYoutubeVideoCheckResult] = useState<OperatorMessage | null>(null);
  const videoFormId = useId();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<OperatorMessage | null>(null);
  
  // Hold screen state
  const [holdScreenMuxItemId, setHoldScreenMuxItemId] = useState<string | null>(null);
  const [holdScreenEnabled, setHoldScreenEnabled] = useState(false);
  
  // Poll state
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollType, setPollType] = useState<'fixed' | 'open'>('fixed');
  const [pollLoading, setPollLoading] = useState(false);
  
  // Poll management state
  const [polls, setPolls] = useState<Poll[]>([]);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState('');
  
  // Voter details state
  const [viewingVotersForPoll, setViewingVotersForPoll] = useState<string | null>(null);
  const [voterDetails, setVoterDetails] = useState<Record<string, DetailedVoteResult[]>>({});
  const [loadingVoters, setLoadingVoters] = useState(false);

  useEffect(() => {
    loadMuxItems();
    loadCurrentStream();
    loadPolls();
    loadHoldScreenConfig();
    
    // Refresh current stream periodically to keep in sync
    const interval = setInterval(() => {
      loadCurrentStream();
      loadPolls();
      loadHoldScreenConfig();
    }, 5000); // Check every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  async function loadMuxItems() {
    try {
      const response = await fetch('/api/admin/mux-items');
      if (response.ok) {
        const data = await response.json();
        setMuxItems(data.items);
      }
    } catch (error) {
      console.error('Failed to load Mux items:', error);
    }
  }

  async function loadCurrentStream() {
    try {
      const response = await fetch('/api/admin/set-current');
      if (response.ok) {
        const data = await response.json();
        setCurrentStream(data);
      }
    } catch (error) {
      console.error('Failed to load current stream:', error);
    }
  }

  async function loadPolls() {
    try {
      const response = await fetch('/api/admin/polls?room=event');
      if (response.ok) {
        const data = await response.json();
        setPolls(data.polls || []);
      }
    } catch (error) {
      console.error('Failed to load polls:', error);
    }
  }

  async function loadHoldScreenConfig() {
    try {
      const response = await fetch('/api/admin/hold-screen');
      if (response.ok) {
        const data = await response.json();
        setHoldScreenMuxItemId(data.hold_screen_mux_item_id);
        setHoldScreenEnabled(data.hold_screen_enabled);
      }
    } catch (error) {
      console.error('Failed to load hold screen config:', error);
    }
  }

  async function handleSetStream(
    playbackId: string,
    title: string,
    kind: string = 'vod',
    sourceType: string = MUX_SOURCE_TYPE,
    youtubePlaylistId?: string | null,
    sourceUrl?: string | null,
    completionWarning?: string
  ) {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/set-current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playbackId,
          title,
          kind,
          sourceType,
          youtubePlaylistId,
          sourceUrl,
          commandId: crypto.randomUUID(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const warning = [completionWarning, data.warning].filter(Boolean).join(' ');
        setMessage({ type: warning ? 'warning' : 'success', text: `Stream updated to: ${title}${warning ? `. ${warning}` : ''}` });
        setCurrentStream(data.stream);
        setCustomPlaybackId('');
        setCustomTitle('');
        setYoutubePlaylistUrl('');
        setYoutubePlaylistTitle('');
      } else {
        setMessage({ type: 'error', text: `${data.error || 'Failed to update stream'}${completionWarning ? `. ${completionWarning}` : ''}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Network error occurred${completionWarning ? `. ${completionWarning}` : ''}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMuxItem(makeCurrent = false) {
    if (!customPlaybackId || !customTitle) {
      setMessage({ type: 'error', text: 'Playback ID and title are required' });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/admin/mux-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playbackId: customPlaybackId,
          label: customTitle,
          kind: 'vod',
          sourceType: MUX_SOURCE_TYPE,
          durationSeconds: customDuration ? Number(customDuration) : undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        await loadMuxItems();
        setMessage({ type: data.warning ? 'warning' : 'success', text: data.warning || 'Mux item added successfully' });
        if (makeCurrent) await handleSetStream(data.item.playback_id, data.item.label, data.item.kind, MUX_SOURCE_TYPE, null, null, data.warning);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add item' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckYouTubeVideo() {
    const sourceUrl = youtubeVideoUrl.trim();
    if (!sourceUrl) return;
    setLoading(true);
    setYoutubeVideoCheckResult(null);
    try {
      const response = await fetch(`/api/admin/youtube-video?url=${encodeURIComponent(sourceUrl)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setYoutubeVideoCheckResult({ type: 'error', text: data.error || 'Could not check this YouTube video' });
        return;
      }
      if (data.metadataVerified === false) {
        setYoutubeVideoCheckResult({ type: 'warning', text: data.warning || 'YouTube verification is unavailable. Enter the exact full duration and preview captions and embedding before the show.' });
        return;
      }
      if (typeof data.durationSeconds !== 'number' || !Number.isFinite(data.durationSeconds) || data.durationSeconds <= 0) {
        setYoutubeVideoCheckResult({ type: 'error', text: 'YouTube did not return a valid duration. Enter the exact duration before adding this video.' });
        return;
      }
      setYoutubeVideoDuration(String(data.durationSeconds));
      if (typeof data.title === 'string') setYoutubeVideoTitle((previous) => previous.trim() ? previous : data.title.slice(0, 200));
      const captions = data.captionsAvailable === true
        ? 'YouTube reports captions available; the player will request them on.'
        : 'Caption availability is unverified. Auto-generated captions may still work; confirm captions in the embedded player before the show.';
      setYoutubeVideoCheckResult({
        type: data.warning || data.captionsAvailable !== true ? 'warning' : 'success',
        text: [`Duration verified: ${data.durationSeconds} seconds.`,
          data.captionsAvailable === true || !data.warning ? captions : '', data.warning || ''].filter(Boolean).join(' '),
      });
    } catch (error) {
      setYoutubeVideoCheckResult({ type: 'error', text: 'Network error while checking YouTube. Your draft has been kept.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddYouTubeVideo(makeCurrent = false) {
    const sourceUrl = youtubeVideoUrl.trim();
    const durationSeconds = youtubeVideoDuration.trim() ? Number(youtubeVideoDuration) : undefined;
    if (!sourceUrl) {
      setMessage({ type: 'error', text: 'YouTube video URL or ID is required' });
      return;
    }
    if (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
      setMessage({ type: 'error', text: 'Enter the exact video duration as a positive number of seconds' });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/mux-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: YOUTUBE_VIDEO_SOURCE_TYPE,
          sourceUrl,
          label: youtubeVideoTitle.trim() || undefined,
          durationSeconds,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.item) {
        setMessage({ type: 'error', text: data.error || 'Failed to add YouTube video' });
        return;
      }

      await loadMuxItems();
      setYoutubeVideoUrl('');
      setYoutubeVideoTitle('');
      setYoutubeVideoDuration('');
      setYoutubeVideoCheckResult(null);
      setMessage({ type: data.warning ? 'warning' : 'success', text: `YouTube video added: ${data.item.label}${data.warning ? `. ${data.warning}` : ''}` });
      if (makeCurrent) {
        await handleSetStream(
          data.item.playback_id,
          data.item.label,
          data.item.kind,
          YOUTUBE_VIDEO_SOURCE_TYPE,
          null,
          data.item.source_url,
          data.warning
        );
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAddYouTubePlaylist(makeCurrent = false) {
    if (!youtubePlaylistUrl) {
      setMessage({ type: 'error', text: 'YouTube playlist URL is required' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/mux-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: YOUTUBE_PLAYLIST_SOURCE_TYPE,
          sourceUrl: youtubePlaylistUrl,
          label: youtubePlaylistTitle || undefined,
        }),
      });
      const data = await response.json();

      if (response.ok) {
        await loadMuxItems();
        setMessage({ type: 'success', text: 'YouTube playlist added successfully' });
        setYoutubePlaylistUrl('');
        setYoutubePlaylistTitle('');

        if (makeCurrent && data.item) {
          await handleSetStream(
            data.item.playback_id,
            data.item.label,
            data.item.kind,
            data.item.source_type,
            data.item.youtube_playlist_id,
            data.item.source_url
          );
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add YouTube playlist' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMuxItem(id: string, label: string) {
    if (!confirm(`Are you sure you want to delete "${label}"? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/mux-items?id=${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        await loadMuxItems();
        setMessage({ type: 'success', text: `"${label}" deleted successfully` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete item' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSetHoldScreen(muxItemId: string, label: string) {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/hold-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_item', muxItemId }),
      });

      const data = await response.json();

      if (response.ok) {
        setHoldScreenMuxItemId(muxItemId);
        setMessage({ type: 'success', text: `Hold screen set to "${label}"` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to set hold screen' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  function addPollOption() {
    if (pollOptions.length < 5) {
      setPollOptions([...pollOptions, '']);
    }
  }

  function removePollOption(index: number) {
    if (pollOptions.length > 2) {
      setPollOptions(pollOptions.filter((_, i) => i !== index));
    }
  }

  function updatePollOption(index: number, value: string) {
    const newOptions = [...pollOptions];
    newOptions[index] = value;
    setPollOptions(newOptions);
  }

  async function handleCreatePoll() {
    const validOptions = pollOptions.filter(opt => opt.trim().length > 0);

    if (!pollQuestion.trim()) {
      setMessage({ type: 'error', text: 'Poll question is required' });
      return;
    }

    if (pollType === 'fixed' && validOptions.length < 2) {
      setMessage({ type: 'error', text: 'At least 2 options are required' });
      return;
    }

    setPollLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/polls/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: 'event',
          question: pollQuestion,
          type: pollType,
          ...(pollType === 'fixed' ? { options: validOptions } : {}),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Poll created successfully!' });
        setPollQuestion('');
        setPollOptions(['', '']);
        setPollType('fixed');
        await loadPolls();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to create poll' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setPollLoading(false);
    }
  }

  async function handleUpdatePoll(pollId: string, newQuestion: string) {
    if (!newQuestion.trim()) {
      setMessage({ type: 'error', text: 'Question cannot be empty' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/polls/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollId, question: newQuestion }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Poll updated successfully' });
        setEditingPollId(null);
        setEditingQuestion('');
        await loadPolls();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update poll' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleClosePoll(pollId: string) {
    if (!confirm('Close this poll? Results will be announced in chat.')) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/polls/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Poll closed successfully' });
        await loadPolls();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to close poll' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenPoll(pollId: string) {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/admin/polls/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollId }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Poll opened successfully' });
        await loadPolls();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to open poll' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeletePoll(pollId: string, question: string) {
    if (!confirm(`Delete poll "${question}"? This cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/polls/delete?pollId=${pollId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Poll deleted successfully' });
        await loadPolls();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete poll' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoading(false);
    }
  }

  async function loadVoterDetails(pollId: string) {
    // If already viewing this poll, toggle it off
    if (viewingVotersForPoll === pollId) {
      setViewingVotersForPoll(null);
      return;
    }

    // If we already have the data, just show it
    if (voterDetails[pollId]) {
      setViewingVotersForPoll(pollId);
      return;
    }

    setLoadingVoters(true);
    try {
      const response = await fetch(`/api/admin/polls/${pollId}/voters`);
      
      if (response.ok) {
        const data = await response.json();
        setVoterDetails(prev => ({
          ...prev,
          [pollId]: data.detailedResults,
        }));
        setViewingVotersForPoll(pollId);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || 'Failed to load voter details' });
      }
    } catch (error) {
      console.error('Failed to load voter details:', error);
      setMessage({ type: 'error', text: 'Network error occurred' });
    } finally {
      setLoadingVoters(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Playback Controls Section */}
      {showPlaybackControls && (
        <div>
          <PlaybackControls />

          {message && (
            <div role="status" className={`rounded p-4 mb-4 ${messageClass(message.type)}`}>
              {message.text}
            </div>
          )}
        </div>
      )}

      {/* Library Controls Section */}
      {showLibraryControls && (
        <>
          {message && <p role="status" className={`rounded p-3 text-sm ${messageClass(message.type)}`}>{message.text}</p>}
          <div>
            <h3 className="text-lg font-semibold mb-3 text-twitch-text">Manage source videos</h3>
            <label className="block text-sm font-medium mb-4">Search media library
              <input type="search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} className="twitch-input w-full mt-2" placeholder="Find a video by title…" />
            </label>
            {muxItems.length === 0 ? (
              <p className="text-twitch-text-alt text-sm">No media items available. Add one below.</p>
            ) : (
              <div className="operator-media-list">
                {!muxItems.some(item => item.label.toLowerCase().includes(librarySearch.trim().toLowerCase())) && <p className="py-4 text-sm">No videos match “{librarySearch}”.</p>}
                {muxItems.filter(item => item.label.toLowerCase().includes(librarySearch.trim().toLowerCase())).map(item => {
                  const sourceType = item.source_type || MUX_SOURCE_TYPE;
                  const duration = Number(item.duration_seconds);
                  return (
                    <div key={item.id} className="operator-media-item">
                      <div className="operator-media-row">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-medium text-twitch-text break-words">{item.label}</p>
                            <span className="text-xs font-semibold px-2 py-1 rounded bg-twitch-purple/20 text-twitch-purple">
                              {mediaSourceLabel(sourceType)}
                            </span>
                            {holdScreenMuxItemId === item.id && (
                              <span className="text-xs font-semibold px-2 py-1 rounded bg-yellow-500/20 text-yellow-500 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                </svg>
                                Hold Screen
                              </span>
                            )}
                          </div>
                          {Number.isFinite(duration) && duration > 0 && (
                            <p className="text-xs text-twitch-text-alt">
                              Duration: {formatDuration(duration)}
                            </p>
                          )}
                          <details className="operator-source-details">
                            <summary>Source details</summary>
                          <p className="text-xs text-twitch-text-alt font-mono break-all">{item.playback_id}</p>
                          {item.source_url && (
                            <p className="text-xs text-twitch-text-alt break-all mt-1">{item.source_url}</p>
                          )}
                          </details>
                        </div>
                        <div className="operator-media-actions">
                          <button
                            onClick={() => handleSetStream(
                              item.playback_id,
                              item.label,
                              item.kind,
                              sourceType,
                              item.youtube_playlist_id,
                              item.source_url
                            )}
                            disabled={loading || currentStream?.playback_id === item.playback_id}
                            className={`px-4 py-2 rounded text-sm transition-colors min-h-[44px] ${
                              currentStream?.playback_id === item.playback_id
                                ? 'bg-twitch-hover text-twitch-text-alt cursor-not-allowed'
                                : 'twitch-button-secondary'
                            }`}
                          >
                            {currentStream?.playback_id === item.playback_id ? 'Current' : 'Make Current'}
                          </button>
                          <button
                            onClick={() => handleSetHoldScreen(item.id, item.label)}
                            disabled={loading || holdScreenMuxItemId === item.id}
                            className={`px-4 py-2 rounded text-sm transition-colors min-h-[44px] ${
                              holdScreenMuxItemId === item.id
                                ? 'bg-yellow-500/20 text-yellow-500 cursor-not-allowed border border-yellow-500'
                                : 'twitch-button-secondary'
                            }`}
                            title="Set this as the hold screen video"
                          >
                            {holdScreenMuxItemId === item.id ? '★ Hold Screen' : 'Set Hold Screen'}
                          </button>
                          <button
                            onClick={() => handleDeleteMuxItem(item.id, item.label)}
                            disabled={loading}
                            className="operator-delete px-4 py-2 rounded text-sm min-h-[44px]"
                            title="Delete this item from library"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="twitch-card p-4">
            <h3 className="text-lg font-semibold mb-3 text-twitch-text">Add New Mux Item</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-twitch-text mb-2">
                  Playback ID
                </label>
                <input
                  type="text"
                  value={customPlaybackId}
                  onChange={(e) => setCustomPlaybackId(e.target.value)}
                  className="twitch-input w-full"
                  placeholder="e.g., abc123xyz456"
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-twitch-text mb-2">
                  Title/Label
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="twitch-input w-full"
                  placeholder="e.g., Opening Segment"
                  disabled={loading}
                />
              </div>
              <label className="block text-sm font-medium text-twitch-text">
                Exact video duration (seconds)
                <input type="number" min="0.001" step="any" value={customDuration}
                  onChange={(event) => setCustomDuration(event.target.value)}
                  className="twitch-input w-full mt-2" placeholder="e.g., 212.48" disabled={loading} />
                <span className="block text-xs text-twitch-text-alt mt-1">Fetched from Mux when connected. Otherwise enter the full duration for automatic queue playback.</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => handleAddMuxItem()}
                  disabled={loading || !customPlaybackId || !customTitle}
                  className="twitch-button-secondary disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                >
                  Add to Library
                </button>
                <button
                  onClick={() => {
                    if (customPlaybackId && customTitle) {
                      handleAddMuxItem(true);
                    }
                  }}
                  disabled={loading || !customPlaybackId || !customTitle}
                  className="twitch-button disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                >
                  Add & Make Current
                </button>
              </div>
            </div>
          </div>

          <form className="twitch-card p-4" onSubmit={(event) => { event.preventDefault(); void handleAddYouTubeVideo(); }}>
            <h3 className="text-lg font-semibold mb-2 text-twitch-text">Add YouTube Video</h3>
            <p className="text-sm text-twitch-text-alt mb-4">
              One video, in the same timed queue as Mux assets. Captions are requested on by default when the video has them.
            </p>
            <div className="space-y-3">
              <div>
                <label htmlFor={`${videoFormId}-url`} className="block text-sm font-medium text-twitch-text mb-2">Video URL or ID</label>
                <input id={`${videoFormId}-url`} type="text" value={youtubeVideoUrl}
                  onChange={(event) => { setYoutubeVideoUrl(event.target.value); setYoutubeVideoCheckResult(null); }}
                  className="twitch-input w-full min-h-[44px]" placeholder="https://www.youtube.com/watch?v=..." required maxLength={2048} disabled={loading} />
                <button type="button" onClick={() => void handleCheckYouTubeVideo()} disabled={loading || !youtubeVideoUrl.trim()}
                  className="twitch-button-secondary mt-2 disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]">Check Video</button>
                <p className="text-xs text-twitch-text-alt mt-1">Read-only check: fills the title and duration, and reports captions and embedding availability. Does not add or start the video.</p>
              </div>
              {youtubeVideoCheckResult && <p role="status" className={`rounded p-3 text-sm ${messageClass(youtubeVideoCheckResult.type)}`}>{youtubeVideoCheckResult.text}</p>}
              <div>
                <label htmlFor={`${videoFormId}-title`} className="block text-sm font-medium text-twitch-text mb-2">Title / label (optional)</label>
                <input id={`${videoFormId}-title`} type="text" value={youtubeVideoTitle}
                  onChange={(event) => setYoutubeVideoTitle(event.target.value)}
                  className="twitch-input w-full min-h-[44px]" placeholder="e.g., TRL winner" maxLength={200} disabled={loading} />
              </div>
              <div>
                <label htmlFor={`${videoFormId}-duration`} className="block text-sm font-medium text-twitch-text mb-2">Exact video duration (seconds)</label>
                <input id={`${videoFormId}-duration`} type="number" min="0.001" step="any" value={youtubeVideoDuration}
                  onChange={(event) => setYoutubeVideoDuration(event.target.value)} aria-describedby={`${videoFormId}-duration-help`}
                  className="twitch-input w-full min-h-[44px]" placeholder="e.g., 213.5" disabled={loading} />
                <p id={`${videoFormId}-duration-help`} className="text-xs text-twitch-text-alt mt-1">
                  Fetched from YouTube when connected. Otherwise enter the full duration; the server uses it to advance the queue.
                </p>
              </div>
              <p className="text-xs text-twitch-text-alt">
                Preview each video before the show. Missing captions, ads, regional restrictions, and embedding restrictions can make YouTube less predictable than Mux.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="submit" disabled={loading || !youtubeVideoUrl.trim()}
                  className="twitch-button-secondary disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]">Add to Library</button>
                <button type="button" onClick={() => void handleAddYouTubeVideo(true)} disabled={loading || !youtubeVideoUrl.trim()}
                  className="twitch-button disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]">Add &amp; Make Current</button>
              </div>
            </div>
          </form>

          <div className="twitch-card p-4">
            <h3 className="text-lg font-semibold mb-3 text-twitch-text">Add YouTube Playlist</h3>
            <p className="text-xs text-twitch-text-alt mb-3">Ambient hold only: each viewer runs their own playlist. Use a single YouTube video or Mux asset for the synchronized queue.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-twitch-text mb-2">
                  Playlist URL
                </label>
                <input
                  type="url"
                  value={youtubePlaylistUrl}
                  onChange={(e) => setYoutubePlaylistUrl(e.target.value)}
                  className="twitch-input w-full"
                  placeholder="https://www.youtube.com/playlist?list=..."
                  disabled={loading}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-twitch-text mb-2">
                  Title/Label
                </label>
                <input
                  type="text"
                  value={youtubePlaylistTitle}
                  onChange={(e) => setYoutubePlaylistTitle(e.target.value)}
                  className="twitch-input w-full"
                  placeholder="e.g., Late Night Clips"
                  disabled={loading}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => handleAddYouTubePlaylist(false)}
                  disabled={loading || !youtubePlaylistUrl}
                  className="twitch-button-secondary disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                >
                  Add to Library
                </button>
                <button
                  onClick={() => handleAddYouTubePlaylist(true)}
                  disabled={loading || !youtubePlaylistUrl}
                  className="twitch-button disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                >
                  Add & Make Current
                </button>
              </div>
            </div>
          </div>

          <div className="twitch-card p-4 border-t border-twitch-purple">
            <h3 className="text-lg font-semibold mb-3 text-twitch-text">Poll Management</h3>
            
            {/* Create Poll Section */}
            <div className="mb-6 p-4 bg-twitch-darker rounded-lg border border-twitch-border">
              <h4 className="text-md font-semibold mb-3 text-twitch-purple">Create New Poll</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-twitch-text mb-2">
                    Poll Question
                  </label>
                  <input
                    type="text"
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    className="twitch-input w-full"
                    placeholder="e.g., What should we watch next?"
                    disabled={pollLoading}
                    maxLength={300}
                  />
                  <p className="text-xs text-twitch-text-alt mt-1">{pollQuestion.length}/300</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-twitch-text mb-2">
                    Poll Type
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPollType('fixed')}
                      disabled={pollLoading}
                      className={`flex-1 px-3 py-2 rounded border min-h-[44px] transition-colors ${
                        pollType === 'fixed'
                          ? 'bg-twitch-purple text-white border-twitch-purple'
                          : 'bg-transparent text-twitch-text border-twitch-border'
                      }`}
                    >
                      Fixed choices
                    </button>
                    <button
                      type="button"
                      onClick={() => setPollType('open')}
                      disabled={pollLoading}
                      className={`flex-1 px-3 py-2 rounded border min-h-[44px] transition-colors ${
                        pollType === 'open'
                          ? 'bg-twitch-purple text-white border-twitch-purple'
                          : 'bg-transparent text-twitch-text border-twitch-border'
                      }`}
                    >
                      Open answers
                    </button>
                  </div>
                  <p className="text-xs text-twitch-text-alt mt-1">
                    {pollType === 'fixed'
                      ? 'You pick the answer choices up front.'
                      : "Viewers type their own answers, then vote on each other's — no answer choices to set up here."}
                  </p>
                </div>

                {pollType === 'fixed' && (
                  <div>
                    <label className="block text-sm font-medium text-twitch-text mb-2">
                      Options (2-5)
                    </label>
                    <div className="space-y-2">
                      {pollOptions.map((option, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            type="text"
                            value={option}
                            onChange={(e) => updatePollOption(index, e.target.value)}
                            className="twitch-input flex-1"
                            placeholder={`Option ${index + 1}`}
                            disabled={pollLoading}
                            maxLength={280}
                          />
                          {pollOptions.length > 2 && (
                            <button
                              onClick={() => removePollOption(index)}
                              disabled={pollLoading}
                              className="px-3 py-2 bg-error hover:bg-red-600 disabled:bg-twitch-gray disabled:cursor-not-allowed rounded transition-colors text-white min-h-[44px]"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {pollOptions.length < 5 && (
                      <button
                        onClick={addPollOption}
                        disabled={pollLoading}
                        className="mt-2 text-sm text-twitch-purple hover:text-purple-400 disabled:text-twitch-text-alt"
                      >
                        + Add Option
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={handleCreatePoll}
                  disabled={pollLoading || !pollQuestion.trim() || (pollType === 'fixed' && pollOptions.filter(o => o.trim()).length < 2)}
                  className="w-full twitch-button disabled:bg-twitch-gray disabled:cursor-not-allowed font-medium min-h-[44px]"
                >
                  {pollLoading ? 'Creating Poll...' : 'Create Poll in Chat'}
                </button>
              </div>
            </div>

            {/* Manage Existing Polls */}
            <div>
              <h4 className="text-md font-semibold mb-3 text-twitch-purple">Manage Existing Polls</h4>
              {polls.length === 0 ? (
                <p className="text-twitch-text-alt text-sm text-center py-4">No polls yet. Create one above!</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {polls.map((poll) => {
                    const isEditing = editingPollId === poll.id;
                    const maxVotes = poll.options.length > 0 ? Math.max(...poll.options.map(o => o.vote_count)) : 0;
                    const winners = poll.options.filter(o => o.vote_count === maxVotes);
                    
                    return (
                      <div key={poll.id} className={`twitch-card p-4 ${poll.is_open ? 'border-l-4 border-twitch-purple' : 'border-l-4 border-success opacity-75'}`}>
                        {/* Poll Header */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs font-semibold px-2 py-1 rounded ${poll.is_open ? 'bg-twitch-purple/20 text-twitch-purple' : 'bg-success/20 text-success'}`}>
                                {poll.is_open ? 'OPEN' : 'CLOSED'}
                              </span>
                              {poll.type === 'open' && (
                                <span className="text-xs font-semibold px-2 py-1 rounded bg-casual-indigo/40 text-twitch-text">
                                  OPEN ANSWERS
                                </span>
                              )}
                              <span className="text-xs text-twitch-text-alt">
                                {poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'}
                              </span>
                            </div>
                            
                            {isEditing ? (
                              <div className="flex flex-col sm:flex-row gap-2 mt-2">
                                <input
                                  type="text"
                                  value={editingQuestion}
                                  onChange={(e) => setEditingQuestion(e.target.value)}
                                  className="twitch-input flex-1 text-sm min-h-[44px]"
                                  maxLength={300}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleUpdatePoll(poll.id, editingQuestion)}
                                    disabled={loading}
                                    className="px-3 py-2 bg-success hover:bg-green-600 rounded text-sm text-white flex-1 sm:flex-none min-h-[44px]"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingPollId(null);
                                      setEditingQuestion('');
                                    }}
                                    className="px-3 py-2 bg-twitch-gray hover:bg-twitch-hover rounded text-sm flex-1 sm:flex-none min-h-[44px]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm font-medium text-twitch-text">{poll.question}</p>
                            )}
                          </div>
                        </div>

                        {/* Poll Results Summary */}
                        {!poll.is_open && poll.total_votes > 0 && (
                          <div className="mb-2 p-2 bg-success/10 rounded text-xs text-success">
                            <span className="font-semibold">Winner{winners.length > 1 ? 's' : ''}:</span> {winners.map(w => `${w.label} (${w.percentage}%)`).join(', ')}
                          </div>
                        )}

                        {/* Poll Options */}
                        <div className="space-y-1 mb-3">
                          {poll.options.length === 0 && poll.type === 'open' && (
                            <p className="text-xs text-twitch-text-alt italic">No answers submitted yet.</p>
                          )}
                          {poll.options.map((option) => (
                            <div key={option.id} className="flex items-center justify-between text-xs gap-2">
                              <span className="text-twitch-text">
                                {option.label}
                                {poll.type === 'open' && option.author_name && (
                                  <span className="text-twitch-text-alt"> — {option.author_name}</span>
                                )}
                              </span>
                              <span className="text-twitch-text-alt ml-2 flex-shrink-0">
                                {option.vote_count} ({option.percentage}%)
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-twitch-border">
                          {poll.is_open && !isEditing && (
                            <button
                              onClick={() => {
                                setEditingPollId(poll.id);
                                setEditingQuestion(poll.question);
                              }}
                              disabled={loading}
                              className="px-3 py-2 text-xs bg-twitch-purple hover:bg-purple-600 rounded transition-colors text-white disabled:bg-twitch-gray min-h-[44px]"
                            >
                              Edit Question
                            </button>
                          )}
                          {poll.is_open && (
                            <button
                              onClick={() => handleClosePoll(poll.id)}
                              disabled={loading}
                              className="px-3 py-2 text-xs bg-twitch-gray hover:bg-twitch-hover rounded transition-colors disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                            >
                              Close Poll
                            </button>
                          )}
                          {!poll.is_open && (
                            <button
                              onClick={() => handleOpenPoll(poll.id)}
                              disabled={loading}
                              className="px-3 py-2 text-xs bg-success hover:bg-green-600 rounded transition-colors text-white disabled:bg-twitch-gray disabled:cursor-not-allowed min-h-[44px]"
                            >
                              Open Poll
                            </button>
                          )}
                          {!poll.is_open && poll.total_votes > 0 && (
                            <button
                              onClick={() => loadVoterDetails(poll.id)}
                              disabled={loadingVoters}
                              className="px-3 py-2 text-xs bg-twitch-purple hover:bg-purple-600 rounded transition-colors text-white disabled:bg-twitch-gray min-h-[44px]"
                            >
                              {viewingVotersForPoll === poll.id ? 'Hide Voters' : 'View Voters'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeletePoll(poll.id, poll.question)}
                            disabled={loading}
                            className="px-3 py-2 text-xs bg-error hover:bg-red-600 rounded transition-colors text-white disabled:bg-twitch-gray disabled:cursor-not-allowed sm:ml-auto min-h-[44px]"
                          >
                            Delete
                          </button>
                        </div>

                        {/* Voter Details */}
                        {!poll.is_open && viewingVotersForPoll === poll.id && voterDetails[poll.id] && (
                          <div className="mt-3 p-3 bg-twitch-dark rounded border border-twitch-border">
                            <h5 className="text-xs font-semibold text-twitch-purple mb-2 uppercase tracking-wider">
                              Voter Breakdown
                            </h5>
                            <div className="space-y-3">
                              {voterDetails[poll.id].map((result) => (
                                <div key={result.option_id} className="border-l-2 border-twitch-purple pl-2">
                                  <div className="text-xs font-medium text-twitch-text mb-1">
                                    {result.option_label} ({result.vote_count} {result.vote_count === 1 ? 'vote' : 'votes'})
                                  </div>
                                  {result.voters.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {result.voters.map((voter, index) => (
                                        <span
                                          key={index}
                                          className="text-xs px-2 py-1 bg-twitch-hover rounded text-twitch-text-alt"
                                        >
                                          {voter}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-twitch-text-alt italic">No votes</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
