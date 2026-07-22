import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  createRoomSubscription,
  isMessageReadByPeer,
  mergeMessagesById,
  parseCallLogPart,
  textFromMessageParts,
  type CallLogData,
  type Message,
  type MessagePart,
  type RoomSubscription,
  type TenantChatSettings,
} from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { filePartUrl, fileParts, filePreviewFromPart, isAudioPart, isImagePart, messagePreview, preserveFileAccessUrls } from '../../utils/message-parts';
import { segmentTextWithEmoji, type TextSegment } from '../../utils/emoji-segments';
import { getCachedRoomThread, setCachedRoomThread } from '../../utils/room-thread-cache';
import { displayNameFor, initialsFor, userDirectoryMap, type UserDirectoryEntry } from '../../utils/user-directory';
import { SendsarAnimatedEmojiComponent } from '../mini-components/sendsar-animated-emoji/sendsar-animated-emoji.component';
import { SendsarCallLogBubbleComponent } from '../mini-components/sendsar-call-log-bubble/sendsar-call-log-bubble.component';
import { SendsarEmojiPickerComponent } from '../mini-components/sendsar-emoji-picker/sendsar-emoji-picker.component';
import { SendsarFilePreviewComponent } from '../mini-components/sendsar-file-preview/sendsar-file-preview.component';
import { SendsarVoiceMessageComponent } from '../mini-components/sendsar-voice-message/sendsar-voice-message.component';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉'] as const;

export type SendsarCallRedialEvent = {
  roomId: string;
  type: 'audio' | 'video';
};

@Component({
  selector: 'sc-message-list',
  standalone: true,
  imports: [
    CommonModule,
    SendsarAnimatedEmojiComponent,
    SendsarCallLogBubbleComponent,
    SendsarEmojiPickerComponent,
    SendsarFilePreviewComponent,
    SendsarVoiceMessageComponent,
  ],
  templateUrl: './sendsar-message-list.component.html',
  styleUrl: './sendsar-message-list.component.css',
})
export class SendsarMessageListComponent implements OnChanges, OnDestroy {
  private readonly session = inject(SendsarSessionService);
  private readonly chat = inject(SendsarChatService);
  private subscription: RoomSubscription | null = null;

  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;

  @Input({ required: true }) roomId!: string;
  @Input() isGroup = false;
  @Input() users: UserDirectoryEntry[] = [];
  @Input() chatSettings: TenantChatSettings | null = null;
  @Output() readonly activity = new EventEmitter<void>();
  readonly callRedial = output<SendsarCallRedialEvent>();
  readonly editRequested = output<Message>();

