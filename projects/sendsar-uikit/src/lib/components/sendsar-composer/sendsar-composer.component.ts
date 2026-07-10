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

type PendingVoice = {
  file: File;
  previewUrl: string;
  durationSeconds: number;
  recordedAt: Date;
  waveform: number[];
};

const VOICE_WAVEFORM_MIN_BARS = 48;
const VOICE_WAVEFORM_MAX_BARS = 80;

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
  private mediaRecorder: MediaRecorder | null = null;
  private recordingChunks: Blob[] = [];
  private recordingStream: MediaStream | null = null;
  private recordingTimer: ReturnType<typeof setInterval> | null = null;
  private voiceProgressFrame: number | null = null;

  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('voicePreviewAudio') voicePreviewAudio?: ElementRef<HTMLAudioElement>;

  @Input({ required: true }) roomId!: string;
  @Output() readonly sent = new EventEmitter<void>();

  text = '';
  readonly showEmojiPicker = signal(false);
  readonly sending = signal(false);
  readonly recording = signal(false);
  readonly recordingSeconds = signal(0);
  readonly pendingVoice = signal<PendingVoice | null>(null);
  readonly voicePlaying = signal(false);
  readonly voicePlaybackSeconds = signal(0);
  readonly voicePlaybackProgress = signal(0);
  readonly error = signal<string | null>(null);
  readonly emojiGroups = EMOJI_GROUPS;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']) {
      this.showEmojiPicker.set(false);
      this.clearPendingVoice();
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
    this.stopVoiceProgressLoop();
    this.cancelVoiceRecording();
    this.clearPendingVoice();
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
      this.error.set(err instanceof Error ? err.message : 'Microphone access denied');
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
    const recordedAt = new Date();
    const barCount = this.waveformBarCount(durationSeconds);
    const waveform = await this.buildWaveform(blob, barCount);
    this.pendingVoice.set({
      file,
      previewUrl: URL.createObjectURL(blob),
      durationSeconds,
      recordedAt,
      waveform,
    });
  }

  toggleVoicePreview(): void {
    const audio = this.voicePreviewAudio?.nativeElement;
    if (!audio) {
      return;
    }

    if (this.voicePlaying()) {
      audio.pause();
      this.syncVoicePlaybackState();
      this.voicePlaying.set(false);
      this.stopVoiceProgressLoop();
      return;
    }

    void audio.play().then(() => {
      this.voicePlaying.set(true);
      this.startVoiceProgressLoop();
    });
  }

  onVoicePreviewEnded(): void {
    this.voicePlaying.set(false);
    this.voicePlaybackSeconds.set(0);
    this.voicePlaybackProgress.set(0);
    this.stopVoiceProgressLoop();
  }

  onVoicePreviewTimeUpdate(): void {
    this.syncVoicePlaybackState();
  }

  isVoiceBarActive(barIndex: number, voice: PendingVoice): boolean {
    return barIndex < this.voicePlaybackProgress() * voice.waveform.length;
  }

  seekSecondsForBar(barIndex: number, voice: PendingVoice): number {
    return Math.floor(((barIndex + 0.5) / voice.waveform.length) * voice.durationSeconds);
  }

  seekVoicePreview(barIndex: number, voice: PendingVoice): void {
    if (this.sending() || this.recording()) {
      return;
    }

    const audio = this.voicePreviewAudio?.nativeElement;
    if (!audio) {
      return;
    }

    const duration = audio.duration || voice.durationSeconds;
    if (duration <= 0) {
      return;
    }

    audio.currentTime = ((barIndex + 0.5) / voice.waveform.length) * duration;
    this.syncVoicePlaybackState();

    if (this.voicePlaying()) {
      return;
    }

    void audio.play().then(() => {
      this.voicePlaying.set(true);
      this.startVoiceProgressLoop();
    });
  }

  private startVoiceProgressLoop(): void {
    this.stopVoiceProgressLoop();

    const tick = () => {
      if (!this.voicePlaying()) {
        return;
      }

      this.syncVoicePlaybackState();
      this.voiceProgressFrame = requestAnimationFrame(tick);
    };

    this.voiceProgressFrame = requestAnimationFrame(tick);
  }

  private stopVoiceProgressLoop(): void {
    if (this.voiceProgressFrame !== null) {
      cancelAnimationFrame(this.voiceProgressFrame);
      this.voiceProgressFrame = null;
    }
  }

  private syncVoicePlaybackState(): void {
    const audio = this.voicePreviewAudio?.nativeElement;
    if (!audio) {
      return;
    }

    const duration = audio.duration || this.pendingVoice()?.durationSeconds || 0;
    if (duration <= 0) {
      return;
    }

    this.voicePlaybackSeconds.set(Math.floor(audio.currentTime));
    this.voicePlaybackProgress.set(Math.min(1, audio.currentTime / duration));
  }

  formatVoiceDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  formatVoiceTimestamp(date: Date): string {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  voicePreviewDuration(voice: PendingVoice): number {
    if (this.voicePlaying() || this.voicePlaybackProgress() > 0) {
      return this.voicePlaybackSeconds();
    }

    return voice.durationSeconds;
  }

  private waveformBarCount(durationSeconds: number): number {
    const scaled = Math.round(42 + durationSeconds * 4.5);
    return Math.min(VOICE_WAVEFORM_MAX_BARS, Math.max(VOICE_WAVEFORM_MIN_BARS, scaled));
  }

  private async buildWaveform(blob: Blob, barCount: number): Promise<number[]> {
    try {
      const audioContext = new AudioContext();
      const buffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
      const channel = audioBuffer.getChannelData(0);
      const samplesPerBar = Math.max(1, Math.floor(channel.length / barCount));
      const bars: number[] = [];

      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        const start = i * samplesPerBar;
        for (let j = 0; j < samplesPerBar; j++) {
          sum += Math.abs(channel[start + j] ?? 0);
        }
        bars.push(sum / samplesPerBar);
      }

      const max = Math.max(...bars, 0.01);
      await audioContext.close();
      return bars.map((value) => 0.2 + (value / max) * 0.8);
    } catch {
      return Array.from({ length: barCount }, (_, index) => {
        const wave = Math.abs(Math.sin(index * 0.55) * Math.cos(index * 0.18));
        return 0.25 + wave * 0.75;
      });
    }
  }

  removePendingVoice(): void {
    this.clearPendingVoice();
  }

  private clearPendingVoice(): void {
    const pending = this.pendingVoice();
    if (pending) {
      URL.revokeObjectURL(pending.previewUrl);
    }

    const audio = this.voicePreviewAudio?.nativeElement;
    audio?.pause();
    if (audio) {
      audio.currentTime = 0;
    }

    this.stopVoiceProgressLoop();
    this.voicePlaying.set(false);
    this.voicePlaybackSeconds.set(0);
    this.voicePlaybackProgress.set(0);
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
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
  }

  async submit(): Promise<void> {
    const body = this.text.trim();
    const voice = this.pendingVoice();

    if ((!body && !voice) || this.sending() || this.recording()) {
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    this.typingController?.stop();

    try {
      if (voice) {
        await this.chat.sendFileMessage(this.roomId, {
          file: voice.file,
          clientMessageId: crypto.randomUUID(),
        });
        this.clearPendingVoice();
      }

      if (body) {
        await this.chat.sendMessage(this.roomId, {
          parts: [{ type: 'text', text: body }],
          clientMessageId: crypto.randomUUID(),
        });
        this.text = '';
        queueMicrotask(() => this.resizeTextarea());
      }

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
