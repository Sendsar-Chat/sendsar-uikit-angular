import type { Message } from '@sendsar/chat-sdk-javascript';

export type CachedRoomThread = {
  messages: Message[];
  nextCursor: string | null;
  peerLastReadAt: string | null;
};

/** In-memory thread cache so switching back to a room is instant. */
const roomThreadCache = new Map<string, CachedRoomThread>();

export function getCachedRoomThread(roomId: string): CachedRoomThread | undefined {
  const cached = roomThreadCache.get(roomId);
  if (!cached) return undefined;
  return {
    messages: [...cached.messages],
    nextCursor: cached.nextCursor,
    peerLastReadAt: cached.peerLastReadAt,
  };
}

export function setCachedRoomThread(roomId: string, cache: CachedRoomThread): void {
  roomThreadCache.set(roomId, {
    messages: [...cache.messages],
    nextCursor: cache.nextCursor,
    peerLastReadAt: cache.peerLastReadAt,
  });
}
