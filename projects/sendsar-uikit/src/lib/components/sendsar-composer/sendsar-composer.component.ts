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
import { ComposerTypingController } from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import { SendsarAnimatedEmojiComponent } from '../sendsar-animated-emoji/sendsar-animated-emoji.component';

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
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  @Input({ required: true }) roomId!: string;
  @Output() readonly sent = new EventEmitter<void>();

  text = '';
  readonly showEmojiPicker = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly emojiGroups = EMOJI_GROUPS;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
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

  toggleEmojiPicker(event: Event): void {
    event.stopPropagation();
    this.showEmojiPicker.update((v) => !v);
  }

  openFilePicker(): void {
    this.showEmojiPicker.set(false);
    this.fileInput?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.sending()) {
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    this.typingController?.stop();

    try {
      await this.chat.sendFileMessage(this.roomId, {
        file,
        clientMessageId: crypto.randomUUID(),
        onProgress: (percent) => console.log(`Upload ${percent}%`),
      });
      this.sent.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to send file');
    } finally {
      this.sending.set(false);
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

  async submit(): Promise<void> {
    const body = this.text.trim();

    if (!body || this.sending()) {
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    this.typingController?.stop();

    try {
      await this.chat.sendMessage(this.roomId, {
        parts: [{ type: 'text', text: body }],
        clientMessageId: crypto.randomUUID(),
      });
      this.text = '';
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
}
