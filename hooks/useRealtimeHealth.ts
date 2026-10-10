import { useEffect, useState, useRef, useCallback, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { CHANNEL_NAMES, REALTIME_CONFIG } from '@/lib/constants';

export type RealtimeHealthStatus = 'healthy' | 'degraded' | 'offline';

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const BASE_HEARTBEAT_INTERVAL = REALTIME_CONFIG.HEARTBEAT_CHECK_INTERVAL_MS;
const DEGRADED_THRESHOLD_MS = REALTIME_CONFIG.DEGRADED_THRESHOLD_MS;
const OFFLINE_THRESHOLD_MS = REALTIME_CONFIG.OFFLINE_THRESHOLD_MS;
const PRESENCE_UPDATE_INTERVAL = REALTIME_CONFIG.PRESENCE_UPDATE_INTERVAL_MS;

interface UseRealtimeHealthOptions {
  onStatusChange?: (status: RealtimeHealthStatus) => void;
  enabled?: boolean;
}

export function useRealtimeHealth(options: UseRealtimeHealthOptions = {}) {
  const { onStatusChange, enabled = true } = options;
  const monitorId = useId();
  const [status, setStatus] = useState<RealtimeHealthStatus>('healthy');
  const onStatusChangeRef = useRef(onStatusChange);
  const channelGenerationRef = useRef(0);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const subscribeRef = useRef<(() => void) | null>(null);
  const statusRef = useRef<RealtimeHealthStatus>('healthy');
  const channelJoinedRef = useRef<boolean>(false);
  const isUnmountedRef = useRef<boolean>(false);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const updateStatus = useCallback((newStatus: RealtimeHealthStatus) => {
    if (isUnmountedRef.current || statusRef.current === newStatus) return;
    statusRef.current = newStatus;
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  const calculateBackoffDelay = useCallback((attempt: number): number => {
    const exponentialDelay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, attempt),
      MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return exponentialDelay + jitter;
  }, []);

  const cleanupChannel = useCallback(() => {
    const channel = channelRef.current;
    // Unsubscribe may synchronously report CLOSED. Retire ownership first so
    // deliberate cleanup cannot schedule another reconnect.
    channelRef.current = null;
    channelJoinedRef.current = false;
    if (channel) void supabase.removeChannel(channel);
  }, []);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    cancelReconnect();
    cleanupChannel();
  }, [cancelReconnect, cleanupChannel]);

  const scheduleReconnect = useCallback(() => {
    if (isUnmountedRef.current || !enabled || reconnectTimeoutRef.current) return;

    const delay = calculateBackoffDelay(reconnectAttemptRef.current);
    reconnectAttemptRef.current++;

    console.log(`Scheduling reconnect attempt ${reconnectAttemptRef.current} in ${Math.round(delay)}ms`);

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      if (!isUnmountedRef.current && enabled) {
        subscribeRef.current?.();
      }
    }, delay);
  }, [enabled, calculateBackoffDelay]);

  const markChannelInterrupted = useCallback((reason: string) => {
    channelJoinedRef.current = false;

    // Mobile websocket callbacks can flap while Mux keeps playing from buffer.
    // Only call it offline after the heartbeat has been stale long enough.
    const elapsed = Date.now() - lastHeartbeatRef.current;
    if (elapsed > OFFLINE_THRESHOLD_MS) {
      updateStatus('offline');
    } else {
      updateStatus('degraded');
    }

    console.warn('Realtime connection interrupted:', reason);
    scheduleReconnect();
  }, [scheduleReconnect, updateStatus]);

  const subscribe = useCallback(() => {
    if (isUnmountedRef.current || !enabled) return;

    cleanupChannel();

    // Supabase reuses channels with the same topic. Each monitor and retry
    // needs its own channel so the admin preview cannot remove the sidebar's
    // health subscription (or reuse a channel still being unsubscribed).
    const channel = supabase.channel(`${CHANNEL_NAMES.HEALTH_CHECK}:${monitorId}:${++channelGenerationRef.current}`, {
      config: {
        presence: {
          key: REALTIME_CONFIG.PRESENCE_KEY_HEALTH
        }
      }
    });

    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (channelRef.current !== channel) return;

        channelJoinedRef.current = true;
        lastHeartbeatRef.current = Date.now();
        cancelReconnect();
        reconnectAttemptRef.current = 0;
        if (statusRef.current !== 'healthy') {
          updateStatus('healthy');
          console.log('Realtime connection recovered');
        }
      })
      .subscribe((subscriptionStatus) => {
        if (channelRef.current !== channel) return;
        if (isUnmountedRef.current) return;

        if (subscriptionStatus === 'SUBSCRIBED') {
          channelJoinedRef.current = true;
          lastHeartbeatRef.current = Date.now();
          cancelReconnect();
          reconnectAttemptRef.current = 0;
          updateStatus('healthy');
          console.log('Realtime connection healthy');
          channel.track({ online_at: new Date().toISOString() });
        } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          markChannelInterrupted(subscriptionStatus);
        } else if (subscriptionStatus === 'CLOSED') {
          markChannelInterrupted(subscriptionStatus);
        }
      });

  }, [enabled, monitorId, cleanupChannel, cancelReconnect, updateStatus, markChannelInterrupted]);

  subscribeRef.current = subscribe;

  useEffect(() => {
    if (!enabled) {
      isUnmountedRef.current = true;
      cleanup();
      return;
    }

    isUnmountedRef.current = false;
    subscribe();

    const presenceInterval = setInterval(() => {
      if (channelRef.current?.state === 'joined') {
        channelRef.current.track({ online_at: new Date().toISOString() });
      }
    }, PRESENCE_UPDATE_INTERVAL);

    heartbeatIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (channelRef.current?.state === 'joined') {
        channelJoinedRef.current = true;
      }

      if (elapsed > OFFLINE_THRESHOLD_MS) {
        if (statusRef.current !== 'offline') {
          updateStatus('offline');
          scheduleReconnect();
        }
      } else if (elapsed > DEGRADED_THRESHOLD_MS || !channelJoinedRef.current) {
        if (statusRef.current !== 'degraded') {
          updateStatus('degraded');
        }
      } else if (statusRef.current !== 'healthy') {
        updateStatus('healthy');
      }
    }, BASE_HEARTBEAT_INTERVAL);

    return () => {
      isUnmountedRef.current = true;
      cleanup();
      clearInterval(presenceInterval);
    };
  }, [enabled, subscribe, cleanup, updateStatus, scheduleReconnect]);

  return status;
}
