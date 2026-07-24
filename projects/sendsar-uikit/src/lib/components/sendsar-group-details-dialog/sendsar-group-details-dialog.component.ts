import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
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
} from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import {
  displayNameFor,
  initialsFor,
  userDirectoryMap,
  type UserDirectoryEntry,
} from '../../utils/user-directory';
import { SendsarAddMembersDialogComponent } from '../sendsar-add-members-dialog/sendsar-add-members-dialog.component';

type MemberRow = {
  userId: string;
  displayName: string;
};

@Component({
  selector: 'sc-group-details-dialog',
  standalone: true,
  imports: [CommonModule, SendsarAddMembersDialogComponent],
  templateUrl: './sendsar-group-details-dialog.component.html',
  styleUrl: './sendsar-group-details-dialog.component.css',
})
export class SendsarGroupDetailsDialogComponent implements OnChanges {
  private readonly chat = inject(SendsarChatService);
  private readonly session = inject(SendsarSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private rosterUnsub: (() => void) | null = null;

  @ViewChild('membersMenuWrap') private membersMenuWrap?: ElementRef<HTMLElement>;

  @Input() open = false;
  @Input() roomId: string | null = null;
  @Input() title = '';
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() onlineUserIds: ReadonlySet<string> = new Set();

  @Output() readonly closed = new EventEmitter<void>();
  /** Fired when membership changes so the shell can refresh the header subtitle. */
  @Output() readonly membersChanged = new EventEmitter<RoomParticipant[]>();
  readonly conversationDeleted = output<string>();
  readonly historyCleared = output<string>();

  readonly participants = signal<RoomParticipant[]>([]);
  readonly loadingMembers = signal(false);
  readonly membersError = signal<string | null>(null);
  readonly mutating = signal(false);
  readonly leaving = signal(false);
  readonly showMembersMenu = signal(false);
  readonly showAddMembersDialog = signal(false);
  readonly showRemoveMembersDialog = signal(false);
  readonly membersActionError = signal<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.rosterUnsub?.();
      this.rosterUnsub = null;
    });
  }

  readonly members = computed((): MemberRow[] => {
    const map = userDirectoryMap(this.users);
    return [...this.participants()]
      .sort((a, b) => {
        if (a.role === 'OPERATOR' && b.role !== 'OPERATOR') return -1;
        if (b.role === 'OPERATOR' && a.role !== 'OPERATOR') return 1;
        return displayNameFor(a.userId, map).localeCompare(displayNameFor(b.userId, map));
      })
      .map((p) => ({
        userId: p.userId,
        displayName: displayNameFor(p.userId, map),
      }));
  });

  readonly memberCount = computed(() => this.members().length);

  readonly onlineMemberCount = computed(
    () => this.participants().filter((p) => this.onlineUserIds.has(p.userId)).length,
  );

  readonly membersSubtitle = computed(() => {
    const n = this.memberCount();
    if (n === 0) return 'Group';
    return `${n} members, ${this.onlineMemberCount()} online`;
  });

  readonly selfIsOperator = computed(() =>
    this.participants().some((p) => p.userId === this.selfUserId && p.role === 'OPERATOR'),
  );

  readonly memberIds = computed(() => this.participants().map((p) => p.userId));

  /** Already in the room (+ self) — hidden from the add dialog. */
  readonly excludeUserIds = computed(() => {
    const ids = new Set(this.memberIds());
    if (this.selfUserId) ids.add(this.selfUserId);
    return [...ids];
  });

  /** Current members except self — shown in the remove dialog. */
  readonly removableUsers = computed((): UserDirectoryEntry[] => {
    const map = userDirectoryMap(this.users);
    return this.members()
      .filter((m) => m.userId !== this.selfUserId)
      .map((m) => ({
        id: m.userId,
        displayName: m.displayName || displayNameFor(m.userId, map),
      }));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] || changes['roomId']) {
      if (this.open && this.roomId) {
        this.wireRosterListener();
        void this.reloadMembers();
      } else if (!this.open) {
        this.rosterUnsub?.();
        this.rosterUnsub = null;
        this.participants.set([]);
        this.membersError.set(null);
        this.loadingMembers.set(false);
        this.showMembersMenu.set(false);
        this.showAddMembersDialog.set(false);
        this.showRemoveMembersDialog.set(false);
        this.membersActionError.set(null);
        this.mutating.set(false);
        this.leaving.set(false);
      }
    }
  }

  private wireRosterListener(): void {
    this.rosterUnsub?.();
    this.rosterUnsub = null;
    const client = this.session.client;
    const roomId = this.roomId;
    if (!client || !roomId) return;
    this.rosterUnsub = client.on(
      SOCKET_EVENT.ROOM_PARTICIPANTS_CHANGED,
      (event: RoomParticipantsChangedEvent) => {
        if (event.roomId !== roomId || !this.open) return;
        void this.reloadMembers();
      },
    );
  }

  avatarInitials(): string {
    return initialsFor(this.title || 'Group');
  }

  memberInitials(name: string): string {
    return initialsFor(name);
  }

  isOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  toggleMembersMenu(event: Event): void {
    event.stopPropagation();
    this.showMembersMenu.update((open) => !open);
  }

  /** Clicks inside the dialog (outside the menu) should close the menu. */
  onGroupDialogClick(event: MouseEvent): void {
    if (!this.showMembersMenu()) return;
    const wrap = this.membersMenuWrap?.nativeElement;
    if (wrap && !wrap.contains(event.target as Node)) {
      this.showMembersMenu.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.showMembersMenu()) {
      this.showMembersMenu.set(false);
    }
  }

  openAddMembersDialog(): void {
    this.showMembersMenu.set(false);
    this.membersActionError.set(null);
    this.showRemoveMembersDialog.set(false);
    this.showAddMembersDialog.set(true);
  }

  closeAddMembersDialog(): void {
    if (this.mutating()) return;
    this.showAddMembersDialog.set(false);
    this.membersActionError.set(null);
  }

  openRemoveMembersDialog(): void {
    this.showMembersMenu.set(false);
    this.membersActionError.set(null);
    this.showAddMembersDialog.set(false);
    this.showRemoveMembersDialog.set(true);
  }

  closeRemoveMembersDialog(): void {
    if (this.mutating()) return;
    this.showRemoveMembersDialog.set(false);
    this.membersActionError.set(null);
  }

  async onAddMembersConfirm(selected: UserDirectoryEntry[]): Promise<void> {
    const roomId = this.roomId;
    if (!roomId || this.mutating() || selected.length === 0) return;

    this.mutating.set(true);
    this.membersActionError.set(null);
    try {
      let participants = this.participants();
      for (const user of selected) {
        const detail = await this.chat.addParticipant(roomId, {
          userId: user.id,
          username: user.displayName,
        });
        participants = detail.participants;
      }
      this.participants.set(participants);
      console.log('participants', participants);
      this.membersChanged.emit(participants);
      this.showAddMembersDialog.set(false);
    } catch (err) {
      this.membersActionError.set(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      this.mutating.set(false);
    }
  }

  async onRemoveMembersConfirm(selected: UserDirectoryEntry[]): Promise<void> {
    const roomId = this.roomId;
    if (!roomId || this.mutating() || selected.length === 0) return;

    this.mutating.set(true);
    this.membersActionError.set(null);
    try {
      let participants = this.participants();
      for (const user of selected) {
        const detail = await this.chat.removeParticipant(roomId, user.id);
        participants = detail.participants;
      }
      this.participants.set(participants);
      this.membersChanged.emit(participants);
      this.showRemoveMembersDialog.set(false);
    } catch (err) {
      this.membersActionError.set(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      this.mutating.set(false);
    }
  }

  async clearHistory(): Promise<void> {
    const roomId = this.roomId;
    if (!roomId || this.mutating() || this.leaving()) return;
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

  async leaveGroup(): Promise<void> {
    const roomId = this.roomId;
    if (!roomId || this.mutating() || this.leaving()) return;
    if (!confirm('Leave and delete this group chat? You will leave the group.')) {
      return;
    }
    this.leaving.set(true);
    this.membersError.set(null);
    try {
      await this.chat.deleteConversation(roomId);
      this.conversationDeleted.emit(roomId);
      this.closed.emit();
    } catch (err) {
      this.membersError.set(err instanceof Error ? err.message : 'Failed to leave group');
    } finally {
      this.leaving.set(false);
    }
  }

  close(): void {
    this.closed.emit();
  }

  private async reloadMembers(): Promise<void> {
    const roomId = this.roomId;
    this.showMembersMenu.set(false);
    this.showAddMembersDialog.set(false);
    this.showRemoveMembersDialog.set(false);
    this.membersActionError.set(null);
    this.membersError.set(null);

    if (!roomId) {
      this.participants.set([]);
      this.loadingMembers.set(false);
      return;
    }

    this.loadingMembers.set(true);
    try {
      const detail = await this.chat.getRoom(roomId);
      this.participants.set(detail.participants);
      this.membersChanged.emit(detail.participants);
    } catch (err) {
      this.participants.set([]);
      this.membersError.set(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      this.loadingMembers.set(false);
    }
  }
}
