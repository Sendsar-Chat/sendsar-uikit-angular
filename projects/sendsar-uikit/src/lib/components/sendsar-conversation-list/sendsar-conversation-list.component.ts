import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  formatTypingLabel,
  inboxSubtitleForPeer,
  otherTypingUserIds,
  sortRoomsByLatestActivity,
  type RoomSummary,
  type TypingByRoom,
} from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { formatRelativeTime } from '../../utils/format-time';
import { isDirectMessage, resolveRoomLabel } from '../../utils/room-label';
import { initialsFor, type UserDirectoryEntry, userDirectoryMap } from '../../utils/user-directory';

@Component({
  selector: 'sc-conversation-list',
  standalone: true,
  imports: [CommonModule],
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

  readonly rooms = signal<RoomSummary[]>([]);
  /** First load with no cached rooms — show skeletons. */
  readonly initialLoad = signal(true);
  /** Background refresh — keep list visible, spin refresh icon. */
  readonly refreshing = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal('');

  readonly filteredRooms = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const list = this.rooms();
    if (!query) return list;
    return list.filter((room) => this.roomLabel(room).toLowerCase().includes(query));
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
      this.rooms.set(sortRoomsByLatestActivity(rooms));
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
