import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  SendsarVoicePlaybackData,
  buildVoiceWaveformFromUrl,
} from '../../../utils/voice-waveform';
import { SendsarVoicePreviewComponent } from '../sendsar-voice-preview/sendsar-voice-preview.component';

@Component({
  selector: 'sc-voice-message',
  standalone: true,
  imports: [CommonModule, SendsarVoicePreviewComponent],
  templateUrl: './sendsar-voice-message.component.html',
  styleUrl: './sendsar-voice-message.component.css',
})
export class SendsarVoiceMessageComponent implements OnInit {
  @Input({ required: true }) url!: string;
  @Input({ required: true }) recordedAt!: string | Date;

  readonly voice = signal<SendsarVoicePlaybackData | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);

  ngOnInit(): void {
    void this.loadVoice();
  }

  private async loadVoice(): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);

    try {
      const { waveform, durationSeconds } = await buildVoiceWaveformFromUrl(this.url, 0, 40);
      this.voice.set({
        previewUrl: this.url,
        durationSeconds,
        recordedAt: this.recordedAt instanceof Date ? this.recordedAt : new Date(this.recordedAt),
        waveform,
      });
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
