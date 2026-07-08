import { Component, EventEmitter, Input, Output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { RoomSummary } from '@sendsar/chat-sdk-javascript';
import { initialsFor, type UserDirectoryEntry } from '../../utils/user-directory';
import { isDirectMessage, isGroupRoom, parseDmPeerId } from '../../utils/room-label';

@Component({
  selector: 'sc-room-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-room-info.component.html',
  styleUrl: './sendsar-room-info.component.css',
})
export class SendsarRoomInfoComponent {
  @Input() room: RoomSummary | null = null;
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Input() title = '';
  @Output() readonly closed = new EventEmitter<void>();

  readonly isGroup = computed(() => {
    const room = this.room;
    return room ? isGroupRoom(room) : false;
  });

  readonly isDm = computed(() => {
    const room = this.room;
    return room ? isDirectMessage(room) : false;
  });

  readonly avatarInitials = computed(() => initialsFor(this.title || 'Chat'));

  readonly memberCount = computed(() => {
    if (!this.isGroup()) return 0;
    return Math.max(this.visibleMembers().length, 1);
  });

  readonly visibleMembers = computed(() => {
    const room = this.room;
    if (!room) return [];

    if (this.isDm()) {
      const peerId = parseDmPeerId(room.externalId, this.selfUserId);
      if (!peerId) return [];
      const peer = this.users.find((u) => u.id === peerId);
      return peer ? [peer] : [{ id: peerId, displayName: this.title }];
    }

    return this.users.filter((u) => u.id !== this.selfUserId);
  });

  readonly previewMembers = computed(() => this.visibleMembers().slice(0, 5));

  readonly overflowMemberCount = computed(() =>
    Math.max(0, this.visibleMembers().length - this.previewMembers().length),
  );

  memberInitials(member: UserDirectoryEntry): string {
    return initialsFor(member.displayName);
  }

  isOnline(memberId: string): boolean {
    return this.onlineUserIds.has(memberId);
  }

  onClose(): void {
    this.closed.emit();
  }
}
