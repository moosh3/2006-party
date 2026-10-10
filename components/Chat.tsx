'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getViewerData } from '@/lib/viewer';
import { useChatMessages } from '@/hooks/useChatMessages';
import type { ChatMessage as Message } from '@/lib/chat-message-state';
import PollCard from './PollCard';
import AimWindow from './aim/AimWindow';
import {
  ROOM_NAMES,
  CHANNEL_NAMES,
  CHAT_SLOWMODE_SECONDS,
  MAX_MESSAGE_LENGTH,
} from '@/lib/constants';
import {
  MESSAGE_REACTIONS,
  REACTION_GLYPH,
  REACTION_LABEL,
  type MessageReaction,
} from '@/lib/reactions';

interface ChatProps {
  room?: string;
  userId: string;
  screenName?: string;
  embedded?: boolean;
}

export default function Chat({ room = ROOM_NAMES.DEFAULT, userId, screenName, embedded = false }: ChatProps) {
  const { messages, loading, connectionStatus, syncError, refresh, acceptMessage, updateMessage } = useChatMessages(room, userId);
  const [messageBody, setMessageBody] = useState('');
  const [userName, setUserName] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<number | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const actionGenerationRef = useRef(0);

  useEffect(() => {
    const generation = actionGenerationRef.current + 1;
    actionGenerationRef.current = generation;
    setMessageBody('');
    setSending(false);
    setReactingMessageId(null);
    setActiveReactionMessageId(null);
    setRateLimitSeconds(0);
    setError(null);
    setAutoScroll(true);
    return () => { actionGenerationRef.current = generation + 1; };
  }, [room, userId]);

  // Load user name from viewer registration data
  useEffect(() => {
    if (screenName) { setUserName(screenName); return; }
    const viewerData = getViewerData();
    if (viewerData?.displayName) {
      setUserName(viewerData.displayName);
    } else {
      // Fallback for guests who haven't registered
      setUserName('Guest');
    }
  }, [screenName]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startLongPress = useCallback((messageId: number) => {
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      setActiveReactionMessageId(messageId);
      longPressTimerRef.current = null;
    }, 500);
  }, [clearLongPressTimer]);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  // Auto-scroll to bottom. Scroll only the messages container —
  // scrollIntoView also scrolls ancestor containers, which yanks the
  // mobile video/chat layout on every incoming message.
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (autoScroll) {
      scrollToBottom();
    }
  }, [messages, autoScroll, scrollToBottom]);

  // Detect manual scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isAtBottom = 
        container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
      setAutoScroll(isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading]);

  // Rate limit countdown
  useEffect(() => {
    if (rateLimitSeconds <= 0) return;

    const interval = setInterval(() => {
      setRateLimitSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [rateLimitSeconds]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!messageBody.trim() || sending || rateLimitSeconds > 0) return;

    setSending(true);
    setError(null);
    const generation = actionGenerationRef.current;

    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          userName,
          body: messageBody.trim(),
          userId,
        }),
      });

      const data = await response.json();
      if (generation !== actionGenerationRef.current) return;

      if (response.status === 429) {
        const match = data.error.match(/(\d+) seconds/);
        if (match) {
          setRateLimitSeconds(parseInt(match[1]));
        }
        setError(data.error);
      } else if (!response.ok) {
        setError(data.error || 'Failed to send message');
      } else {
        // The server-confirmed row is visible even if the realtime socket died.
        // Realtime/fetch echoes share the same database ID and are deduplicated.
        if (data.message) acceptMessage(data.message);
        void refresh();
        if (/easter/i.test(messageBody)) {
          supabase.channel(CHANNEL_NAMES.EASTER_EGGS).send({
            type: 'broadcast',
            event: 'trigger',
            payload: {},
          });
        }
        setMessageBody('');
        setRateLimitSeconds(CHAT_SLOWMODE_SECONDS);
      }
    } catch (err) {
      if (generation === actionGenerationRef.current) setError('Network error. Please try again.');
    } finally {
      if (generation === actionGenerationRef.current) setSending(false);
    }
  }

  async function handleReactionToggle(message: Message, reaction: MessageReaction) {
    if (reactingMessageId) return;

    setReactingMessageId(message.id);
    setError(null);
    const generation = actionGenerationRef.current;

    try {
      const response = await fetch('/api/chat/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          userId,
          userName,
          reaction,
        }),
      });

      const data = await response.json();
      if (generation !== actionGenerationRef.current) return;

      if (!response.ok) {
        setError(data.error || 'Failed to react');
        return;
      }

      updateMessage(message.id, {
        reactions: data.reactions || [],
        viewerReaction: data.viewerReaction || null,
      });
      setActiveReactionMessageId(null);
    } catch (err) {
      if (generation === actionGenerationRef.current) setError('Network error. Please try again.');
    } finally {
      if (generation === actionGenerationRef.current) setReactingMessageId(null);
    }
  }

  function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  }

  function getUsernameColor(name: string): string {
    // Casual warm username colors
    const colors = [
      '#fbbf24', '#f472b6', '#a78bfa', '#60a5fa', '#34d399',
      '#f97316', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981',
      '#f59e0b', '#d946ef', '#7c3aed', '#0ea5e9', '#14b8a6',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  if (loading) {
    if (embedded) {
      return <div className="aim-chat-loading">Connecting to the room…</div>;
    }

    return (
      <AimWindow title="Chat Room: 2006" className="aim-chat-window" menuItems={['File', 'Edit', 'People', 'Help']} status="connecting…">
        <div className="aim-chat-loading">Connecting to the room…</div>
      </AimWindow>
    );
  }

  const chatContent = (
    <>
      <div className="aim-chat-room-heading">
        <strong>2006ers</strong>
        <span>Live audience chat</span>
      </div>

      <div
        ref={messagesContainerRef}
        className="aim-chat-log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="aim-chat-auto">The room is quiet. Say hello when you&apos;re ready.</div>
        ) : (
          messages.map((message) => {
            if (message.kind === 'poll') {
              return (
                <div key={message.id} className="aim-chat-poll">
                  <PollCard 
                    pollId={message.body} 
                    userId={userId} 
                    room={room} 
                  />
                </div>
              );
            }

            if (message.kind === 'system') {
              return (
                <div key={message.id} className="aim-chat-auto">
                  {message.body}
                </div>
              );
            }

            const userColor = getUsernameColor(message.user_name);
            return (
              <div
                key={message.id}
                className="aim-chat-message"
                style={{ zIndex: activeReactionMessageId === message.id ? 20 : 'auto' }}
                title={formatTimestamp(message.created_at)}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  startLongPress(message.id);
                }}
                onPointerUp={clearLongPressTimer}
                onPointerCancel={clearLongPressTimer}
                onPointerLeave={clearLongPressTimer}
                onContextMenu={(event) => {
                  event.preventDefault();
                  clearLongPressTimer();
                  setActiveReactionMessageId(message.id);
                }}
              >
                <div className="aim-chat-line">
                  <span
                    className="aim-chat-screen-name"
                    style={{ color: userColor }}
                  >
                    {message.user_name}:
                  </span>
                  <span className="aim-chat-body">{message.body}</span>
                </div>
                {message.reactions && message.reactions.length > 0 && (
                  <div className="aim-chat-reactions">
                    {message.reactions.map((reaction) => (
                      <button
                        key={reaction.reaction}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleReactionToggle(message, reaction.reaction);
                        }}
                        className="aim-chat-reaction"
                        style={{
                          background: reaction.viewerReacted ? '#dce8f8' : '#fff',
                        }}
                        aria-label={`${REACTION_LABEL[reaction.reaction]} reaction, ${reaction.count}`}
                        disabled={reactingMessageId === message.id}
                      >
                        {REACTION_GLYPH[reaction.reaction]} {reaction.count}
                      </button>
                    ))}
                  </div>
                )}
                {activeReactionMessageId === message.id && (
                  <div
                    className="aim-chat-reaction-menu"
                    role="menu"
                    aria-label="React to message"
                  >
                    {MESSAGE_REACTIONS.map((reaction) => (
                      <button
                        key={reaction}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleReactionToggle(message, reaction);
                        }}
                        className="aim-chat-reaction-choice"
                        style={{
                          background: message.viewerReaction === reaction ? '#dce8f8' : 'transparent',
                        }}
                        title={REACTION_LABEL[reaction]}
                        aria-label={REACTION_LABEL[reaction]}
                        disabled={reactingMessageId === message.id}
                      >
                        {REACTION_GLYPH[reaction]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {!autoScroll && (
        <div className="aim-chat-more">
          <button
            type="button"
            onClick={() => {
              scrollToBottom();
              setAutoScroll(true);
            }}
            className="aim-xp-button"
          >
            More messages below
          </button>
        </div>
      )}

      <div className="aim-chat-compose">
        {syncError && (
          <div className="aim-chat-error" role="status">
            {syncError} <button type="button" className="aim-xp-button" onClick={() => void refresh()}>Retry connection</button>
          </div>
        )}
        {error && (
          <div className="aim-chat-error" role="alert">{error}</div>
        )}

        {rateLimitSeconds > 0 && (
          <div className="aim-chat-slowmode">
            Slow mode: {rateLimitSeconds}s
          </div>
        )}

        <form onSubmit={handleSend}>
          <div className="aim-chat-tools" aria-hidden="true">
            <span className="aim-chat-format aim-chat-format-bold">A</span>
            <span className="aim-chat-format aim-chat-format-italic">A</span>
            <span className="aim-chat-format aim-chat-format-underline">A</span>
          </div>
          <textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="type ur message..."
            aria-label="Message the audience"
            className="aim-chat-entry"
            disabled={sending || rateLimitSeconds > 0}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
          />
          <div className="aim-chat-actions">
            <span>Chatting as <strong>{userName}</strong></span>
            <button
              type="submit"
              className="aim-xp-button aim-xp-button-primary"
              disabled={sending || rateLimitSeconds > 0 || !messageBody.trim()}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="aim-chat-window aim-chat-window-embedded">
        {chatContent}
        <div className="mac2006-aim-status" role="status" data-connection={connectionStatus}>
          <span aria-hidden="true" />
          {connectionStatus === 'live' ? 'Online' : connectionStatus === 'offline' ? 'Offline · retrying' : connectionStatus === 'connecting' ? 'Connecting…' : 'Reconnecting · chat refreshes automatically'}
        </div>
      </div>
    );
  }

  return (
    <AimWindow
      title="Chat Room: 2006"
      className="aim-chat-window"
      menuItems={['File', 'Edit', 'People', 'Help']}
      status={`${connectionStatus === 'live' ? 'Online' : connectionStatus === 'offline' ? 'Offline · retrying' : connectionStatus === 'connecting' ? 'Connecting…' : 'Reconnecting'} · ${messages.length} message${messages.length === 1 ? '' : 's'} in the room`}
      live={connectionStatus === 'live'}
    >
      {chatContent}
    </AimWindow>
  );
}
