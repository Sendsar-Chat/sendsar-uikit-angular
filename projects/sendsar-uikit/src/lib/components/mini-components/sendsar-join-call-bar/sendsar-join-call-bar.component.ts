import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { SendsarCallService } from '../../../services/sendsar-call.service';

/**
 * Telegram-style Join bar for an ongoing call in the open room when the
 * local user is not already in that call.
 */
@Component({
  selector: 'sc-join-call-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-join-call-bar.component.html',
  styleUrl: './sendsar-join-call-bar.component.css',
})
export class SendsarJoinCallBarComponent {
  readonly calls = inject(SendsarCallService);

  label(): string {
    const call = this.calls.joinableCall();
    if (!call) {
      return 'Ongoing call';
    }
    if (call.status.toLowerCase() === 'ringing') {
      return call.type === 'audio' ? 'Incoming voice call' : 'Incoming video call';
    }
    return call.type === 'audio' ? 'Ongoing voice call' : 'Ongoing video call';
  }

  async join(): Promise<void> {
    try {
      await this.calls.joinOngoingCall();
    } catch {
      // Error surfaced via calls.error / shell toast.
    }
  }
}
