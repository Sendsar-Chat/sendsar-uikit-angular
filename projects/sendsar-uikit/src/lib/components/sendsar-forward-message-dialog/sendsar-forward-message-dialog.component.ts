import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Message, RoomSummary } from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { resolveRoomLabel } from '../../utils/room-label';
import { initialsFor, type UserDirectoryEntry } from '../../utils/user-directory';

@Component({
  selector: 'sc-forward-message-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-forward-message-dialog.component.html',
  styleUrl: './sendsar-forward-message-dialog.component.css',
})
export class SendsarForwardMessageDialogComponent implements OnChanges {
  private readonly chat = inject(SendsarChatService);

  @Input() open = false;
  @Input() message: Message | null = null;
  @Input() previewText = '';
  @Input() excludeRoomId: string | null = null;
  @Input() users: UserDirectoryEntry[] = [];
  @Input() selfUserId = '';
  @Input() busy = false;
  @Input() error: string | null = null;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly forward = new EventEmitter<string[]>();

  readonly rooms = signal<RoomSummary[]>([]);
  readonly loadingRooms = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly selectedRoomIds = signal<Set<string>>(new Set());

  readonly filteredRooms = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const list = this.rooms();
    if (!query) return list;
    return list.filter((room) => this.roomLabel(room).toLowerCase().includes(query));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.reset();
      void this.loadRooms();
    }
  }

  roomLabel(room: RoomSummary): string {
    return resolveRoomLabel(room, this.selfUserId, this.users);
  }

  roomInitials(room: RoomSummary): string {
    return initialsFor(this.roomLabel(room));
  }

  isSelected(roomId: string): boolean {
    return this.selectedRoomIds().has(roomId);
  }

  toggleRoom(roomId: string): void {
    this.selectedRoomIds.update((set) => {
      const next = new Set(set);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    const targetRoomIds = [...this.selectedRoomIds()];
    if (targetRoomIds.length === 0) return;
    this.forward.emit(targetRoomIds);
  }

  reset(): void {
    this.searchQuery.set('');
    this.selectedRoomIds.set(new Set());
    this.loadError.set(null);
    this.rooms.set([]);
  }

  private async loadRooms(): Promise<void> {
    this.loadingRooms.set(true);
    this.loadError.set(null);
    try {
      const { rooms } = await this.chat.listRooms({ limit: 100 });
      const excludeId = this.excludeRoomId;
      this.rooms.set(excludeId ? rooms.filter((room) => room.id !== excludeId) : rooms);
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      this.loadingRooms.set(false);
    }
  }
}
