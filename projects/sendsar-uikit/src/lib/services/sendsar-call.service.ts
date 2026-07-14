import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { CallClient, type CallState } from '@sendsar/call-sdk-javascript';
import type { CallRecord, CallType } from '@sendsar/chat-sdk-javascript';
import { SendsarSessionService } from './sendsar-session.service';

@Injectable()
export class SendsarCallService {
  private readonly session = inject(SendsarSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private client: CallClient | null = null;
  private unsubs: Array<() => void> = [];

  private readonly stateSignal = signal<CallState>('idle');
  private readonly activeCallSignal = signal<CallRecord | null>(null);
  private readonly callingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  readonly callState = this.stateSignal.asReadonly();
  readonly activeCall = this.activeCallSignal.asReadonly();
  readonly calling = this.callingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.destroyClient());
  }

  /** Start a video call in the given room. */
  startVideoCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'video');
  }

  /** Start an audio call in the given room. */
  startAudioCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'audio');
  }

  async hangUp(options?: { reason?: 'cancelled' | 'no_answer' }): Promise<CallRecord | null> {
    const callClient = this.requireCallClient();
    return callClient.hangUp(options);
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    await this.requireCallClient().setCameraEnabled(enabled);
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.requireCallClient().setMicrophoneEnabled(enabled);
  }

  private async startCall(roomId: string, type: CallType): Promise<CallRecord> {
    if (!roomId) {
      throw new Error('roomId is required to start a call');
    }

    if (this.calling() || this.callState() !== 'idle') {
      throw new Error('A call is already in progress');
    }

    this.callingSignal.set(true);
    this.errorSignal.set(null);

    try {
      const callClient = this.requireCallClient();
      const call = await callClient.start(roomId, { type });
      this.activeCallSignal.set(call);
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start call';
      this.errorSignal.set(message);
      throw err;
    } finally {
      this.callingSignal.set(false);
    }
  }

  private requireCallClient(): CallClient {
    const chat = this.session.client;
    if (!chat) {
      throw new Error('Sendsar client is not connected');
    }

    if (!this.client) {
      this.client = new CallClient({ chat });
      this.unsubs.push(
        this.client.on('stateChange', ({ to, call }) => {
          this.stateSignal.set(to);
          this.activeCallSignal.set(call);
        }),
        this.client.on('error', ({ message }) => {
          this.errorSignal.set(message);
        }),
        this.client.on('ended', () => {
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
        }),
      );
    }

    return this.client;
  }

  private destroyClient(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.client?.destroy();
    this.client = null;
    this.stateSignal.set('idle');
    this.activeCallSignal.set(null);
    this.callingSignal.set(false);
  }
}
