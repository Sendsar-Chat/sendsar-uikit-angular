import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  SOCKET_EVENT,
  type RoomParticipant,
  type RoomParticipantsChangedEvent,
  type RoomSummary,
} from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import {
  displayNameFor,
  initialsFor,
  userDirectoryMap,
  type UserDirectoryEntry,
} from '../../utils/user-directory';
import { isDirectMessage, isGroupRoom, parseDmPeerId } from '../../utils/room-label';

type MemberRow = {
  userId: string;
  displayName: string;
  role: string;
  isOperator: boolean;
  isSelf: boolean;
};

@Component({
  selector: 'sc-room-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-room-info.component.html',
  styleUrl: './sendsar-room-info.component.css',
})
export class SendsarRoomInfoComponent implements OnChanges {
  private readonly chat = inject(SendsarChatService);
  private readonly session = inject(SendsarSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private rosterUnsub: (() => void) | null = null;

  @Input() room: RoomSummary | null = null;
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Input() title = '';
  @Output() readonly closed = new EventEmitter<void>();
  readonly conversationDeleted = output<string>();
  readonly historyCleared = output<string>();

  readonly participants = signal<RoomParticipant[]>([]);
  readonly loadingMembers = signal(false);
  readonly membersError = signal<string | null>(null);
  readonly mutating = signal(false);
  readonly showAddPicker = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.rosterUnsub?.();
      this.rosterUnsub = null;
    });
  }

  readonly isGroup = computed(() => {
    const room = this.room;
    return room ? isGroupRoom(room) : false;
  });

  readonly isDm = computed(() => {
    const room = this.room;
    return room ? isDirectMessage(room) : false;
  });

  readonly avatarInitials = computed(() => initialsFor(this.title || 'Chat'));

  readonly selfIsOperator = computed(() =>
    this.participants().some((p) => p.userId === this.selfUserId && p.role === 'OPERATOR'),
  );

  readonly memberRows = computed((): MemberRow[] => {
    const map = userDirectoryMap(this.users);
    const room = this.room;
    if (!room) return [];

    if (this.isDm()) {
      const peerId = parseDmPeerId(room.externalId, this.selfUserId);
      if (!peerId) return [];
      return [
        {
          userId: peerId,
          displayName: displayNameFor(peerId, map),
          role: 'MEMBER',
          isOperator: false,
          isSelf: false,
        },
      ];
    }

    if (!this.isGroup()) return [];

    return [...this.participants()]
      .sort((a, b) => {
        if (a.role === 'OPERATOR' && b.role !== 'OPERATOR') return -1;
        if (b.role === 'OPERATOR' && a.role !== 'OPERATOR') return 1;
        return displayNameFor(a.userId, map).localeCompare(displayNameFor(b.userId, map));
      })
      .map((p) => ({
        userId: p.userId,
        displayName: displayNameFor(p.userId, map),
        role: p.role,
        isOperator: p.role === 'OPERATOR',
        isSelf: p.userId === this.selfUserId,
      }));
  });

  readonly memberCount = computed(() => Math.max(this.memberRows().length, 0));

  readonly membersSubtitle = computed(() => {
    if (this.isGroup()) {
      const members = this.participants();
      if (members.length === 0) return 'Group';
      const online = members.filter((p) => this.onlineUserIds.has(p.userId)).length;
      return `${members.length} members, ${online} online`;
    }
    if (this.isDm()) {
      const peer = this.memberRows()[0];
      if (peer && this.isOnline(peer.userId)) return 'Online';
      return '';
    }
    return '';
  });

  readonly addableUsers = computed(() => {
    const inRoom = new Set(this.participants().map((p) => p.userId));
    return this.users.filter((u) => u.id !== this.selfUserId && !inRoom.has(u.id));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['room'] || changes['selfUserId']) {
      this.wireRosterListener();
      void this.reloadMembers();
    }
  }

  private wireRosterListener(): void {
    this.rosterUnsub?.();
    this.rosterUnsub = null;
    const client = this.session.client;
    const roomId = this.room?.id;
    if (!client || !roomId) return;
    this.rosterUnsub = client.on(
      SOCKET_EVENT.ROOM_PARTICIPANTS_CHANGED,
      (event: RoomParticipantsChangedEvent) => {
        if (event.roomId !== roomId) return;
        void this.reloadMembers();
      },
    );
  }

  memberInitials(displayName: string): string {
    return initialsFor(displayName);
  }

  isOnline(memberId: string): boolean {
    return this.onlineUserIds.has(memberId);
  }

  onClose(): void {
    this.closed.emit();
  }

  toggleAddPicker(): void {
    this.showAddPicker.update((open) => !open);
  }

  async addMember(user: UserDirectoryEntry): Promise<void> {
    const roomId = this.room?.id;
    if (!roomId || this.mutating()) return;

    this.mutating.set(true);
    this.membersError.set(null);
    try {
      const detail = await this.chat.addParticipant(roomId, {
        userId: user.id,
        username: user.displayName,
      });
      this.participants.set(detail.participants);
      this.showAddPicker.set(false);
    } catch (err) {
      this.membersError.set(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      this.mutating.set(false);
    }
  }

  async removeMember(userId: string): Promise<void> {
    const roomId = this.room?.id;
    if (!roomId || this.mutating()) return;

    this.mutating.set(true);
    this.membersError.set(null);
    try {
      const detail = await this.chat.removeParticipant(roomId, userId);
      this.participants.set(detail.participants);
    } catch (err) {
      this.membersError.set(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      this.mutating.set(false);
    }
  }

  async clearHistory(): Promise<void> {
    const roomId = this.room?.id;
    if (!roomId || this.mutating()) return;
    if (
      !confirm(
        'Clear history? Messages will be removed from your view only. Others keep their copy.',
      )
    ) {
      return;
    }
    this.mutating.set(true);
    this.membersError.set(null);
    try {
      await this.chat.clearHistory(roomId);
      this.historyCleared.emit(roomId);
    } catch (err) {
      this.membersError.set(err instanceof Error ? err.message : 'Failed to clear history');
    } finally {
      this.mutating.set(false);
    }
  }

  async deleteConversation(): Promise<void> {
    const room = this.room;
    if (!room || this.mutating()) return;
    const message = this.isGroup()
      ? 'Leave and delete this group chat? You will leave the group.'
      : 'Delete this chat? It disappears from your list. New messages will show it again.';
    if (!confirm(message)) {
      return;
    }
    this.mutating.set(true);
    this.membersError.set(null);
    try {
      await this.chat.deleteConversation(room.id);
      this.conversationDeleted.emit(room.id);
      this.closed.emit();
    } catch (err) {
      this.membersError.set(
        err instanceof Error ? err.message : 'Failed to delete conversation',
      );
    } finally {
      this.mutating.set(false);
    }
  }

  private async reloadMembers(): Promise<void> {
    const room = this.room;
    this.showAddPicker.set(false);
    this.membersError.set(null);

    if (!room || !isGroupRoom(room)) {
      this.participants.set([]);
      this.loadingMembers.set(false);
      return;
    }

    this.loadingMembers.set(true);
    try {
      const detail = await this.chat.getRoom(room.id);
      this.participants.set(detail.participants);
    } catch (err) {
      this.participants.set([]);
      this.membersError.set(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      this.loadingMembers.set(false);
    }
  }
}
