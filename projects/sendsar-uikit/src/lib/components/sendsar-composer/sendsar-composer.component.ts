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
import { SendsarCallService } from '../../services/sendsar-call.service';
import { SendsarChatService } from '../../services/sendsar-chat.service';
import { SendsarSessionService } from '../../services/sendsar-session.service';
import {
  SendsarVoicePreviewData,
  buildVoiceWaveform,
  waveformBarCount,
} from '../../utils/voice-waveform';
import {
  SendsarFilePreviewComponent,
  type SendsarFilePreviewData,
} from '../mini-components/sendsar-file-preview/sendsar-file-preview.component';
import { SendsarVoicePreviewComponent } from '../mini-components/sendsar-voice-preview/sendsar-voice-preview.component';
import { SendsarEmojiPickerComponent } from '../mini-components/sendsar-emoji-picker/sendsar-emoji-picker.component';

@Component({
  selector: 'sc-composer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SendsarFilePreviewComponent,
    SendsarVoicePreviewComponent,
    SendsarEmojiPickerComponent,
  ],
  templateUrl: './sendsar-composer.component.html',
  styleUrl: './sendsar-composer.component.css',
})
export class SendsarComposerComponent
  implements OnChanges, OnDestroy, AfterViewInit
{
  private readonly chat = inject(SendsarChatService);
  private readonly calls = inject(SendsarCallService);
  private readonly session = inject(SendsarSessionService);
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private typingController: ComposerTypingController | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingStream: MediaStream | null = null;
  private recordingTimer: ReturnType<typeof setInterval> | null = null;

  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @Input({ required: true }) roomId!: string;
  @Output() readonly sent = new EventEmitter<void>();
  @Output() readonly callStarted = new EventEmitter<{ roomId: string; type: 'video' }>();
  text = '';
  readonly showEmojiPicker = signal(false);
  readonly sending = signal(false);
  readonly recording = signal(false);
  readonly recordingSeconds = signal(0);
  readonly pendingVoice = signal<SendsarVoicePreviewData | null>(null);
  readonly pendingFile = signal<SendsarFilePreviewData | null>(null);
  readonly error = signal<string | null>(null);
  readonly calling = this.calls.calling;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
      this.showEmojiPicker.set(false);
      this.clearPendingVoice();
      this.clearPendingFile();
      this.bindTyping();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showEmojiPicker()) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Node &&
      !this.elementRef.nativeElement.contains(target)
    ) {
      this.showEmojiPicker.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.resizeTextarea();
  }

  ngOnDestroy(): void {
    this.cancelVoiceRecording();
    this.clearPendingVoice();
    this.clearPendingFile();
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
    if (!file || this.sending() || this.recording()) {
      return;
    }

    this.showEmojiPicker.set(false);
    this.error.set(null);
    this.clearPendingVoice();
    this.clearPendingFile();

    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    this.pendingFile.set({
      name: file.name,
      previewUrl,
      mediaType: file.type,
      file,
    });
  }

  removePendingFile(): void {
    this.clearPendingFile();
  }

  pickEmoji(emoji: string): void {
    this.insertEmoji(emoji);
    this.showEmojiPicker.set(false);
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

  async voiceMessage(): Promise<void> {
    if (this.sending()) {
      return;
    }

    if (this.recording()) {
      await this.stopVoiceRecording();

      return;
    }

    await this.startVoiceRecording();
  }

  private async startVoiceRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Voice recording is not supported in this browser.');

      return;
    }

    this.showEmojiPicker.set(false);
    this.error.set(null);
    this.clearPendingVoice();
    this.clearPendingFile();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingStream = stream;
      this.recordingChunks = [];
      const mimeType = this.pickAudioMimeType();
      this.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordingChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
      this.recording.set(true);
      this.recordingSeconds.set(0);
      this.recordingTimer = setInterval(() => {
        this.recordingSeconds.update((seconds) => seconds + 1);
      }, 1000);
    } catch (err) {
      this.cancelVoiceRecording();

      this.error.set(
        err instanceof Error ? err.message : 'Microphone access denied',
      );
    }
  }

  private async stopVoiceRecording(): Promise<void> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }
    const durationSeconds = this.recordingSeconds();
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        resolve(new Blob(this.recordingChunks, { type }));
      };

      recorder.onerror = () => reject(new Error('Recording failed'));
      recorder.stop();
    });

    this.releaseRecordingStream();
    this.mediaRecorder = null;
    this.recordingChunks = [];
    this.recording.set(false);
    this.recordingSeconds.set(0);
    if (blob.size === 0) {
      return;
    }
    const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `voice-message-${Date.now()}.${extension}`, {
      type: blob.type,
    });

    this.clearPendingVoice();
    this.clearPendingFile();
    const recordedAt = new Date();
    const barCount = waveformBarCount(durationSeconds);
    const waveform = await buildVoiceWaveform(blob, barCount);
    this.pendingVoice.set({
      file,
      previewUrl: URL.createObjectURL(blob),
      durationSeconds,
      recordedAt,
      waveform,
    });
  }

  removePendingVoice(): void {
    this.clearPendingVoice();
  }

  private clearPendingFile(): void {
    const pending = this.pendingFile();
    if (pending?.previewUrl) {
      URL.revokeObjectURL(pending.previewUrl);
    }
    this.pendingFile.set(null);
  }

  private clearPendingVoice(): void {
    const pending = this.pendingVoice();
    if (pending) {
      URL.revokeObjectURL(pending.previewUrl);
    }
    this.pendingVoice.set(null);
  }

  private cancelVoiceRecording(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.mediaRecorder = null;
    this.recordingChunks = [];
    this.releaseRecordingStream();
    this.recording.set(false);
    this.recordingSeconds.set(0);
  }

  private releaseRecordingStream(): void {
    this.recordingStream?.getTracks().forEach((track) => track.stop());
    this.recordingStream = null;
  }

  private pickAudioMimeType(): string | undefined {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];

    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
  }

  async videoCallMessage(): Promise<void> {
    if (this.sending() || this.recording() || this.calling() || !this.roomId) {
      return;
    }

    this.showEmojiPicker.set(false);
    this.error.set(null);

    try {
      await this.calls.startVideoCall(this.roomId);
      this.callStarted.emit({ roomId: this.roomId, type: 'video' });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to start video call');
    }
  }

  async submit(): Promise<void> {
    const body = this.text.trim();
    const voice = this.pendingVoice();
    const file = this.pendingFile();
    if ((!body && !voice && !file) || this.sending() || this.recording()) {
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    this.typingController?.stop();
    try {
      const clientMessageId = crypto.randomUUID();
      const attachment = file?.file ?? voice?.file;

      if (attachment) {
        await this.chat.sendFileMessage(this.roomId, {
          file: attachment,
          clientMessageId,
          text: body || undefined,
        });
      } else if (body) {
        await this.chat.sendMessage(this.roomId, {
          parts: [{ type: 'text', text: body }],
          clientMessageId,
        });
      } else {
        return;
      }

      this.text = '';
      this.clearPendingFile();
      this.clearPendingVoice();
      queueMicrotask(() => this.resizeTextarea());
      this.showEmojiPicker.set(false);
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
    const maxHeight =
      Number.parseFloat(getComputedStyle(textarea).maxHeight) || 128;
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
