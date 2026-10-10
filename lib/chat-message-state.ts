import type { MessageReaction, MessageReactionSummary } from './reactions';

export interface ChatMessage {
  id: number;
  user_id: string;
  user_name: string;
  body: string;
  kind: 'user' | 'system' | 'poll';
  created_at: string;
  reactions?: MessageReactionSummary[];
  viewerReaction?: MessageReaction | null;
  room?: string;
  deleted_at?: string | null;
}

export const CHAT_MESSAGE_LIMIT = 100;

export interface ChatMessageChange {
  message: ChatMessage | null;
  id: number;
}

function mergeMessage(previous: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  return {
    ...previous,
    ...incoming,
    // Realtime message rows do not include the reaction summaries returned by
    // the messages API. A duplicate INSERT must not erase those summaries.
    ...(incoming.reactions === undefined && previous?.reactions !== undefined
      ? { reactions: previous.reactions }
      : {}),
    ...(incoming.viewerReaction === undefined && previous?.viewerReaction !== undefined
      ? { viewerReaction: previous.viewerReaction }
      : {}),
  };
}

/** Messages must already belong to the caller's room. Never mutates inputs. */
export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const deletedIds = new Set(messages.filter((message) => message.deleted_at).map((message) => message.id));
  const byId = new Map<number, ChatMessage>();
  for (const message of messages) {
    // A tombstone dominates every copy of this ID in this batch, regardless
    // of event order. Deleted database IDs are not reusable message IDs.
    if (!deletedIds.has(message.id)) {
      byId.set(message.id, mergeMessage(byId.get(message.id), message));
    }
  }
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_MESSAGE_LIMIT);
}

export function applyChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return normalizeChatMessages([...messages, message]);
}

export function removeChatMessage(messages: ChatMessage[], id: number): ChatMessage[] {
  return normalizeChatMessages(messages.filter((message) => message.id !== id));
}

/**
 * A fetch is an authoritative snapshot, not a merge with the old UI list.
 * The caller supplies only changes received AFTER that fetch started, in
 * revision order, and rejects snapshots belonging to an old room/request.
 */
export function reconcileChatMessages(
  snapshot: ChatMessage[],
  changes: ChatMessageChange[],
): ChatMessage[] {
  const deletedIds = new Set(snapshot.filter((message) => message.deleted_at).map((message) => message.id));
  for (const change of changes) {
    if (!change.message || change.message.deleted_at) deletedIds.add(change.id);
  }
  const messages = [...snapshot];
  for (const change of changes) {
    if (change.message && !deletedIds.has(change.id)) messages.push(change.message);
  }
  return normalizeChatMessages(messages.filter((message) => !deletedIds.has(message.id)));
}
