import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { DemoUser } from '../environments/environment';

export type NewChatDirect = { kind: 'direct'; peerId: string };
export type NewChatGroup = { kind: 'group'; name: string; memberIds: string[] };
export type NewChatRequest = NewChatDirect | NewChatGroup;

@Component({
  selector: 'app-new-chat-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './new-chat-dialog.component.html',
  styleUrl: './new-chat-dialog.component.css',
})
export class NewChatDialogComponent {
  @Input({ required: true }) selfId!: string;
  @Input({ required: true }) users: DemoUser[] = [];
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Input() open = false;
  @Input() busy = false;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly create = new EventEmitter<NewChatRequest>();

  readonly tab = signal<'direct' | 'group'>('direct');
  readonly selectedPeerId = signal('');
  readonly groupName = signal('');
  readonly selectedMembers = signal<Set<string>>(new Set());

  peers(): DemoUser[] {
    return this.users.filter((u) => u.chatUserId !== this.selfId);
  }

  isOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  setTab(tab: 'direct' | 'group'): void {
    this.tab.set(tab);
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
  }
}
