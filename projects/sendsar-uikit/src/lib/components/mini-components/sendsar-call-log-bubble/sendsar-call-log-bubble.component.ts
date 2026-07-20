import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  formatCallLogPreview,
  isMissedCallLog,
  type CallLogData,
} from '@sendsar/chat-sdk-javascript';

@Component({
  selector: 'sc-call-log-bubble',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-call-log-bubble.component.html',
  styleUrl: './sendsar-call-log-bubble.component.css',
})
export class SendsarCallLogBubbleComponent {
  @Input({ required: true }) data!: CallLogData;
  @Input() selfUserId: string | null = null;
  @Output() readonly redial = new EventEmitter<'audio' | 'video'>();

  label(): string {
    return formatCallLogPreview(this.data, this.selfUserId ?? undefined);
  }

  missed(): boolean {
    if (!this.selfUserId) {
      return this.data.outcome === 'missed';
    }
    return isMissedCallLog(this.data, this.selfUserId);
  }

  icon(): string {
    if (this.missed()) {
      return 'phone_missed';
    }
    return this.data.callType === 'video' ? 'videocam' : 'call';
  }

  onActivate(): void {
    this.redial.emit(this.data.callType);
  }
}
