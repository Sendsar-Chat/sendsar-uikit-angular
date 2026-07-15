import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { CallClient, type CallState } from '@sendsar/call-sdk-javascript';
import type { CallRecord, CallType } from '@sendsar/chat-sdk-javascript';
import type { CallInviteEvent } from '@sendsar/protocol';
import type { SendsarCallMediaTrack } from '../utils/call-media-track';
import { SendsarSessionService } from './sendsar-session.service';

@Injectable()
export class SendsarCallService {
  private readonly session = inject(SendsarSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private client: CallClient | null = null;
  private unsubs: Array<() => void> = [];

  private readonly stateSignal = signal<CallState>('idle');
  private readonly activeCallSignal = signal<CallRecord | null>(null);
  private readonly incomingInviteSignal = signal<CallInviteEvent | null>(null);
  private readonly callingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly micEnabledSignal = signal(true);
  private readonly cameraEnabledSignal = signal(true);
  private readonly localVideoTrackSignal = signal<SendsarCallMediaTrack | null>(null);
  private readonly remoteVideoTrackSignal = signal<SendsarCallMediaTrack | null>(null);
  private readonly remoteAudioTrackSignal = signal<SendsarCallMediaTrack | null>(null);

  readonly callState = this.stateSignal.asReadonly();
  readonly activeCall = this.activeCallSignal.asReadonly();
  readonly incomingInvite = this.incomingInviteSignal.asReadonly();
  readonly calling = this.callingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly micEnabled = this.micEnabledSignal.asReadonly();
  readonly cameraEnabled = this.cameraEnabledSignal.asReadonly();
  readonly localVideoTrack = this.localVideoTrackSignal.asReadonly();
  readonly remoteVideoTrack = this.remoteVideoTrackSignal.asReadonly();
  readonly remoteAudioTrack = this.remoteAudioTrackSignal.asReadonly();

  /** True while a call UI should be visible (outgoing, incoming, connecting, or active). */
  readonly showCallUi = computed(() => {
    const state = this.callState();
    return state === 'outgoing' || state === 'incoming' || state === 'connecting' || state === 'active';
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.destroyClient());
  }

  /** Ensure CallClient is created so incoming invites are received. */
  ensureReady(): void {
    this.requireCallClient();
  }

  startVideoCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'video');
  }

  startAudioCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'audio');
  }

  async accept(callId?: string, roomId?: string): Promise<CallRecord> {
    const invite = this.incomingInvite();
    const resolvedCallId = callId ?? invite?.callId;
    if (!resolvedCallId) {
      throw new Error('No incoming call to accept');
    }

    this.errorSignal.set(null);
    this.callingSignal.set(true);
    try {
      const call = await this.requireCallClient().accept(resolvedCallId, roomId ?? invite?.roomId);
      this.activeCallSignal.set(call);
      this.incomingInviteSignal.set(null);
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept call';
      this.errorSignal.set(message);
      throw err;
    } finally {
      this.callingSignal.set(false);
    }
  }

  async decline(callId?: string): Promise<CallRecord | null> {
    const invite = this.incomingInvite();
    const resolvedCallId = callId ?? invite?.callId;
    if (!resolvedCallId) {
      return null;
    }

    try {
      const call = await this.requireCallClient().decline(resolvedCallId);
      this.incomingInviteSignal.set(null);
      if (this.callState() === 'incoming') {
        this.stateSignal.set('idle');
      }
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decline call';
      this.errorSignal.set(message);
      throw err;
    }
  }

  async hangUp(options?: { reason?: 'cancelled' | 'no_answer' }): Promise<CallRecord | null> {
    const callClient = this.requireCallClient();
    const result = await callClient.hangUp(options);
    this.clearMediaTracks();
    this.incomingInviteSignal.set(null);
    return result;
  }

  async toggleMicrophone(): Promise<void> {
    const next = !this.micEnabled();
    await this.requireCallClient().setMicrophoneEnabled(next);
    this.micEnabledSignal.set(next);
  }

  async toggleCamera(): Promise<void> {
    const next = !this.cameraEnabled();
    await this.requireCallClient().setCameraEnabled(next);
    this.cameraEnabledSignal.set(next);
  }

  private async startCall(roomId: string, type: CallType): Promise<CallRecord> {
    if (!roomId) {
      throw new Error('roomId is required to start a call');
    }

    if (this.calling() || this.showCallUi()) {
      throw new Error('A call is already in progress');
    }

    this.callingSignal.set(true);
    this.errorSignal.set(null);
    this.micEnabledSignal.set(true);
    this.cameraEnabledSignal.set(type === 'video');
    this.clearMediaTracks();

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
          if (to === 'idle' || to === 'ended') {
            this.clearMediaTracks();
            this.incomingInviteSignal.set(null);
            if (to === 'ended') {
              this.stateSignal.set('idle');
            }
          }
        }),
        this.client.on('incoming', (invite) => {
          this.incomingInviteSignal.set(invite);
          this.stateSignal.set('incoming');
        }),
        this.client.on('localTrack', ({ track }) => {
          if (track.kind === 'video') {
            this.localVideoTrackSignal.set(track as SendsarCallMediaTrack);
          }
        }),
        this.client.on('remoteTrack', ({ track }) => {
          if (track.kind === 'video') {
            this.remoteVideoTrackSignal.set(track as SendsarCallMediaTrack);
          } else if (track.kind === 'audio') {
            this.remoteAudioTrackSignal.set(track as SendsarCallMediaTrack);
          }
        }),
        this.client.on('remoteTrackRemoved', ({ track }) => {
          if (track.kind === 'video') {
            this.remoteVideoTrackSignal.set(null);
          } else if (track.kind === 'audio') {
            this.remoteAudioTrackSignal.set(null);
          }
        }),
        this.client.on('error', ({ message }) => {
          this.errorSignal.set(message);
        }),
        this.client.on('ended', () => {
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
          this.incomingInviteSignal.set(null);
          this.clearMediaTracks();
        }),
        this.client.on('declined', () => {
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
          this.incomingInviteSignal.set(null);
          this.clearMediaTracks();
        }),
      );
    }

    return this.client;
  }

  private clearMediaTracks(): void {
    this.localVideoTrackSignal.set(null);
    this.remoteVideoTrackSignal.set(null);
    this.remoteAudioTrackSignal.set(null);
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
    this.incomingInviteSignal.set(null);
    this.callingSignal.set(false);
    this.clearMediaTracks();
  }
}
