import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SendsarVoicePlaybackData } from '../../../utils/voice-waveform';

@Component({
  selector: 'sc-voice-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-voice-preview.component.html',
  styleUrl: './sendsar-voice-preview.component.css',
})
export class SendsarVoicePreviewComponent implements OnDestroy {
  @ViewChild('audioEl') audioEl?: ElementRef<HTMLAudioElement>;

  @Input({ required: true }) voice!: SendsarVoicePlaybackData;
  @Input() disabled = false;
  @Input() removable = true;
  @Output() readonly removed = new EventEmitter<void>();

  readonly playing = signal(false);
  readonly playbackSeconds = signal(0);
  readonly playbackProgress = signal(0);
  readonly listened = signal(false);

  private progressFrame: number | null = null;

  ngOnDestroy(): void {
    this.stopProgressLoop();
    this.audioEl?.nativeElement.pause();
  }

  togglePlayback(): void {
    const audio = this.audioEl?.nativeElement;
    if (!audio || this.disabled) {
      return;
    }

    if (this.playing()) {
      audio.pause();
      this.syncPlaybackState();
      this.playing.set(false);
      this.stopProgressLoop();
      return;
    }

    void audio.play().then(() => {
      this.playing.set(true);
      this.startProgressLoop();
    });
  }

  seekToBar(barIndex: number): void {
    if (this.disabled) {
      return;
    }

    const audio = this.audioEl?.nativeElement;
    if (!audio) {
      return;
    }

    const duration = audio.duration || this.voice.durationSeconds;
    if (duration <= 0) {
      return;
    }

    audio.currentTime = ((barIndex + 0.5) / this.voice.waveform.length) * duration;
    this.syncPlaybackState();

    if (this.playing()) {
      return;
    }

    void audio.play().then(() => {
      this.playing.set(true);
      this.startProgressLoop();
    });
  }

  onEnded(): void {
    this.playing.set(false);
    this.playbackSeconds.set(0);
    this.playbackProgress.set(0);
    this.listened.set(true);
    this.stopProgressLoop();
  }

  syncPlaybackState(): void {
    const audio = this.audioEl?.nativeElement;
    if (!audio) {
      return;
    }

    const duration = audio.duration || this.voice.durationSeconds;
    if (duration <= 0) {
      return;
    }

    this.playbackSeconds.set(Math.floor(audio.currentTime));
    this.playbackProgress.set(Math.min(1, audio.currentTime / duration));
  }

  isBarActive(barIndex: number): boolean {
    return barIndex < this.playbackProgress() * this.voice.waveform.length;
  }

  seekSecondsForBar(barIndex: number): number {
    return Math.floor(((barIndex + 0.5) / this.voice.waveform.length) * this.voice.durationSeconds);
  }

  displayDuration(): number {
    if (this.playing() || this.playbackProgress() > 0) {
      return this.playbackSeconds();
    }

    return this.voice.durationSeconds;
  }

  formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  formatTimestamp(date: Date): string {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  private startProgressLoop(): void {
    this.stopProgressLoop();

    const tick = () => {
      if (!this.playing()) {
        return;
      }

      this.syncPlaybackState();
      this.progressFrame = requestAnimationFrame(tick);
    };

    this.progressFrame = requestAnimationFrame(tick);
  }

  private stopProgressLoop(): void {
    if (this.progressFrame !== null) {
      cancelAnimationFrame(this.progressFrame);
      this.progressFrame = null;
    }
  }
}
