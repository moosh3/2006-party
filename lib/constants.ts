export const ROOM_NAMES = {
  DEFAULT: 'event',
} as const;

export const CHANNEL_NAMES = {
  PLAYBACK_SYNC: 'playback-sync',
  HEALTH_CHECK: 'health-check',
  HOLD_SCREEN_UPDATES: 'hold-screen-updates',
  POSTER_MODE_UPDATES: 'poster-mode-updates',
  EASTER_EGGS: 'easter-eggs',
  POLLS_TAB: 'polls-tab',
  PLAYBACK_CONTROL_UPDATES: 'playback-control-updates',
  STREAM_UPDATES: 'stream-updates',
  ADMIN_HOLD_SCREEN_UPDATES: 'admin-hold-screen-updates',
  CHAT_ROOM: (room: string) => `chat:${room}`,
  LOBBY_PRESENCE: 'lobby-presence',
  AUDIENCE_MOMENTS: 'audience-moments',
} as const;

export const PLAYBACK_ACTIONS = {
  PLAY: 'play',
  PAUSE: 'pause',
  SEEK: 'seek',
  RESTART: 'restart',
} as const;

export const DATABASE_TABLES = {
  CURRENT_STREAM: 'current_stream',
  MESSAGES: 'messages',
  MESSAGE_REACTIONS: 'message_reactions',
  POLLS: 'polls',
  POLL_VOTES: 'poll_votes',
} as const;

export const SYNC_THRESHOLDS = {
  SYNC_THRESHOLD_PLAYING: 5,
  SYNC_THRESHOLD_PAUSED: 2,
  MINOR_DRIFT_THRESHOLD: 1,
  LATENCY_ESTIMATE_MS: 150,
} as const;

export const REALTIME_CONFIG = {
  PRESENCE_KEY_HEALTH: 'health-monitor',
  PRESENCE_UPDATE_INTERVAL_MS: 10000,
  HEARTBEAT_CHECK_INTERVAL_MS: 5000,
  DEGRADED_THRESHOLD_MS: 25000,
  OFFLINE_THRESHOLD_MS: 45000,
} as const;

export const AUTO_ADVANCE_DEBOUNCE_MS = 500;
export const CHAT_SLOWMODE_SECONDS = 2;
export const MAX_MESSAGE_LENGTH = 600;
