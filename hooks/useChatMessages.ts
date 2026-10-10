'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { CHANNEL_NAMES, DATABASE_TABLES } from '@/lib/constants';
import {
  applyChatMessage,
  reconcileChatMessages,
  removeChatMessage,
  type ChatMessage,
} from '@/lib/chat-message-state';

export type ChatConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
const FALLBACK_REFRESH_MS = 3_000;
const LIVE_REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 12_000;

type Session = {
  refresh: () => Promise<void>;
  accept: (message: ChatMessage) => void;
  remove: (id: number) => void;
};

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as ChatMessage;
  return Number.isSafeInteger(message.id) && message.id > 0 &&
    typeof message.user_id === 'string' && typeof message.user_name === 'string' &&
    typeof message.body === 'string' && typeof message.created_at === 'string' &&
    ['user', 'system', 'poll'].includes(message.kind);
}

/** HTTP is the authoritative history; realtime is a low-latency accelerator.
 * Each room/viewer lifecycle owns its requests, timers and event journal. */
export function useChatMessages(room: string, userId: string) {
  const instanceId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<ChatConnectionStatus>('connecting');
  const [syncError, setSyncError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const channelGenerationRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);

  const refresh = useCallback(() => sessionRef.current?.refresh() ?? Promise.resolve(), []);
  const acceptMessage = useCallback((message: ChatMessage) => sessionRef.current?.accept(message), []);
  const updateMessage = useCallback((id: number, patch: Partial<ChatMessage>) => {
    const current = messagesRef.current.find((message) => message.id === id);
    if (current) sessionRef.current?.accept({ ...current, ...patch, id });
  }, []);

  useEffect(() => {
    let active = true;
    let joined = false;
    let httpHealthy = false;
    let firstLoad = true;
    let revision = 0;
    let request: Promise<void> | null = null;
    let controller: AbortController | null = null;
    let refreshAgain = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const changes = new Map<number, { revision: number; message: ChatMessage | null; id: number }>();
    const deletedIds = new Set<number>();
    const isOnline = () => navigator.onLine !== false;
    const publish = (next: ChatMessage[]) => {
      if (!active) return;
      messagesRef.current = next;
      setMessages(next);
    };
    const updateStatus = () => {
      if (!active) return;
      setConnectionStatus(!isOnline() ? 'offline' : httpHealthy
        ? (joined ? 'live' : 'reconnecting') : (firstLoad ? 'connecting' : 'offline'));
    };
    publish([]);
    setLoading(true);
    setSyncError(null);
    updateStatus();

    const session: Session = {
      refresh: () => {
        if (!active) return Promise.resolve();
        if (request) {
          // Collapse simultaneous resume/reaction/rejoin events into one retry.
          refreshAgain = true;
          return request;
        }
        const startedAtRevision = revision;
        const abort = new AbortController();
        controller = abort;
        const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
        request = (async () => {
          try {
            const params = new URLSearchParams({ room, userId, limit: '100' });
            const response = await fetch(`/api/chat/messages?${params}`, {
              cache: 'no-store', signal: abort.signal,
            });
            if (!response.ok) throw new Error('Chat history unavailable');
            const data = await response.json();
            if (!Array.isArray(data.messages) || !data.messages.every(isChatMessage)) {
              throw new Error('Invalid chat history');
            }
            if (!active) return;
            if (abort.signal.aborted) throw new Error('Chat request timed out');
            // Only events received DURING this fetch overlay its snapshot.
            // Old missing rows are deleted, never inferred to be "newer".
            publish(reconcileChatMessages(data.messages.filter((message: ChatMessage) => !deletedIds.has(message.id)),
              [...changes.values()].filter((change) => change.revision > startedAtRevision)));
            for (const [id, change] of changes) {
              if (change.revision <= startedAtRevision) changes.delete(id);
            }
            httpHealthy = true;
            setSyncError(null);
          } catch {
            if (!active) return;
            httpHealthy = false;
            // Keep the real history on screen; do not replace it with fake rows.
            setSyncError('Chat is reconnecting. Your messages are still here; new messages will catch up when the connection returns.');
          } finally {
            clearTimeout(timeout);
            if (active) {
              firstLoad = false;
              setLoading(false);
              updateStatus();
              controller = null;
              request = null;
              if (refreshAgain) {
                refreshAgain = false;
                void session.refresh();
              }
            }
          }
        })();
        return request;
      },
      accept: (message) => {
        if (!active || !isChatMessage(message) || (message.room && message.room !== room)) return;
        if (message.deleted_at) deletedIds.add(message.id);
        else if (deletedIds.has(message.id)) return;
        const next = applyChatMessage(messagesRef.current, message);
        // Keep the merged row in the journal: a raw realtime echo omits
        // reactions and must not undo a local reaction during an older fetch.
        changes.set(message.id, {
          id: message.id, revision: ++revision,
          message: next.find((item) => item.id === message.id) ?? message,
        });
        publish(next);
      },
      remove: (id) => {
        if (!active || !Number.isSafeInteger(id)) return;
        // Unfiltered DELETEs for other rooms need not allocate tombstones.
        if (!messagesRef.current.some((message) => message.id === id) && !request) return;
        deletedIds.add(id);
        changes.set(id, { id, revision: ++revision, message: null });
        publish(removeChatMessage(messagesRef.current, id));
      },
    };
    sessionRef.current = session;

    const scheduleRefresh = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (!active) return;
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        if (document.visibilityState !== 'hidden' && isOnline()) await session.refresh();
        scheduleRefresh();
      }, joined && httpHealthy ? LIVE_REFRESH_MS : FALLBACK_REFRESH_MS);
    };
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      updateStatus();
      void session.refresh();
      scheduleRefresh();
    };
    const offline = () => {
      joined = false;
      updateStatus();
    };

    // Instance-specific topics prevent one mounted chat's cleanup from removing
    // another chat's channel. DELETE cannot use a room filter in Postgres Changes.
    const channel = supabase.channel(`${CHANNEL_NAMES.CHAT_ROOM(room)}:${instanceId}:${++channelGenerationRef.current}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: DATABASE_TABLES.MESSAGES, filter: `room=eq.${room}` },
        (payload) => session.accept(payload.new as ChatMessage))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: DATABASE_TABLES.MESSAGES, filter: `room=eq.${room}` },
        (payload) => session.accept(payload.new as ChatMessage))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: DATABASE_TABLES.MESSAGES },
        (payload) => session.remove(Number(payload.old.id)))
      .on('postgres_changes', { event: '*', schema: 'public', table: DATABASE_TABLES.MESSAGE_REACTIONS },
        () => { if (active) void session.refresh(); })
      .subscribe((status) => {
        if (!active) return;
        joined = status === 'SUBSCRIBED';
        updateStatus();
        if (joined) void session.refresh();
        scheduleRefresh();
      });

    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    void session.refresh();
    scheduleRefresh();

    return () => {
      active = false;
      if (sessionRef.current === session) sessionRef.current = null;
      controller?.abort();
      if (pollTimer !== null) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      void supabase.removeChannel(channel);
    };
  }, [room, userId, instanceId]);

  return { messages, loading, connectionStatus, syncError, refresh, acceptMessage, updateMessage };
}
