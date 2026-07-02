import {
  Component,
  DestroyRef,
  Input,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  SOCKET_EVENT,
  applyTypingEvent,
  createTenantPresenceTracker,
  formatTypingLabel,
  otherTypingUserIds,
  type Message,
  type RoomSummary,
  type TypingByRoom,
} from '@sendsar/chat-sdk-javascript';
import { SendsarComposerComponent } from '../sendsar-composer/sendsar-composer.component';
import { SendsarConversationListComponent } from '../sendsar-conversation-list/sendsar-conversation-list.component';
import { SendsarMessageListComponent } from '../sendsar-message-list/sendsar-message-list.component';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { isDirectMessage, isGroupRoom, resolveRoomLabel } from '../../utils/room-label';
import { initialsFor, userDirectoryMap, type UserDirectoryEntry } from '../../utils/user-directory';

@Component({
  selector: 'sc-chat-shell',
  standalone: true,
  imports: [
    CommonModule,
    SendsarConversationListComponent,
    SendsarMessageListComponent,
    SendsarComposerComponent,
  ],
  templateUrl: './sendsar-chat-shell.component.html',
  styleUrl: './sendsar-chat-shell.component.css',
})
export class SendsarChatShellComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(SendsarSessionService);

  @Input() users: UserDirectoryEntry[] = [];

  @ViewChild(SendsarConversationListComponent)
  private conversationList?: SendsarConversationListComponent;

  readonly selectedRoom = signal<RoomSummary | null>(null);
  readonly typingByRoom = signal<TypingByRoom>({});
  readonly onlineUserIds = signal<ReadonlySet<string>>(new Set());
  readonly mobileShowThread = signal(false);

  private realtimeWired = false;
  private presenceTracker: ReturnType<typeof createTenantPresenceTracker> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const check = () => {
      if (this.session.isReady && !this.realtimeWired) {
        this.wireRealtime();
      }
    };
    check();
    const interval = setInterval(check, 250);
    this.destroyRef.onDestroy(() => clearInterval(interval));
  }

  onRoomSelect(room: RoomSummary): void {
    this.selectedRoom.set(room);
    this.mobileShowThread.set(true);
  }

  backToList(): void {
    this.mobileShowThread.set(false);
  }

  onMessageSent(): void {
    this.scheduleSidebarReload();
  }

  onThreadActivity(): void {
    this.scheduleSidebarReload();
  }

  /** Open a room in the thread pane (e.g. after creating a DM server-side). */
  async openRoom(roomId: string, title?: string | null): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (this.session.state().status === 'loading' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.session.isReady) {
      return;
    }

    const room = await this.conversationList?.selectRoomById(roomId);
    if (room) {
      this.selectedRoom.set(room);
      this.mobileShowThread.set(true);
      return;
    }

    this.selectedRoom.set({
      id: roomId,
      name: title?.trim() || null,
      externalId: null,
      customType: 'demo_dm',
      metadata: null,
      isFrozen: false,
      lastMessage: null,
      createdAt: new Date().toISOString(),
    });
    this.mobileShowThread.set(true);
    void this.conversationList?.reload();
  }

  roomTitle(): string {
    const room = this.selectedRoom();
    const selfId = this.session.session?.chatUserId ?? '';
    if (!room) return 'Messages';
    return resolveRoomLabel(room, selfId, this.users);
  }

  roomIsGroup(): boolean {
    const room = this.selectedRoom();
    return room ? isGroupRoom(room) : false;
  }

  headerAvatarInitials(): string {
    return initialsFor(this.roomTitle());
  }

  typingLabel(): string {
    const room = this.selectedRoom();
    const selfId = this.session.session?.chatUserId ?? '';
    if (!room || !selfId) return '';
    const typingIds = otherTypingUserIds(this.typingByRoom(), room.id, selfId);
    const map = Object.fromEntries(
      [...userDirectoryMap(this.users).entries()].map(([id, u]) => [id, u.displayName]),
    );
    return formatTypingLabel(typingIds, map, { directMessage: isDirectMessage(room) });
  }

  chatSettings() {
    return this.session.session?.chatSettings ?? null;
  }

  retryConnection(): void {
    void this.session.restart();
  }

  private wireRealtime(): void {
    const client = this.session.client;
    if (!client) return;

    this.realtimeWired = true;

    const offTyping = client.on(SOCKET_EVENT.TYPING, (event) => {
      this.typingByRoom.update((prev) => applyTypingEvent(prev, event));
    });

    const offMessage = client.on(SOCKET_EVENT.NEW_MESSAGE, (msg: Message) => {
      this.scheduleSidebarReload();
      const selected = this.selectedRoom();
      if (selected && msg.roomId !== selected.id) {
        void this.conversationList?.reload();
      }
    });

    const offUpdated = client.on(SOCKET_EVENT.MESSAGE_UPDATED, () => {
      this.scheduleSidebarReload();
    });

    this.presenceTracker = createTenantPresenceTracker(client);
    const offPresence = this.presenceTracker.subscribe((ids) => {
      this.onlineUserIds.set(ids);
    });

    this.destroyRef.onDestroy(() => {
      offTyping();
      offMessage();
      offUpdated();
      offPresence();
      this.presenceTracker?.destroy();
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
    });
  }

  private scheduleSidebarReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      void this.conversationList?.reload();
    }, 800);
  }
}
