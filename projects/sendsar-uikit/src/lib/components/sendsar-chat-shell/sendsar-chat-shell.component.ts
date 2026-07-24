import {
  Component,
  DestroyRef,
  EventEmitter,
  HostListener,
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
  type RoomParticipant,
  type RoomParticipantsChangedEvent,
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
import {
  SendsarNewChatDialogComponent,
  type SendsarNewChatRequest,
} from '../sendsar-new-chat-dialog/sendsar-new-chat-dialog.component';
import { SendsarGroupDetailsDialogComponent } from '../sendsar-group-details-dialog/sendsar-group-details-dialog.component';

/**
 * Creates the room on the host backend and returns its id plus optional
 * metadata used to open the thread before it appears in the sidebar.
 */
export type SendsarCreateRoomHandler = (
  request: SendsarNewChatRequest,
  selfId: string,
) => Promise<{
  roomId: string;
  title?: string;
  externalId?: string;
  customType?: string;
}>;
import { SendsarCallService } from '../../services/sendsar-call.service';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { isDirectMessage, isGroupRoom, parseDmPeerId, resolveRoomLabel } from '../../utils/room-label';
import {
  displayNameFor,
  initialsFor,
  userDirectoryMap,
  type UserDirectoryEntry,
} from '../../utils/user-directory';

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
    SendsarNewChatDialogComponent,
    SendsarGroupDetailsDialogComponent,
  ],
  templateUrl: './sendsar-chat-shell.component.html',
  styleUrl: './sendsar-chat-shell.component.css',
})
export class SendsarChatShellComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly calls = inject(SendsarCallService);
  private readonly chat = inject(SendsarChatService);
  readonly session = inject(SendsarSessionService);

  @Input() users: UserDirectoryEntry[] = [];
  /** Overrides the built-in room creation (POST to the BFF `ensure-dm`/`ensure-group` routes). */
  @Input() createRoom?: SendsarCreateRoomHandler;
  @Output() readonly callStarted = new EventEmitter<{ roomId: string; type: 'audio' | 'video' }>();

  @ViewChild(SendsarConversationListComponent)
  private conversationList?: SendsarConversationListComponent;
  @ViewChild(SendsarMessageListComponent)
  private messageList?: SendsarMessageListComponent;

  readonly selectedRoom = signal<RoomSummary | null>(null);
  readonly typingByRoom = signal<TypingByRoom>({});
  readonly onlineUserIds = signal<ReadonlySet<string>>(new Set());
  /** Group participants from `getRoom` for the selected room header subtitle. */
  readonly groupParticipants = signal<RoomParticipant[]>([]);
  readonly mobileShowThread = signal(false);
  readonly showInfoPanel = signal(false);
  readonly calling = this.calls.calling;
  readonly showCallUi = this.calls.showCallUi;
  readonly callError = signal<string | null>(null);
  readonly editingMessage = signal<Message | null>(null);
  readonly replyingToMessage = signal<Message | null>(null);
  readonly showHeaderMenu = signal(false);
  readonly showNewChat = signal(false);
  readonly showGroupDetails = signal(false);
  readonly creatingChat = signal(false);
  readonly newChatError = signal<string | null>(null);

  private realtimeWired = false;
  private presenceTracker: ReturnType<typeof createTenantPresenceTracker> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private participantsLoadToken = 0;

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
    // this.showInfoPanel.set(true);
    this.editingMessage.set(null);
    this.replyingToMessage.set(null);
    this.showGroupDetails.set(false);
    void this.loadGroupParticipants(room);
  }

  onRoomDeleted(roomId: string): void {
    if (this.selectedRoom()?.id === roomId) {
      this.selectedRoom.set(null);
      this.mobileShowThread.set(false);
      this.showInfoPanel.set(false);
      this.showGroupDetails.set(false);
      this.groupParticipants.set([]);
    }
    void this.conversationList?.reload();
  }

  onHistoryCleared(roomId: string): void {
    if (this.selectedRoom()?.id === roomId) {
      this.messageList?.reloadFromServer();
    }
    void this.conversationList?.reload();
  }

  onEditRequested(message: Message): void {
    this.replyingToMessage.set(null);
    this.editingMessage.set(message);
  }

  onReplyRequested(message: Message): void {
    this.editingMessage.set(null);
    this.replyingToMessage.set(message);
  }

  toggleHeaderMenu(event: Event): void {
    event.stopPropagation();
    this.showHeaderMenu.update((open) => !open);
  }

  onSidebarNewChat(): void {
    this.newChatError.set(null);
    this.showNewChat.set(true);
  }

  closeNewChat(): void {
    this.showNewChat.set(false);
    this.newChatError.set(null);
  }

  async onNewChat(request: SendsarNewChatRequest): Promise<void> {
    const selfId = this.session.session?.chatUserId;
    if (!selfId) return;
    const handler = this.createRoom ?? this.defaultCreateRoom;

    this.creatingChat.set(true);
    this.newChatError.set(null);
    try {
      const { roomId, ...openOpts } = await handler(request, selfId);
      this.closeNewChat();
      await this.openRoom(roomId, openOpts);
    } catch (err) {
      this.newChatError.set(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      this.creatingChat.set(false);
    }
  }

  /** Default room creation against the host BFF (`/api/chat/demo/ensure-*` routes). */
  private readonly defaultCreateRoom: SendsarCreateRoomHandler = async (request, selfId) => {
    if (request.kind === 'direct') {
      const roomId = await this.postForRoomId('/api/chat/demo/ensure-dm', {
        selfId,
        peerId: request.peerId,
        members: this.directoryMembers(),
      });
      return {
        roomId,
        externalId: `dm:${[selfId, request.peerId].sort().join(':')}`,
        customType: 'demo_dm',
      };
    }
    const roomId = await this.postForRoomId('/api/chat/demo/ensure-group', {
      selfId,
      name: request.name,
      memberIds: request.memberIds,
      members: this.directoryMembers(),
    });
    return { roomId, title: request.name, customType: 'demo_group' };
  };

  /** The BFF ensure routes expect `{ chatUserId, displayName }` member records. */
  private directoryMembers(): Array<{ chatUserId: string; displayName: string }> {
    return this.users.map((u) => ({ chatUserId: u.id, displayName: u.displayName }));
  }

  private async postForRoomId(url: string, body: unknown): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `Create room failed: ${res.status}`);
    }
    const { roomId } = (await res.json()) as { roomId: string };
    return roomId;
  }

  onHeaderRoomDetails(): void {
    this.showHeaderMenu.set(false);
    // this.showInfoPanel.set(true);
  }

  onHeaderIdentityClick(): void {
    if (!this.roomIsGroup()) return;
    this.showGroupDetails.set(true);
  }

  closeGroupDetails(): void {
    this.showGroupDetails.set(false);
  }

  onGroupMembersChanged(participants: RoomParticipant[]): void {
    this.groupParticipants.set(participants);
  }

  onLeftGroup(roomId: string): void {
    this.showGroupDetails.set(false);
    if (this.selectedRoom()?.id === roomId) {
      this.selectedRoom.set(null);
      this.groupParticipants.set([]);
      this.mobileShowThread.set(false);
    }
    void this.conversationList?.reload();
  }

  @HostListener('document:click')
  closeHeaderMenu(): void {
    if (this.showHeaderMenu()) {
      this.showHeaderMenu.set(false);
    }
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
      // this.showInfoPane.set(true);
      void this.loadGroupParticipants(room);
      return;
    }

    const title = opts.title?.trim() || null;
    const fallbackRoom: RoomSummary = {
      id: roomId,
      name: title,
      externalId: opts.externalId ?? null,
      customType: opts.customType ?? (title ? 'demo_group' : 'demo_dm'),
      metadata: null,
      isFrozen: false,
      lastMessage: null,
      createdAt: new Date().toISOString(),
    };
    this.selectedRoom.set(fallbackRoom);
    this.mobileShowThread.set(true);
    // this.showInfoPane.set(true);
    void this.loadGroupParticipants(fallbackRoom);
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

  /** True when the active/incoming call is in a group room (Meet grid). */
  callIsGroup(): boolean {
    const callRoomId =
      this.calls.activeCall()?.roomId ?? this.calls.incomingInvite()?.roomId;
    const room = this.selectedRoom();
    if (room && (callRoomId == null || callRoomId === room.id)) {
      return isGroupRoom(room);
    }
    return false;
  }

  readonly callIdentityLabel = (identity: string): string => {
    const colon = identity.lastIndexOf(':');
    const userId = colon >= 0 ? identity.slice(colon + 1) : identity;
    return displayNameFor(userId, userDirectoryMap(this.users));
  };

  headerSubtitle(): string {
    const room = this.selectedRoom();
    const selfId = this.session.session?.chatUserId ?? '';
    if (!room) return '';

    if (this.typingLabel()) {
      return this.typingLabel();
    }

    if (isGroupRoom(room)) {
      const members = this.groupParticipants();
      const memberCount = members.length;
      const online = members.filter((p) => this.onlineUserIds().has(p.userId)).length;
      if (memberCount === 0) {
        return 'Group';
      }
      return `${memberCount} members, ${online} online`;
    }

    if (isDirectMessage(room)) {
      const peerId = parseDmPeerId(room.externalId, selfId);
      if (peerId && this.onlineUserIds().has(peerId)) {
        return 'Online';
      }
      return '';
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

  private async loadGroupParticipants(room: RoomSummary | null): Promise<void> {
    const token = ++this.participantsLoadToken;
    if (!room || !isGroupRoom(room)) {
      this.groupParticipants.set([]);
      return;
    }

    try {
      const detail = await this.chat.getRoom(room.id);
      if (token !== this.participantsLoadToken) return;
      this.groupParticipants.set(detail.participants);
    } catch {
      if (token !== this.participantsLoadToken) return;
      this.groupParticipants.set([]);
    }
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

    const offRoster = client.on(
      SOCKET_EVENT.ROOM_PARTICIPANTS_CHANGED,
      (event: RoomParticipantsChangedEvent) => {
        this.onRoomParticipantsChanged(event);
      },
    );

    this.presenceTracker = createTenantPresenceTracker(client);
    const offPresence = this.presenceTracker.subscribe((ids) => {
      this.onlineUserIds.set(ids);
    });

    this.destroyRef.onDestroy(() => {
      offTyping();
      offMessage();
      offUpdated();
      offRoster();
      offPresence();
      this.presenceTracker?.destroy();
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
    });
  }

  private onRoomParticipantsChanged(event: RoomParticipantsChangedEvent): void {
    const selfId = this.session.session?.chatUserId;
    if (
      selfId &&
      event.targetUserId === selfId &&
      (event.action === 'removed' || event.action === 'left')
    ) {
      this.onRoomDeleted(event.roomId);
      return;
    }
    const selected = this.selectedRoom();
    if (selected?.id === event.roomId) {
      void this.loadGroupParticipants(selected);
    }
    this.scheduleSidebarReload();
  }

  private scheduleSidebarReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      void this.conversationList?.reload();
    }, 800);
  }
}
