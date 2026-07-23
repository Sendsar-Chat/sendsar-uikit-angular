import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { initialsFor, type UserDirectoryEntry } from '../../utils/user-directory';

export type SendsarNewChatDirect = { kind: 'direct'; peerId: string };
export type SendsarNewChatGroup = { kind: 'group'; name: string; memberIds: string[] };
export type SendsarNewChatRequest = SendsarNewChatDirect | SendsarNewChatGroup;

@Component({
  selector: 'sc-new-chat-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-new-chat-dialog.component.html',
  styleUrl: './sendsar-new-chat-dialog.component.css',
})
export class SendsarNewChatDialogComponent implements OnChanges {
  @Input({ required: true }) selfId!: string;
  @Input({ required: true }) users: UserDirectoryEntry[] = [];
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Input() open = false;
  @Input() busy = false;
  @Input() error: string | null = null;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly create = new EventEmitter<SendsarNewChatRequest>();

  readonly tab = signal<'direct' | 'group'>('direct');
  readonly selectedPeerId = signal('');
  readonly selectedMembers = signal<Set<string>>(new Set());
  readonly searchQuery = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.reset();
    }
  }

  filteredPeers(): UserDirectoryEntry[] {
    const query = this.searchQuery().trim().toLowerCase();
    const peers = this.users.filter((u) => u.id !== this.selfId);
    if (!query) return peers;
    return peers.filter((user) => user.displayName.toLowerCase().includes(query));
  }

  initials(name: string): string {
    return initialsFor(name);
  }

  isOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  setTab(tab: 'direct' | 'group'): void {
    this.tab.set(tab);
    this.searchQuery.set('');
  }

  toggleMember(userId: string): void {
    this.selectedMembers.update((set) => {
      const next = new Set(set);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  isMemberSelected(userId: string): boolean {
    return this.selectedMembers().has(userId);
  }

  close(): void {
    this.closed.emit();
  }

  submitDirect(): void {
    const peerId = this.selectedPeerId();
    if (!peerId) return;
    this.create.emit({ kind: 'direct', peerId });
  }

  submitGroup(name: string): void {
    const trimmed = name.trim();
    const memberIds = [...this.selectedMembers()];
    if (!trimmed || memberIds.length === 0) return;
    this.create.emit({ kind: 'group', name: trimmed, memberIds });
  }

  reset(): void {
    this.tab.set('direct');
    this.selectedPeerId.set('');
    this.selectedMembers.set(new Set());
    this.searchQuery.set('');
  }
}
