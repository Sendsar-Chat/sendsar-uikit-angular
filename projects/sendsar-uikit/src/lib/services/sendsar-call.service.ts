import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { CallClient, type CallState } from '@sendsar/call-sdk-javascript';
import {
  SOCKET_EVENT,
  formatCallTimer,
  type CallRecord,
  type CallType,
  type SendsarClient,
} from '@sendsar/chat-sdk-javascript';
import type { CallInviteEvent } from '@sendsar/protocol';
import type { SendsarCallMediaTrack } from '../utils/call-media-track';
import { playEndTone, playRingback, playRingtone } from '../utils/call-tones';
import { SendsarSessionService } from './sendsar-session.service';

type ToneHandle = { stop: () => void };

@Injectable()
export class SendsarCallService {
  private readonly session = inject(SendsarSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private client: CallClient | null = null;
  private boundChatClient: SendsarClient | null = null;
  private unsubs: Array<() => void> = [];
  private bufferedInvite: CallInviteEvent | null = null;
  private earlyInviteUnsub: (() => void) | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private connectedAtMs: number | null = null;
  private toneHandle: ToneHandle | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;

  private readonly stateSignal = signal<CallState>('idle');
  private readonly activeCallSignal = signal<CallRecord | null>(null);
  private readonly incomingInviteSignal = signal<CallInviteEvent | null>(null);
  private readonly callingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly mediaStatusSignal = signal<'idle' | 'reconnecting' | 'connected'>('idle');
  private readonly elapsedSecondsSignal = signal(0);
  private readonly micEnabledSignal = signal(true);
  private readonly cameraEnabledSignal = signal(true);
  private readonly speakerEnabledSignal = signal(true);
  private readonly minimizedSignal = signal(false);
  private readonly localVideoTrackSignal = signal<SendsarCallMediaTrack | null>(null);
  private readonly remoteVideoTrackSignal = signal<SendsarCallMediaTrack | null>(null);
  private readonly remoteAudioTrackSignal = signal<SendsarCallMediaTrack | null>(null);

  readonly callState = this.stateSignal.asReadonly();
  readonly activeCall = this.activeCallSignal.asReadonly();
  readonly incomingInvite = this.incomingInviteSignal.asReadonly();
  readonly calling = this.callingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly mediaStatus = this.mediaStatusSignal.asReadonly();
  readonly elapsedSeconds = this.elapsedSecondsSignal.asReadonly();
  /** Live `m:ss` / `h:mm:ss` while media is connected; empty otherwise. */
  readonly durationLabel = computed(() => {
    if (this.mediaStatus() !== 'connected' && this.mediaStatus() !== 'reconnecting') {
      return '';
    }
    if (this.callState() !== 'active') {
      return '';
    }
    return formatCallTimer(this.elapsedSeconds());
  });
  readonly micEnabled = this.micEnabledSignal.asReadonly();
  readonly cameraEnabled = this.cameraEnabledSignal.asReadonly();
  readonly speakerEnabled = this.speakerEnabledSignal.asReadonly();
  readonly minimized = this.minimizedSignal.asReadonly();
  readonly localVideoTrack = this.localVideoTrackSignal.asReadonly();
  readonly remoteVideoTrack = this.remoteVideoTrackSignal.asReadonly();
  readonly remoteAudioTrack = this.remoteAudioTrackSignal.asReadonly();

  /** True while a call UI should be visible (outgoing, incoming, connecting, active, or dialing). */
  readonly showCallUi = computed(() => {
    if (this.calling()) {
      return true;
    }
    const state = this.callState();
    return state === 'outgoing' || state === 'incoming' || state === 'connecting' || state === 'active';
  });

  constructor() {
    effect(() => {
      const status = this.session.state().status;
      const chat = this.session.client;

      if (status !== 'ready' || !chat) {
        this.destroyClient();
        return;
      }

      if (this.boundChatClient !== chat) {
        this.destroyClient();
        this.attachEarlyInviteListener(chat);
        this.ensureReady();
      }
    });

    effect(() => {
      const state = this.callState();
      const media = this.mediaStatus();
      this.syncCallTones(state, media);
    });

    this.destroyRef.onDestroy(() => this.destroyClient());
  }

  /** Ensure CallClient is created so incoming invites are received. */
  ensureReady(): void {
    this.requireCallClient();
    if (this.bufferedInvite && this.client) {
      this.client.ingestInvite(this.bufferedInvite);
      this.bufferedInvite = null;
    }
  }

  private attachEarlyInviteListener(client: SendsarClient): void {
    this.earlyInviteUnsub?.();
    this.earlyInviteUnsub = client.on(SOCKET_EVENT.CALL_INVITE, (invite) => {
      if (this.client) {
        return;
      }
      if (this.showCallUi()) {
        return;
      }
      this.bufferedInvite = invite;
      this.incomingInviteSignal.set(invite);
      this.stateSignal.set('incoming');
    });
  }

  startVideoCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'video');
  }

  startAudioCall(roomId: string): Promise<CallRecord> {
    return this.startCall(roomId, 'audio');
  }

  /** Start (or redial) a call of the given type. */
  startCallOfType(roomId: string, type: CallType): Promise<CallRecord> {
    return type === 'video' ? this.startVideoCall(roomId) : this.startAudioCall(roomId);
  }

  async accept(callId?: string, roomId?: string): Promise<CallRecord> {
    const invite = this.incomingInvite();
    const resolvedCallId = callId ?? invite?.callId;
    if (!resolvedCallId) {
      throw new Error('No incoming call to accept');
    }

    this.errorSignal.set(null);
    this.callingSignal.set(true);
    this.stopTones();
    try {
      const call = await this.requireCallClient().accept(resolvedCallId, roomId ?? invite?.roomId);
      this.activeCallSignal.set(call);
      this.incomingInviteSignal.set(null);
      this.minimizedSignal.set(false);
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

    this.stopTones();
    try {
      const call = await this.requireCallClient().decline(resolvedCallId);
      this.incomingInviteSignal.set(null);
      if (this.callState() === 'incoming') {
        this.stateSignal.set('idle');
      }
      playEndTone();
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decline call';
      this.errorSignal.set(message);
      throw err;
    }
  }

  async hangUp(options?: { reason?: 'cancelled' | 'no_answer' }): Promise<CallRecord | null> {
    this.stopTones();
    try {
      const callClient = this.requireCallClient();
      const result = await callClient.hangUp(options);
      this.resetCallUi(true);
      if (!result && (this.calling() || this.callState() === 'outgoing' || this.callState() === 'connecting')) {
        this.callingSignal.set(false);
        this.stateSignal.set('idle');
        this.activeCallSignal.set(null);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to hang up';
      this.errorSignal.set(message);
      throw err;
    }
  }

  async toggleMicrophone(): Promise<void> {
    const next = !this.micEnabled();
    const previous = this.micEnabled();
    this.micEnabledSignal.set(next);
    try {
      await this.requireCallClient().setMicrophoneEnabled(next);
    } catch (err) {
      this.micEnabledSignal.set(previous);
      const message = err instanceof Error ? err.message : 'Failed to toggle microphone';
      this.errorSignal.set(message);
      throw err;
    }
  }

  async toggleCamera(): Promise<void> {
    const next = !this.cameraEnabled();
    const previous = this.cameraEnabled();
    this.cameraEnabledSignal.set(next);
    if (!next) {
      this.localVideoTrackSignal.set(null);
    }
    try {
      await this.requireCallClient().setCameraEnabled(next);
    } catch (err) {
      this.cameraEnabledSignal.set(previous);
      const message = err instanceof Error ? err.message : 'Failed to toggle camera';
      this.errorSignal.set(message);
      throw err;
    }
  }

  /** Prefer loudspeaker output when the browser supports `setSinkId`. */
  async toggleSpeaker(): Promise<void> {
    const next = !this.speakerEnabled();
    this.speakerEnabledSignal.set(next);
    await this.applySpeakerRoute(next);
  }

  setMinimized(minimized: boolean): void {
    if (this.callState() === 'incoming') {
      return;
    }
    this.minimizedSignal.set(minimized);
  }

  bindRemoteAudioElement(el: HTMLAudioElement | null): void {
    this.remoteAudioEl = el;
    void this.applySpeakerRoute(this.speakerEnabled());
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
    this.speakerEnabledSignal.set(true);
    this.minimizedSignal.set(false);
    this.clearMediaTracks();
    // Optimistic: show overlay as "Calling…" before the start API returns.
    this.stateSignal.set('outgoing');

    try {
      const callClient = this.requireCallClient();
      const call = await callClient.start(roomId, { type });
      this.activeCallSignal.set(call);
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start call';
      this.errorSignal.set(message);
      this.stateSignal.set('idle');
      this.activeCallSignal.set(null);
      this.stopTones();
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

    if (!this.client || this.boundChatClient !== chat) {
      this.destroyClient();
      this.boundChatClient = chat;
      this.client = new CallClient({ chat });
      this.unsubs.push(
        this.client.on('stateChange', ({ to, call }) => {
          this.stateSignal.set(to);
          this.activeCallSignal.set(call);
          if (to === 'idle' || to === 'ended') {
            this.resetCallUi(to === 'ended');
            if (to === 'ended') {
              this.stateSignal.set('idle');
            }
          }
        }),
        this.client.on('incoming', (invite) => {
          this.incomingInviteSignal.set(invite);
          this.stateSignal.set('incoming');
          this.minimizedSignal.set(false);
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
        this.client.on('mediaConnected', () => {
          this.mediaStatusSignal.set('connected');
          this.startDurationTimer();
          this.stopTones();
        }),
        this.client.on('mediaReconnecting', () => {
          this.mediaStatusSignal.set('reconnecting');
        }),
        this.client.on('mediaReconnected', () => {
          this.mediaStatusSignal.set('connected');
        }),
        this.client.on('mediaDisconnected', () => {
          this.mediaStatusSignal.set('idle');
          this.stopDurationTimer();
        }),
        this.client.on('error', ({ message }) => {
          this.errorSignal.set(message);
        }),
        this.client.on('ended', () => {
          this.resetCallUi(true);
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
          this.incomingInviteSignal.set(null);
        }),
        this.client.on('declined', () => {
          this.resetCallUi(true);
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
          this.incomingInviteSignal.set(null);
        }),
      );
    }

    return this.client;
  }

  private syncCallTones(state: CallState, media: 'idle' | 'reconnecting' | 'connected'): void {
    if (media === 'connected' || state === 'active' || state === 'connecting') {
      this.stopTones();
      return;
    }
    if (state === 'outgoing') {
      if (!this.toneHandle) {
        this.toneHandle = playRingback();
      }
      return;
    }
    if (state === 'incoming') {
      if (!this.toneHandle) {
        this.toneHandle = playRingtone();
      }
      return;
    }
    this.stopTones();
  }

  private stopTones(): void {
    this.toneHandle?.stop();
    this.toneHandle = null;
  }

  private resetCallUi(playEnd: boolean): void {
    this.stopTones();
    if (playEnd) {
      playEndTone();
    }
    this.stopDurationTimer();
    this.clearMediaTracks();
    this.incomingInviteSignal.set(null);
    this.mediaStatusSignal.set('idle');
    this.minimizedSignal.set(false);
    this.speakerEnabledSignal.set(true);
    this.remoteAudioEl = null;
  }

  private async applySpeakerRoute(speakerOn: boolean): Promise<void> {
    const el = this.remoteAudioEl;
    if (!el) return;
    el.volume = speakerOn ? 1 : 0.35;
    const sinkId = speakerOn ? '' : 'communications';
    const maybeSetSink = (
      el as HTMLAudioElement & {
        setSinkId?: (id: string) => Promise<void>;
      }
    ).setSinkId;
    if (typeof maybeSetSink !== 'function') {
      return;
    }
    try {
      await maybeSetSink.call(el, sinkId);
    } catch {
      // Device may not expose communications sink — volume fallback still applies.
    }
  }

  private startDurationTimer(): void {
    this.stopDurationTimer();
    this.connectedAtMs = Date.now();
    this.elapsedSecondsSignal.set(0);
    this.durationTimer = setInterval(() => {
      if (this.connectedAtMs == null) {
        return;
      }
      this.elapsedSecondsSignal.set(Math.floor((Date.now() - this.connectedAtMs) / 1000));
    }, 1000);
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
    this.connectedAtMs = null;
    this.elapsedSecondsSignal.set(0);
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
    this.earlyInviteUnsub?.();
    this.earlyInviteUnsub = null;
    this.stopTones();
    this.stopDurationTimer();
    this.client?.destroy();
    this.client = null;
    this.boundChatClient = null;
    this.bufferedInvite = null;
    this.stateSignal.set('idle');
    this.activeCallSignal.set(null);
    this.incomingInviteSignal.set(null);
    this.callingSignal.set(false);
    this.mediaStatusSignal.set('idle');
    this.minimizedSignal.set(false);
    this.speakerEnabledSignal.set(true);
    this.remoteAudioEl = null;
    this.clearMediaTracks();
  }
}