  readonly messages = signal<Message[]>([]);
  readonly loading = signal(false);
  readonly loadingOlder = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly peerLastReadAt = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly quickReactions = QUICK_REACTIONS;
  readonly skeletonBubbles = [0, 1, 2, 3];
  readonly contextMenu = signal<{ message: Message; x: number; y: number } | null>(null);
  readonly contextEmojiExpanded = signal(false);
  readonly hoveredMessageId = signal<string | null>(null);
  readonly hoverEmojiExpanded = signal(false);
  readonly showScrollDown = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
      this.bindRoom();
    }
  }

  ngOnDestroy(): void {
    this.subscription?.destroy();
  }

  preview(message: Message): string {
    const placeholder = this.chatSettings?.deletedMessagePlaceholder ?? 'Message deleted';
    return messagePreview(message, placeholder, this.session.session?.chatUserId);
  }

  /** Show a day chip when this message starts a new calendar day. */
  showDateSeparator(index: number): boolean {
    const list = this.messages();
    const message = list[index];
    if (!message || message.deletedHidden) return false;

    const prevVisible = this.previousVisibleMessage(list, index);
    if (!prevVisible) return true;
    return this.dayKey(message.createdAt) !== this.dayKey(prevVisible.createdAt);
  }

  dateLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const key = this.dayKey(iso);
    if (key === this.localDayKey(today)) return 'Today';
    if (key === this.localDayKey(yesterday)) return 'Yesterday';

    const sameYear = date.getFullYear() === today.getFullYear();
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  }

  private previousVisibleMessage(list: Message[], index: number): Message | null {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (!list[i]?.deletedHidden) return list[i];
    }
    return null;
  }

  private dayKey(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return this.localDayKey(date);
  }

  private localDayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  callLog(message: Message): CallLogData | null {
    return parseCallLogPart(message.parts);
  }

  selfUserId(): string | null {
    return this.session.session?.chatUserId ?? null;
  }

  onCallRedial(type: 'audio' | 'video'): void {
    if (!this.roomId) return;
    this.callRedial.emit({ roomId: this.roomId, type });
  }

  textParts(parts: MessagePart[]): MessagePart[] {
    return parts.filter((p) => p.type === 'text' && p.text);
  }

  textSegments(text: string): TextSegment[] {
    return segmentTextWithEmoji(text);
  }

  attachmentParts(parts: MessagePart[]): MessagePart[] {
    return fileParts(parts);
  }

  isSelf(message: Message): boolean {
    const userId = this.session.session?.chatUserId;
    return Boolean(userId && message.senderId === userId);
  }

  senderName(message: Message): string {
    return displayNameFor(message.senderId, userDirectoryMap(this.users));
  }

  avatarInitials(message: Message): string {
    return initialsFor(this.senderName(message));
  }

  selfInitials(): string {
    const userId = this.session.session?.chatUserId;
    if (!userId) return '?';
    return initialsFor(displayNameFor(userId, userDirectoryMap(this.users)));
  }

  isRead(message: Message): boolean {
    const userId = this.session.session?.chatUserId;
    if (!userId) return false;
    return isMessageReadByPeer(message, userId, this.peerLastReadAt());
  }

  reactionSummary(message: Message): { emoji: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const r of message.reactions ?? []) {
      counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    }
    return [...counts.entries()].map(([emoji, count]) => ({ emoji, count }));
  }

  async loadOlder(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingOlder() || !this.roomId) return;

    const el = this.scrollContainer?.nativeElement;
    const prevHeight = el?.scrollHeight ?? 0;

    this.loadingOlder.set(true);
    try {
      const { messages, nextCursor } = await this.chat.getMessages(this.roomId, {
        cursor,
        limit: 50,
      });
      const chronological = [...messages].reverse();
      this.messages.update((list) => mergeMessagesById(chronological, list));
      this.nextCursor.set(nextCursor);
      this.persistThreadCache();

      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight - prevHeight;
        }
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load older messages');
    } finally {
      this.loadingOlder.set(false);
    }
  }

  async deleteMessage(message: Message): Promise<void> {
    if (!this.isSelf(message) || message.deletedAt) return;
    try {
      await this.chat.deleteMessage(this.roomId, message.id);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to delete message');
    }
  }

  async react(message: Message, emoji: string): Promise<void> {
    try {
      await this.chat.toggleReaction(this.roomId, message.id, { emoji });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to react');
    }
  }

  onMessageHover(messageId: string): void {
    if (this.hoveredMessageId() !== messageId) {
      this.hoverEmojiExpanded.set(false);
    }
    this.hoveredMessageId.set(messageId);
  }

  onMessageLeave(messageId: string): void {
    if (this.hoveredMessageId() === messageId) {
      this.hoveredMessageId.set(null);
      this.hoverEmojiExpanded.set(false);
    }
  }

  toggleHoverEmojiList(event: Event): void {
    event.stopPropagation();
    this.hoverEmojiExpanded.update((expanded) => !expanded);
  }

  reactFromHover(message: Message, emoji: string): void {
    void this.react(message, emoji);
    this.hoverEmojiExpanded.set(false);
    this.hoveredMessageId.set(null);
  }

  onMessageContextMenu(event: MouseEvent, message: Message): void {
    if (message.deletedAt) return;
    event.preventDefault();
    event.stopPropagation();
    // Clamp so the menu stays inside the viewport.
    const menuWidth = 220;
    const menuHeight = 320;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
    this.contextEmojiExpanded.set(false);
    this.hoverEmojiExpanded.set(false);
    this.hoveredMessageId.set(null);
    this.contextMenu.set({ message, x, y });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
    this.contextEmojiExpanded.set(false);
  }

  toggleContextEmojiList(): void {
    this.contextEmojiExpanded.update((expanded) => !expanded);
  }

  reactFromMenu(message: Message, emoji: string): void {
    void this.react(message, emoji);
    this.closeContextMenu();
  }

  copyMessageText(message: Message): void {
    const text = textFromMessageParts(message.parts);
    if (text) {
      void navigator.clipboard?.writeText(text);
    }
    this.closeContextMenu();
  }

  editFromMenu(message: Message): void {
    this.closeContextMenu();
    if (!this.isSelf(message) || message.deletedAt) return;
    this.editRequested.emit(message);
  }

  deleteFromMenu(message: Message): void {
    this.closeContextMenu();
    void this.deleteMessage(message);
  }

  protected readonly filePartUrl = filePartUrl;
  protected readonly filePreviewFromPart = filePreviewFromPart;
  protected readonly isImagePart = isImagePart;
  protected readonly isAudioPart = isAudioPart;

  private bindRoom(): void {
    this.subscription?.destroy();
    this.error.set(null);
    this.showScrollDown.set(false);

    const roomId = this.roomId;
    const cached = roomId ? getCachedRoomThread(roomId) : undefined;
    if (cached) {
      this.messages.set(cached.messages);
      this.nextCursor.set(cached.nextCursor);
      this.peerLastReadAt.set(cached.peerLastReadAt);
      this.loading.set(false);
    } else {
      this.messages.set([]);
      this.nextCursor.set(null);
      this.peerLastReadAt.set(null);
      this.loading.set(true);
    }

    const client = this.session.client;
    const userId = this.session.session?.chatUserId;
    if (!client || !userId || !roomId) {
      return;
    }

    this.subscription = createRoomSubscription(client, {
      roomId,
      userId,
      onInitialMessages: (msgs, peerLastReadAt, meta) => {
        if (this.roomId !== roomId) return;
        this.messages.update((list) => mergeMessagesById(list, msgs));
        this.peerLastReadAt.set(peerLastReadAt);
        if (this.nextCursor() == null) {
          this.nextCursor.set(meta?.nextCursor ?? null);
        }
        this.loading.set(false);
        this.persistThreadCache();
        if (!cached) {
          this.scrollToBottom('smooth');
        }
      },
      onMessage: (msg) => {
        if (this.roomId !== roomId) return;
        this.messages.update((list) => mergeMessagesById(list, [msg]));
        this.persistThreadCache();
        this.activity.emit();
        this.scrollToBottom('smooth');
      },
      onMessageUpdated: (msg) => {
        if (this.roomId !== roomId) return;
        this.messages.update((list) =>
          list.map((m) => (m.id === msg.id ? preserveFileAccessUrls(msg, m) : m)),
        );
        this.persistThreadCache();
        this.activity.emit();
        void this.hydrateMissingFileUrls(msg.id);
      },
      onPeerLastReadAt: (lastReadAt) => {
        if (this.roomId !== roomId) return;
        this.peerLastReadAt.set(lastReadAt);
        this.persistThreadCache();
      },
    });

    if (cached) {
      this.scrollToBottom('auto');
    }
  }

  private persistThreadCache(): void {
    if (!this.roomId) return;
    setCachedRoomThread(this.roomId, {
      messages: this.messages(),
      nextCursor: this.nextCursor(),
      peerLastReadAt: this.peerLastReadAt(),
    });
  }

  /** Refetch temporary access URLs when an update left file parts without them. */
  private async hydrateMissingFileUrls(messageId: string): Promise<void> {
    const client = this.session.client;
    if (!client) return;

    const current = this.messages().find((m) => m.id === messageId);
    if (!current) return;
    const needsHydration = current.parts.some(
      (part) => part.type === 'file' && !!part.uploadId && !filePartUrl(part),
    );
    if (!needsHydration) return;

    try {
      const [hydrated] = await client.hydrateFileAccessUrls([current]);
      if (!hydrated || this.roomId !== current.roomId) return;
      this.messages.update((list) => list.map((m) => (m.id === hydrated.id ? hydrated : m)));
      this.persistThreadCache();
    } catch {
      // Keep the preserved/local URLs; preview may still work from cache.
    }
  }

  private scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
    requestAnimationFrame(() => {
      const el = this.scrollContainer?.nativeElement;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      this.showScrollDown.set(false);
    });
  }

  onThreadScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.showScrollDown.set(distanceFromBottom > 120);
  }

  scrollToLatest(): void {
    this.scrollToBottom('smooth');
  }
}
