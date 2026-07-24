import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  formatTypingLabel,
  inboxSubtitleForPeer,
  otherTypingUserIds,
  type RoomSummary,
  type TypingByRoom,
} from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { formatRelativeTime } from '../../utils/format-time';
import { isDirectMessage, isGroupRoom, resolveRoomLabel } from '../../utils/room-label';
import { initialsFor, type UserDirectoryEntry, userDirectoryMap } from '../../utils/user-directory';
import { segmentTextWithEmoji, type TextSegment } from '../../utils/emoji-segments';
import { SendsarAnimatedEmojiComponent } from '../mini-components/sendsar-animated-emoji/sendsar-animated-emoji.component';

/** Most recent activity timestamp for inbox ordering. */
function roomActivityAt(room: RoomSummary): number {
  const iso = room.lastMessage?.createdAt ?? room.createdAt;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest activity first (`lastMessage.createdAt`, else `room.createdAt`). */
function sortRoomsByActivity(rooms: readonly RoomSummary[]): RoomSummary[] {
  return [...rooms].sort((a, b) => {
    const diff = roomActivityAt(b) - roomActivityAt(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

@Component({
  selector: 'sc-conversation-list',
  standalone: true,
  imports: [CommonModule, SendsarAnimatedEmojiComponent],
  templateUrl: './sendsar-conversation-list.component.html',
  styleUrl: './sendsar-conversation-list.component.css',
})
export class SendsarConversationListComponent implements OnInit {
  private readonly chat = inject(SendsarChatService);
  private readonly session = inject(SendsarSessionService);

  @Input() selectedRoomId: string | null = null;
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() typingByRoom: TypingByRoom = {};
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Output() readonly roomSelect = new EventEmitter<RoomSummary>();
  @Output() readonly newChat = new EventEmitter<void>();
  @Output() readonly roomDeleted = new EventEmitter<string>();
  @Output() readonly historyCleared = new EventEmitter<string>();

  readonly rooms = signal<RoomSummary[]>([]);
  /** First load with no cached rooms — show skeletons. */
  readonly initialLoad = signal(true);
  /** Background refresh — keep list visible, spin refresh icon. */
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly showMenu = signal(false);
  readonly roomMenuId = signal<string | null>(null);
  readonly actionBusy = signal(false);

  readonly filteredRooms = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const list = this.rooms();
    const filtered = !query
      ? list
      : list.filter((room) => this.roomLabel(room).toLowerCase().includes(query));
    return sortRoomsByActivity(filtered);
  });

  readonly skeletonRows = [0, 1, 2, 3, 4];

  ngOnInit(): void {
    void this.waitForSessionAndLoad();
  }

  async reload(): Promise<void> {
    if (!this.session.isReady) {
      return;
    }

    const hasRooms = this.rooms().length > 0;
    if (hasRooms) {
      this.refreshing.set(true);
    } else {
      this.initialLoad.set(true);
    }
    this.error.set(null);

    try {
      const { rooms } = await this.chat.listRooms({ limit: 50 });
      this.rooms.set(sortRoomsByActivity(rooms));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load rooms');
    } finally {
      this.initialLoad.set(false);
      this.refreshing.set(false);
    }
  }

  selectRoom(room: RoomSummary): void {
    this.roomSelect.emit(room);
  }

  async selectRoomById(roomId: string): Promise<RoomSummary | null> {
    await this.reload();
    const room = this.rooms().find((r) => r.id === roomId) ?? null;
    if (room) {
      this.selectRoom(room);
    }
    return room;
  }

  roomLabel(room: RoomSummary): string {
    const selfId = this.selfUserId || this.session.session?.chatUserId || '';
    return resolveRoomLabel(room, selfId, this.users);
  }

  roomSubtitle(room: RoomSummary): string {
    const selfId = this.selfUserId || this.session.session?.chatUserId || '';
    const typingIds = otherTypingUserIds(this.typingByRoom, room.id, selfId);
    const map = Object.fromEntries(
      [...userDirectoryMap(this.users).entries()].map(([id, u]) => [id, u.displayName]),
    );
    const typingLabel = formatTypingLabel(typingIds, map, {
      directMessage: isDirectMessage(room),
    });
    return (
      inboxSubtitleForPeer({
        typingLabel,
        lastMessagePreview: room.lastMessage?.previewText ?? undefined,
      }) ?? ''
    );
  }

  subtitleSegments(subtitle: string): TextSegment[] {
    return segmentTextWithEmoji(subtitle);
  }

  roomTime(room: RoomSummary): string {
    return formatRelativeTime(room.lastMessage?.createdAt ?? room.createdAt);
  }

  avatarInitials(room: RoomSummary): string {
    return initialsFor(this.roomLabel(room));
  }

  isPeerOnline(room: RoomSummary): boolean {
    if (!isDirectMessage(room)) return false;
    const selfId = this.selfUserId || this.session.session?.chatUserId || '';
    const peerId = room.externalId?.startsWith('dm:')
      ? room.externalId
          .slice(3)
          .split(':')
          .find((id) => id !== selfId)
      : null;
    return Boolean(peerId && this.onlineUserIds.has(peerId));
  }

  unreadCount(room: RoomSummary): number {
    return room.unreadCount ?? 0;
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.showMenu.update((open) => !open);
  }

  @HostListener('document:click')
  closeMenu(): void {
    if (this.showMenu()) {
      this.showMenu.set(false);
    }
    if (this.roomMenuId()) {
      this.roomMenuId.set(null);
    }
  }

  onNewChat(): void {
    this.showMenu.set(false);
    this.newChat.emit();
  }

  onRefresh(): void {
    this.showMenu.set(false);
    void this.reload();
  }

  toggleRoomMenu(event: Event, roomId: string): void {
    event.stopPropagation();
    this.showMenu.set(false);
    this.roomMenuId.update((id) => (id === roomId ? null : roomId));
  }

  isGroup(room: RoomSummary): boolean {
    return isGroupRoom(room);
  }

  async clearHistory(event: Event, room: RoomSummary): Promise<void> {
    event.stopPropagation();
    this.roomMenuId.set(null);
    if (
      !confirm(
        'Clear history? Messages will be removed from your view only. Others keep their copy.',
      )
    ) {
      return;
    }
    if (this.actionBusy()) return;
    this.actionBusy.set(true);
    try {
      await this.chat.clearHistory(room.id);
      this.rooms.update((list) =>
        list.map((r) =>
          r.id === room.id ? { ...r, lastMessage: null, unreadCount: 0 } : r,
        ),
      );
      this.historyCleared.emit(room.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to clear history');
    } finally {
      this.actionBusy.set(false);
    }
  }

  async deleteConversation(event: Event, room: RoomSummary): Promise<void> {
    event.stopPropagation();
    this.roomMenuId.set(null);
    const message = isGroupRoom(room)
      ? 'Leave and delete this group chat? You will leave the group.'
      : 'Delete this chat? It disappears from your list. New messages will show it again.';
    if (!confirm(message)) {
      return;
    }
    if (this.actionBusy()) return;
    this.actionBusy.set(true);
    try {
      await this.chat.deleteConversation(room.id);
      this.rooms.update((list) => list.filter((r) => r.id !== room.id));
      this.roomDeleted.emit(room.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to delete conversation');
    } finally {
      this.actionBusy.set(false);
    }
  }

  private async waitForSessionAndLoad(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!this.session.isReady && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (this.session.isReady) {
      await this.reload();
    } else {
      this.initialLoad.set(false);
      this.error.set('Waiting for connection…');
    }
  }
}
