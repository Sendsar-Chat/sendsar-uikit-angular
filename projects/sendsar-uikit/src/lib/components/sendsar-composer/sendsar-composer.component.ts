import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { MessagePart } from '@sendsar/chat-sdk-javascript';
import { ComposerTypingController } from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { SendsarAnimatedEmojiComponent } from '../sendsar-animated-emoji/sendsar-animated-emoji.component';

const MAX_IMAGE_BYTES = 200_000;
const EMOJI_GROUPS = [
  {
    label: 'Popular',
    emojis: ['👍', '❤️', '😂', '🔥', '🙏', '👏', '😭', '😍', '🎉', '😊', '✨', '🤔'],
  },
  {
    label: 'Smileys',
    emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🥳', '😭', '😡', '🤔'],
  },
  {
    label: 'People',
    emojis: ['🙌', '👋', '👌', '💪', '🤝', '👀', '✅', '❌', '👎', '🙏', '👏', '👍'],
  },
  {
    label: 'Hearts & Symbols',
    emojis: ['❤️', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '⭐', '✨', '🔥', '🎯'],
  },
  {
    label: 'Celebration',
    emojis: ['🎉', '🥳', '🎊', '🙌', '👏', '🍾', '🏆', '🚀', '🌟', '🎂', '🎁', '🍀'],
  },
] as const;

@Component({
  selector: 'sc-composer',
  standalone: true,
  imports: [CommonModule, FormsModule, SendsarAnimatedEmojiComponent],
  templateUrl: './sendsar-composer.component.html',
  styleUrl: './sendsar-composer.component.css',
})
export class SendsarComposerComponent implements OnChanges, OnDestroy, AfterViewInit {
  private readonly chat = inject(SendsarChatService);
  private readonly session = inject(SendsarSessionService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private typingController: ComposerTypingController | null = null;

  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;

  @Input({ required: true }) roomId!: string;
  @Output() readonly sent = new EventEmitter<void>();

  text = '';
  attachUrl = '';
  readonly showAttach = signal(false);
  readonly showEmojiPicker = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly pendingFile = signal<{ url: string; mediaType: string; filename: string } | null>(null);
  readonly emojiGroups = EMOJI_GROUPS;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
      this.resetAttachment();
      this.showEmojiPicker.set(false);
      this.bindTyping();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showEmojiPicker()) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && !this.elementRef.nativeElement.contains(target)) {
      this.showEmojiPicker.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.resizeTextarea();
  }

  ngOnDestroy(): void {
    this.typingController?.destroy();
  }

  onTextChange(): void {
    this.typingController?.onValueChange(this.text);
    this.resizeTextarea();
  }

  onEnterKey(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void this.submit();
  }

  toggleAttach(): void {
    this.showAttach.update((v) => !v);
    if (this.showAttach()) {
      this.showEmojiPicker.set(false);
    }
  }

  toggleEmojiPicker(event: Event): void {
    event.stopPropagation();
    this.showEmojiPicker.update((v) => !v);
    if (this.showEmojiPicker()) {
      this.showAttach.set(false);
    }
  }

  pickEmoji(emoji: string): void {
    this.insertEmoji(emoji);
    this.showEmojiPicker.set(false);
  }

  isSystemDarkMode(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private insertEmoji(emoji: string): void {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) {
      this.text += emoji;
      this.onTextChange();
      return;
    }

    const start = textarea.selectionStart ?? this.text.length;
    const end = textarea.selectionEnd ?? this.text.length;
    this.text = `${this.text.slice(0, start)}${emoji}${this.text.slice(end)}`;
    this.onTextChange();

    const caret = start + emoji.length;
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.error.set('Demo only supports image uploads. Use a URL for other files.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.error.set('Image too large for demo (max 200 KB). Paste a hosted URL instead.');
      return;
    }

    const url = await this.readFileAsDataUrl(file);
    this.pendingFile.set({
      url,
      mediaType: file.type,
      filename: file.name,
    });
    this.showAttach.set(true);
    this.error.set(null);
  }

  clearAttachment(): void {
    this.pendingFile.set(null);
    this.attachUrl = '';
  }

  private resetAttachment(): void {
    this.clearAttachment();
    this.showAttach.set(false);
  }

  async submit(): Promise<void> {
    const body = this.text.trim();
    const urlAttachment = this.attachUrl.trim();
    const file = this.pendingFile();

    if ((!body && !file && !urlAttachment) || this.sending()) {
      return;
    }

    const parts: MessagePart[] = [];
    if (body) {
      parts.push({ type: 'text', text: body });
    }
    if (file) {
      parts.push({
        type: 'file',
        url: file.url,
        mediaType: file.mediaType,
        filename: file.filename,
      });
    } else if (urlAttachment) {
      parts.push({
        type: 'file',
        url: urlAttachment,
        mediaType: this.guessMediaType(urlAttachment),
        filename: this.filenameFromUrl(urlAttachment),
      });
    }

    this.sending.set(true);
    this.error.set(null);
    this.typingController?.stop();

    try {
      await this.chat.sendMessage(this.roomId, {
        parts,
        clientMessageId: crypto.randomUUID(),
      });
      this.text = '';
      this.resetAttachment();
      this.showEmojiPicker.set(false);
      queueMicrotask(() => this.resizeTextarea());
      this.sent.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      this.sending.set(false);
    }
  }

  private resizeTextarea(): void {
    const textarea = this.messageInput?.nativeElement;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(textarea).maxHeight) || 128;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
  }

  private bindTyping(): void {
    this.typingController?.destroy();
    const client = this.session.client;
    if (!client || !this.roomId) {
      this.typingController = null;
      return;
    }
    this.typingController = new ComposerTypingController(client, this.roomId);
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private guessMediaType(url: string): string {
    const lower = url.toLowerCase();
    if (lower.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/)) {
      return 'image/*';
    }
    return 'application/octet-stream';
  }

  private filenameFromUrl(url: string): string {
    try {
      const path = new URL(url).pathname;
      const name = path.split('/').pop();
      return name || 'attachment';
    } catch {
      return 'attachment';
    }
  }
}
