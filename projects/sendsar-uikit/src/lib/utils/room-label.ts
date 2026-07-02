import type { RoomSummary } from '@sendsar/chat-sdk-javascript';
import type { UserDirectoryEntry } from './user-directory';
import { displayNameFor, userDirectoryMap } from './user-directory';

/** Peer user id from a canonical `dm:userA:userB` external id. */
export function parseDmPeerId(
  externalId: string | null | undefined,
  selfUserId: string,
): string | null {
  if (!externalId?.startsWith('dm:')) return null;
  const ids = externalId.slice(3).split(':');
  if (ids.length !== 2) return null;
  return ids.find((id) => id !== selfUserId) ?? null;
}

export function isDirectMessage(room: Pick<RoomSummary, 'customType' | 'externalId'>): boolean {
  return room.customType === 'demo_dm' || Boolean(room.externalId?.startsWith('dm:'));
}

export function isGroupRoom(room: Pick<RoomSummary, 'customType' | 'externalId' | 'name'>): boolean {
  if (isDirectMessage(room)) return false;
  return room.customType === 'demo_group' || Boolean(room.name?.trim());
}

/** Human-readable title — never shows raw `dm:…` external ids. */
export function resolveRoomLabel(
  room: RoomSummary,
  selfUserId: string,
  users: readonly UserDirectoryEntry[],
): string {
  const map = userDirectoryMap(users);

  if (room.name?.trim()) {
    return room.name.trim();
  }

  if (isDirectMessage(room)) {
    const peerId = parseDmPeerId(room.externalId, selfUserId);
    if (peerId) {
      return displayNameFor(peerId, map);
    }
  }

  if (room.customType === 'demo_group') {
    return 'Group chat';
  }

  if (room.externalId?.startsWith('dm:')) {
    const peerId = parseDmPeerId(room.externalId, selfUserId);
    if (peerId) return displayNameFor(peerId, map);
  }

  return 'Conversation';
}
