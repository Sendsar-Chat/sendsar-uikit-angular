import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { initialsFor, type UserDirectoryEntry } from '../../utils/user-directory';

@Component({
  selector: 'sc-add-members-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-add-members-dialog.component.html',
  styleUrl: './sendsar-add-members-dialog.component.css',
})
export class SendsarAddMembersDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() title = 'Add members';
  @Input() hint = 'Select people to add to this group.';
  @Input() emptyHint = 'No people available to add.';
  @Input() confirmLabel = 'Add';
  @Input() busyLabel = 'Adding…';
  /** Full directory — already-added members are excluded via `excludeUserIds`. */
  @Input() users: UserDirectoryEntry[] = [];
  /** User ids already in the room (and usually the current user). */
  @Input() excludeUserIds: readonly string[] = [];
  @Input() onlineUserIds: ReadonlySet<string> = new Set();
  @Input() busy = false;
  @Input() error: string | null = null;

  @Output() readonly closed = new EventEmitter<void>();
  @Output() readonly confirm = new EventEmitter<UserDirectoryEntry[]>();

  private readonly usersSignal = signal<UserDirectoryEntry[]>([]);
  private readonly excludeIdsSignal = signal<ReadonlySet<string>>(new Set());

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly searchQuery = signal('');

  /** Directory users who are not excluded. */
  readonly availableUsers = computed(() => {
    const excluded = this.excludeIdsSignal();
    return this.usersSignal().filter((user) => !excluded.has(user.id));
  });

  readonly filteredUsers = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const available = this.availableUsers();
    if (!query) return available;
    return available.filter((user) => user.displayName.toLowerCase().includes(query));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['users']) {
      this.usersSignal.set(this.users ?? []);
    }
    if (changes['excludeUserIds']) {
      this.excludeIdsSignal.set(new Set(this.excludeUserIds ?? []));
    }
    if (changes['open']?.currentValue === true) {
      this.reset();
    }
    if (changes['users'] || changes['excludeUserIds']) {
      const allowed = new Set(this.availableUsers().map((u) => u.id));
      this.selectedIds.update((selected) => {
        const next = new Set([...selected].filter((id) => allowed.has(id)));
        return next.size === selected.size ? selected : next;
      });
    }
  }

  initials(name: string): string {
    return initialsFor(name);
  }

  isOnline(userId: string): boolean {
    return this.onlineUserIds.has(userId);
  }

  isSelected(userId: string): boolean {
    return this.selectedIds().has(userId);
  }

  toggleUser(userId: string): void {
    if (this.excludeIdsSignal().has(userId)) return;
    this.selectedIds.update((set) => {
      const next = new Set(set);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  close(): void {
    this.closed.emit();
  }

  submit(): void {
    const selected = this.availableUsers().filter((user) => this.selectedIds().has(user.id));
    if (selected.length === 0) return;
    this.confirm.emit(selected);
  }

  confirmButtonText(): string {
    if (this.busy) return this.busyLabel;
    const count = this.selectedIds().size;
    return count > 0 ? `${this.confirmLabel} (${count})` : this.confirmLabel;
  }

  private reset(): void {
    this.selectedIds.set(new Set());
    this.searchQuery.set('');
  }
}
