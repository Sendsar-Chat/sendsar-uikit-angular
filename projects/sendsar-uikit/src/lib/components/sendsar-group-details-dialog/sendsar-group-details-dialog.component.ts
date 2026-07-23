import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { initialsFor, type UserDirectoryEntry } from '../../utils/user-directory';

@Component({
  selector: 'sc-group-details-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-group-details-dialog.component.html',
  styleUrl: './sendsar-group-details-dialog.component.css',
})
export class SendsarGroupDetailsDialogComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() onlineUserIds: ReadonlySet<string> = new Set();

  @Output() readonly closed = new EventEmitter<void>();

  members(): UserDirectoryEntry[] {
    // Demo directory: show peers as group members (self is implied by membership).
    return this.users.filter((user) => user.id !== this.selfUserId);
  }

  memberCount(): number {
    return Math.max(this.members().length, 1);
  }

  avatarInitials(): string {
    return initialsFor(this.title || 'Group');
  }

  memberInitials(member: UserDirectoryEntry): string {
    return initialsFor(member.displayName);
  }

  isOnline(memberId: string): boolean {
    return this.onlineUserIds.has(memberId);
  }

  close(): void {
    this.closed.emit();
  }
}
