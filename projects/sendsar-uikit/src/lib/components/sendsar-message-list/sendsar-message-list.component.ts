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
import { FormsModule } from '@angular/forms';
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
import { filePartUrl, fileParts, filePreviewFromPart, isAudioPart, isImagePart, messagePreview } from '../../utils/message-parts';
import { segmentTextWithEmoji, type TextSegment } from '../../utils/emoji-segments';
import { getCachedRoomThread, setCachedRoomThread } from '../../utils/room-thread-cache';
import { displayNameFor, initialsFor, userDirectoryMap, type UserDirectoryEntry } from '../../utils/user-directory';
import { SendsarAnimatedEmojiComponent } from '../mini-components/sendsar-animated-emoji/sendsar-animated-emoji.component';
import { SendsarCallLogBubbleComponent } from '../mini-components/sendsar-call-log-bubble/sendsar-call-log-bubble.component';
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
    FormsModule,
    SendsarAnimatedEmojiComponent,
    SendsarCallLogBubbleComponent,
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

  readonly messages = signal<Message[]>([]);
  readonly loading = signal(false);
  readonly loadingOlder = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly peerLastReadAt = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  editDraft = '';

  readonly quickReactions = QUICK_REACTIONS;
  readonly skeletonBubbles = [0, 1, 2, 3];

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

  startEdit(message: Message): void {
    if (!this.isSelf(message) || message.deletedAt) return;
    this.editingId.set(message.id);
    this.editDraft = textFromMessageParts(message.parts);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft = '';
  }

  async saveEdit(message: Message): Promise<void> {
    const text = this.editDraft.trim();
    if (!text) return;
    try {
      await this.chat.updateMessage(this.roomId, message.id, {
        parts: [{ type: 'text', text }],
      });
      this.cancelEdit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to edit message');
    }
  }

  async deleteMessage(message: Message): Promise<void> {
    if (!this.isSelf(message) || message.deletedAt) return;
    if (!confirm('Delete this message?')) return;
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

  protected readonly filePartUrl = filePartUrl;
  protected readonly filePreviewFromPart = filePreviewFromPart;
  protected readonly isImagePart = isImagePart;
  protected readonly isAudioPart = isAudioPart;

  private bindRoom(): void {
    this.subscription?.destroy();
    this.error.set(null);
    this.cancelEdit();

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
        this.messages.update((list) => list.map((m) => (m.id === msg.id ? msg : m)));
        this.persistThreadCache();
        this.activity.emit();
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

  private scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
    requestAnimationFrame(() => {
      const el = this.scrollContainer?.nativeElement;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }
}
