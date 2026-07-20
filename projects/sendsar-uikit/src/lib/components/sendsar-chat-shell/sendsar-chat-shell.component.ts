import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
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
import { SendsarCallOverlayComponent } from '../mini-components/sendsar-call-overlay/sendsar-call-overlay.component';
import { SendsarComposerComponent } from '../sendsar-composer/sendsar-composer.component';
import { SendsarConversationListComponent } from '../sendsar-conversation-list/sendsar-conversation-list.component';
import {
  SendsarMessageListComponent,
  type SendsarCallRedialEvent,
} from '../sendsar-message-list/sendsar-message-list.component';
import { SendsarRoomInfoComponent } from '../sendsar-room-info/sendsar-room-info.component';
import { SendsarCallService } from '../../services/sendsar-call.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { isDirectMessage, isGroupRoom, parseDmPeerId, resolveRoomLabel } from '../../utils/room-label';
import { initialsFor, userDirectoryMap, type UserDirectoryEntry } from '../../utils/user-directory';

@Component({
  selector: 'sc-chat-shell',
  standalone: true,
  imports: [
    CommonModule,
    SendsarConversationListComponent,
    SendsarMessageListComponent,
    SendsarComposerComponent,
    SendsarRoomInfoComponent,
    SendsarCallOverlayComponent,
  ],
  templateUrl: './sendsar-chat-shell.component.html',
  styleUrl: './sendsar-chat-shell.component.css',
})
export class SendsarChatShellComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly calls = inject(SendsarCallService);
  readonly session = inject(SendsarSessionService);

  @Input() users: UserDirectoryEntry[] = [];
  @Output() readonly callStarted = new EventEmitter<{ roomId: string; type: 'audio' | 'video' }>();

  @ViewChild(SendsarConversationListComponent)
  private conversationList?: SendsarConversationListComponent;

  readonly selectedRoom = signal<RoomSummary | null>(null);
  readonly typingByRoom = signal<TypingByRoom>({});
  readonly onlineUserIds = signal<ReadonlySet<string>>(new Set());
  readonly mobileShowThread = signal(false);
  readonly showInfoPanel = signal(true);
  readonly calling = this.calls.calling;
  readonly showCallUi = this.calls.showCallUi;
  readonly callError = signal<string | null>(null);

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
    this.showInfoPanel.set(true);
  }

  closeInfoPanel(): void {
    this.showInfoPanel.set(false);
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

  /**
   * Open a room in the thread pane (e.g. after creating a DM server-side).
   * Pass `externalId` for DMs so the header can resolve the peer label before the
   * room appears in the sidebar list.
   */
  async openRoom(
    roomId: string,
    options?: {
      title?: string | null;
      externalId?: string | null;
      customType?: string | null;
    } | string | null,
  ): Promise<void> {
    const opts =
      typeof options === 'string' || options == null
        ? { title: options }
        : options;

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
      this.showInfoPanel.set(true);
      return;
    }

    const title = opts.title?.trim() || null;
    this.selectedRoom.set({
      id: roomId,
      name: title,
      externalId: opts.externalId ?? null,
      customType: opts.customType ?? (title ? 'demo_group' : 'demo_dm'),
      metadata: null,
      isFrozen: false,
      lastMessage: null,
      createdAt: new Date().toISOString(),
    });
    this.mobileShowThread.set(true);
    this.showInfoPanel.set(true);
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

  headerSubtitle(): string {
    const room = this.selectedRoom();
    const selfId = this.session.session?.chatUserId ?? '';
    if (!room) return '';

    if (this.typingLabel()) {
      return this.typingLabel();
    }

    if (isGroupRoom(room)) {
      const members = this.users.filter((u) => u.id !== selfId);
      const memberCount = Math.max(members.length, 1);
      const online = members.filter((u) => this.onlineUserIds().has(u.id)).length;
      return `${memberCount} members, ${online} online`;
    }

    if (isDirectMessage(room)) {
      const peerId = parseDmPeerId(room.externalId, selfId);
      if (peerId && this.onlineUserIds().has(peerId)) {
        return 'Online';
      }
      return 'Direct message';
    }

    return 'Conversation';
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

  async videoCallMessage(): Promise<void> {
    const roomId = this.selectedRoom()?.id;
    if (!roomId || this.calling() || this.showCallUi()) {
      return;
    }

    this.callError.set(null);

    try {
      await this.calls.startVideoCall(roomId);
      this.callStarted.emit({ roomId, type: 'video' });
    } catch (err) {
      this.callError.set(err instanceof Error ? err.message : 'Failed to start video call');
    }
  }

  async voiceCallMessage(): Promise<void> {
    const roomId = this.selectedRoom()?.id;
    if (!roomId || this.calling() || this.showCallUi()) {
      return;
    }

    this.callError.set(null);

    try {
      await this.calls.startAudioCall(roomId);
      this.callStarted.emit({ roomId, type: 'audio' });
    } catch (err) {
      this.callError.set(err instanceof Error ? err.message : 'Failed to start voice call');
    }
  }

  callOverlayTitle(): string {
    const peer = this.callPeerUser();
    if (peer?.displayName) {
      return peer.displayName;
    }
    const active = this.calls.activeCall();
    const invite = this.calls.incomingInvite();
    const roomId = active?.roomId ?? invite?.roomId;
    if (roomId && this.selectedRoom()?.id === roomId) {
      return this.roomTitle();
    }
    return active?.type === 'audio' || invite?.type === 'audio' ? 'Voice call' : 'Video call';
  }

  callOverlayAvatarUrl(): string | null {
    return this.callPeerUser()?.avatarUrl ?? null;
  }

  callOverlayInitials(): string {
    const peer = this.callPeerUser();
    if (peer) {
      return initialsFor(peer.displayName);
    }
    return initialsFor(this.callOverlayTitle());
  }

  async onCallRedial(event: SendsarCallRedialEvent): Promise<void> {
    if (this.calling() || this.showCallUi()) {
      this.callError.set('A call is already in progress');
      return;
    }
    this.callError.set(null);
    try {
      await this.calls.startCallOfType(event.roomId, event.type);
      this.callStarted.emit(event);
    } catch (err) {
      this.callError.set(err instanceof Error ? err.message : 'Failed to start call');
    }
  }

  private callPeerUser(): UserDirectoryEntry | null {
    const selfId = this.session.session?.chatUserId ?? '';
    const map = userDirectoryMap(this.users);
    const invite = this.calls.incomingInvite();
    if (invite?.createdByUserId && invite.createdByUserId !== selfId) {
      const fromInvite = map.get(invite.createdByUserId);
      if (fromInvite) return fromInvite;
    }

    const room = this.selectedRoom();
    const roomId = this.calls.activeCall()?.roomId ?? invite?.roomId;
    if (room && roomId === room.id && isDirectMessage(room)) {
      const peerId = parseDmPeerId(room.externalId, selfId);
      if (peerId) {
        return map.get(peerId) ?? { id: peerId, displayName: peerId };
      }
    }
    return null;
  }

  private wireRealtime(): void {
    const client = this.session.client;
    if (!client) return;

    this.realtimeWired = true;
    this.calls.ensureReady();

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
