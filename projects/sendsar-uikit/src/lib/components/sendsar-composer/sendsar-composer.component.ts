import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { MessagePart } from '@sendsar/chat-sdk-javascript';
import { ComposerTypingController } from '@sendsar/chat-sdk-javascript';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';

const MAX_IMAGE_BYTES = 200_000;

@Component({
  selector: 'sc-composer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sendsar-composer.component.html',
  styleUrl: './sendsar-composer.component.css',
})
export class SendsarComposerComponent implements OnChanges, OnDestroy {
  private readonly chat = inject(SendsarChatService);
  private readonly session = inject(SendsarSessionService);
  private typingController: ComposerTypingController | null = null;

  @Input({ required: true }) roomId!: string;
  @Output() readonly sent = new EventEmitter<void>();

  text = '';
  attachUrl = '';
  readonly showAttach = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly pendingFile = signal<{ url: string; mediaType: string; filename: string } | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
      this.resetAttachment();
      this.bindTyping();
    }
  }

  ngOnDestroy(): void {
    this.typingController?.destroy();
  }

  onTextChange(): void {
    this.typingController?.onValueChange(this.text);
  }

  toggleAttach(): void {
    this.showAttach.update((v) => !v);
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
      this.sent.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      this.sending.set(false);
    }
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
