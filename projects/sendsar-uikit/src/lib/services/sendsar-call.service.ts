import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { CallClient, type CallState } from '@sendsar/call-sdk-javascript';
import {
  SOCKET_EVENT,
  SendsarError,
  formatCallTimer,
  type CallEndedEvent,
  type CallRecord,
  type CallType,
  type SendsarClient,
} from '@sendsar/chat-sdk-javascript';
import type { CallInviteEvent } from '@sendsar/protocol';
import type { SendsarCallMediaTrack } from '../utils/call-media-track';
import { playEndTone, playRingback, playRingtone } from '../utils/call-tones';
import { SendsarSessionService } from './sendsar-session.service';

type ToneHandle = { stop: () => void };

/** Remote LiveKit participant for Meet-style grid tiles (video optional). */
export interface SendsarCallRemoteParticipant {
  sid: string;
  identity: string;
  videoTrack: SendsarCallMediaTrack | null;
}

function isJoinableStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'ringing' || normalized === 'active';
}

/** Read `isGroup` even when the linked chat-sdk types predate the field. */
export function callRecordIsGroup(call: CallRecord | null | undefined): boolean | undefined {
  if (!call) return undefined;
  const flag = (call as CallRecord & { isGroup?: boolean }).isGroup;
  return typeof flag === 'boolean' ? flag : undefined;
}

/** User-facing message for permission / accept / connect failures. */
export function formatCallFailureMessage(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : fallback;
  if (/notallowed|permission|denied|getusermedia/i.test(raw)) {
    return 'Microphone or camera permission denied';
  }
  if (/accept/i.test(raw)) {
    return 'Failed to join call';
  }
  return raw || fallback;
}

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
  private readonly remoteVideoTracksSignal = signal<
    ReadonlyArray<{ sid: string; identity: string; track: SendsarCallMediaTrack }>
  >([]);
  private readonly remoteAudioTrackSignal = signal<SendsarCallMediaTrack | null>(null);
  private readonly remoteParticipantIdsSignal = signal<ReadonlySet<string>>(new Set());
  /** sid → LiveKit identity (audio and video peers). */
  private readonly remoteIdentities = new Map<string, string>();
  /** sid → track kinds currently subscribed (audio/video). */
  private readonly remoteParticipantKinds = new Map<string, Set<string>>();
  /** Room the shell is viewing — drives Join-banner polling / live updates. */
  private watchedRoomId: string | null = null;
  private joinableRefreshToken = 0;
  private readonly joinableCallSignal = signal<CallRecord | null>(null);
  /** Room IDs with a known live call (from invite / start / ended) for inbox badges. */
  private readonly liveCallRoomIdsSignal = signal<ReadonlySet<string>>(new Set());
  private roomCallUnsubs: Array<() => void> = [];

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
  /** All remote video tracks (group grid / PiP). */
  readonly remoteVideoTracks = this.remoteVideoTracksSignal.asReadonly();
  /** First remote video — used by 1:1 PiP layouts. */
  readonly remoteVideoTrack = computed(() => this.remoteVideoTracksSignal()[0]?.track ?? null);
  readonly remoteAudioTrack = this.remoteAudioTrackSignal.asReadonly();
  /** LiveKit remote participants currently publishing at least one track. */
  readonly remoteParticipantCount = computed(() => this.remoteParticipantIdsSignal().size);
  /** Local + remotes currently in the LiveKit room. */
  readonly inCallParticipantCount = computed(() => 1 + this.remoteParticipantIdsSignal().size);
  /**
   * All remotes in the LiveKit room (audio-only included) for Meet-style grid.
   * `videoTrack` is null when the peer has no camera / voice-only call.
   */
  readonly remoteParticipants = computed((): ReadonlyArray<SendsarCallRemoteParticipant> => {
    const videos = new Map(
      this.remoteVideoTracksSignal().map((item) => [item.sid, item] as const),
    );
    const result: SendsarCallRemoteParticipant[] = [];
    for (const sid of this.remoteParticipantIdsSignal()) {
      const video = videos.get(sid);
      result.push({
        sid,
        identity: video?.identity ?? this.remoteIdentities.get(sid) ?? sid,
        videoTrack: video?.track ?? null,
      });
    }
    return result;
  });
  /** Ongoing call in the watched room that the local user can Join. */
  readonly joinableCall = this.joinableCallSignal.asReadonly();
  /** Rooms with a ringing/active call (Telegram inbox indicator). */
  readonly liveCallRoomIds = this.liveCallRoomIdsSignal.asReadonly();

  /** True while a call UI should be visible (outgoing, incoming, connecting, active, or dialing). */
  readonly showCallUi = computed(() => {
    if (this.calling()) {
      return true;
    }
    const state = this.callState();
    return state === 'outgoing' || state === 'incoming' || state === 'connecting' || state === 'active';
  });

  /**
   * Telegram-style Join bar: room has RINGING/ACTIVE call and local user is
   * not already in the call UI for it.
   */
  readonly showJoinBanner = computed(() => {
    const call = this.joinableCall();
    if (!call || !isJoinableStatus(call.status)) {
      return false;
    }
    if (this.showCallUi()) {
      return false;
    }
    return true;
  });

  constructor() {
    effect(() => {
      const status = this.session.state().status;
      const chat = this.session.client;

      if (status !== 'ready' || !chat) {
        this.destroyClient();
        this.clearRoomCallListeners();
        this.joinableCallSignal.set(null);
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

    this.destroyRef.onDestroy(() => {
      this.clearRoomCallListeners();
      this.destroyClient();
    });
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
    this.bindRoomCallListeners(client);
  }

  private bindRoomCallListeners(client: SendsarClient): void {
    this.clearRoomCallListeners();
    this.roomCallUnsubs = [
      client.on(SOCKET_EVENT.CALL_INVITE, (invite: CallInviteEvent) => {
        this.markLiveCallRoom(invite.roomId, true);
        if (invite.roomId === this.watchedRoomId) {
          void this.refreshJoinableCall(invite.roomId).catch(() => {
            // Keep prior banner state on refresh failure.
          });
        }
      }),
      client.on(SOCKET_EVENT.CALL_ENDED, (ended: CallEndedEvent) => {
        this.markLiveCallRoom(ended.roomId, false);
        const joinable = this.joinableCallSignal();
        if (
          ended.roomId === this.watchedRoomId ||
          (joinable && joinable.id === ended.callId)
        ) {
          this.joinableCallSignal.set(null);
        }
      }),
      client.on(SOCKET_EVENT.CALL_ACCEPTED, (accepted) => {
        this.markLiveCallRoom(accepted.roomId, true);
        if (accepted.roomId === this.watchedRoomId && !this.showCallUi()) {
          void this.refreshJoinableCall(accepted.roomId).catch(() => {
            // ignore
          });
        }
      }),
    ];
  }

  private markLiveCallRoom(roomId: string, live: boolean): void {
    const next = new Set(this.liveCallRoomIdsSignal());
    if (live) {
      next.add(roomId);
    } else {
      next.delete(roomId);
    }
    this.liveCallRoomIdsSignal.set(next);
  }

  private clearRoomCallListeners(): void {
    for (const unsub of this.roomCallUnsubs) {
      unsub();
    }
    this.roomCallUnsubs = [];
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
      this.joinableCallSignal.set(null);
      this.minimizedSignal.set(false);
      return call;
    } catch (err) {
      const message = formatCallFailureMessage(err, 'Failed to accept call');
      this.errorSignal.set(message);
      this.callingSignal.set(false);
      // Don't stick in connecting — CallClient finalizeCall resets state; mirror here.
      if (this.callState() === 'connecting' || this.callState() === 'incoming') {
        this.stateSignal.set('idle');
      }
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

    const dismissedRoomId = invite?.roomId ?? null;
    this.stopTones();
    try {
      const call = await this.requireCallClient().decline(resolvedCallId);
      this.incomingInviteSignal.set(null);
      if (this.callState() === 'incoming') {
        this.stateSignal.set('idle');
      }
      playEndTone();
      // Group dismiss: keep Join bar while the call is still live.
      if (dismissedRoomId && dismissedRoomId === this.watchedRoomId) {
        void this.refreshJoinableCall(dismissedRoomId);
      }
      return call;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to decline call';
      this.errorSignal.set(message);
      throw err;
    }
  }

  /**
   * Tell the call service which conversation is open so Join banner can
   * refresh on select and on call-invite / call-ended.
   */
  setWatchedRoom(roomId: string | null): void {
    if (this.watchedRoomId === roomId) {
      if (roomId) {
        void this.refreshJoinableCall(roomId);
      }
      return;
    }
    this.watchedRoomId = roomId;
    if (!roomId) {
      this.joinableCallSignal.set(null);
      return;
    }
    void this.refreshJoinableCall(roomId);
  }

  /** Fetch active call for a room and update the Join banner target. */
  async refreshJoinableCall(roomId: string): Promise<CallRecord | null> {
    const token = ++this.joinableRefreshToken;
    const chat = this.session.client;
    if (!chat || !roomId) {
      if (token === this.joinableRefreshToken) {
        this.joinableCallSignal.set(null);
      }
      return null;
    }

    try {
      const { call } = await chat.getRestClientForCalls().getActiveCall(roomId);
      if (token !== this.joinableRefreshToken || this.watchedRoomId !== roomId) {
        return call;
      }
      if (!isJoinableStatus(call.status)) {
        this.joinableCallSignal.set(null);
        return null;
      }
      // Already in this call — hide Join.
      if (this.showCallUi() && this.activeCall()?.id === call.id) {
        this.joinableCallSignal.set(null);
        return call;
      }
      if (this.showCallUi() && this.activeCall()?.roomId === roomId) {
        this.joinableCallSignal.set(null);
        return call;
      }
      this.joinableCallSignal.set(call);
      return call;
    } catch (err) {
      if (err instanceof SendsarError && err.status === 404) {
        if (token === this.joinableRefreshToken && this.watchedRoomId === roomId) {
          this.joinableCallSignal.set(null);
        }
        return null;
      }
      // Keep previous banner on transient errors.
      throw err;
    }
  }

  /** Join the room's ongoing call (accept if ringing, rejoin if active). */
  async joinOngoingCall(roomId?: string): Promise<CallRecord | null> {
    const targetRoomId = roomId ?? this.joinableCall()?.roomId ?? this.watchedRoomId;
    if (!targetRoomId) {
      throw new Error('No room to join');
    }
    if (this.calling() || this.showCallUi()) {
      throw new Error('A call is already in progress');
    }

    this.errorSignal.set(null);
    this.callingSignal.set(true);
    this.minimizedSignal.set(false);
    this.stopTones();
    try {
      const call = await this.requireCallClient().rejoin(targetRoomId);
      if (call) {
        this.activeCallSignal.set(call);
        this.joinableCallSignal.set(null);
        this.incomingInviteSignal.set(null);
      }
      return call;
    } catch (err) {
      const message = formatCallFailureMessage(err, 'Failed to join call');
      this.errorSignal.set(message);
      this.callingSignal.set(false);
      if (this.callState() === 'connecting' || this.callState() === 'outgoing') {
        this.stateSignal.set('idle');
      }
      throw err;
    } finally {
      this.callingSignal.set(false);
    }
  }

  clearError(): void {
    this.errorSignal.set(null);
  }

  async hangUp(options?: {
    reason?: 'cancelled' | 'no_answer';
    endForAll?: boolean;
  }): Promise<CallRecord | null> {
    this.stopTones();
    try {
      const callClient = this.requireCallClient();
      const endForAll = options?.endForAll ?? this.shouldEndCallForAll();
      const result = await callClient.hangUp({ ...options, endForAll });
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

  /** Group call creator should end for everyone; others leave. */
  shouldEndCallForAll(): boolean {
    const call = this.activeCallSignal();
    if (!call || callRecordIsGroup(call) !== true) {
      return false;
    }
    const selfId = this.session.session?.chatUserId;
    return Boolean(selfId && call.createdByUserId === selfId);
  }

  hangUpLabel(): string {
    if (this.shouldEndCallForAll()) {
      return 'End for everyone';
    }
    if (callRecordIsGroup(this.activeCallSignal()) === true) {
      return 'Leave';
    }
    return 'Hang up';
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
    this.joinableCallSignal.set(null);
    this.clearMediaTracks();
    // Optimistic: show overlay as "Calling…" before the start API returns.
    this.stateSignal.set('outgoing');

    try {
      const callClient = this.requireCallClient();
      const call = await callClient.start(roomId, { type });
      this.activeCallSignal.set(call);
      this.markLiveCallRoom(roomId, true);
      return call;
    } catch (err) {
      const message = formatCallFailureMessage(err, 'Failed to start call');
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
        this.client.on('remoteTrack', ({ track, participant }) => {
          const sid = participant?.sid ?? track.sid ?? `remote-${Date.now()}`;
          const identity = participant?.identity ?? sid;
          this.remoteIdentities.set(sid, identity);
          this.noteRemoteParticipantTrack(sid, track.kind);
          if (track.kind === 'video') {
            this.remoteVideoTracksSignal.update((list) => {
              const next = list.filter((item) => item.sid !== sid);
              next.push({ sid, identity, track: track as SendsarCallMediaTrack });
              return next;
            });
          } else if (track.kind === 'audio') {
            this.remoteAudioTrackSignal.set(track as SendsarCallMediaTrack);
          }
        }),
        this.client.on('remoteTrackRemoved', ({ track, participant }) => {
          const sid = participant?.sid ?? track.sid;
          if (sid) {
            this.clearRemoteParticipantTrack(sid, track.kind);
            if (!this.remoteParticipantKinds.has(sid)) {
              this.remoteIdentities.delete(sid);
            }
          }
          if (track.kind === 'video') {
            this.remoteVideoTracksSignal.update((list) =>
              sid ? list.filter((item) => item.sid !== sid) : [],
            );
          } else if (track.kind === 'audio') {
            this.remoteAudioTrackSignal.set(null);
          }
        }),
        this.client.on('mediaConnected', () => {
          this.mediaStatusSignal.set('connected');
          this.startDurationTimer();
          this.stopTones();
          this.joinableCallSignal.set(null);
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
        this.client.on('error', ({ message, cause }) => {
          this.errorSignal.set(formatCallFailureMessage(cause ?? message, message));
        }),
        this.client.on('ended', () => {
          this.resetCallUi(true);
          this.stateSignal.set('idle');
          this.activeCallSignal.set(null);
          this.incomingInviteSignal.set(null);
          if (this.watchedRoomId) {
            void this.refreshJoinableCall(this.watchedRoomId).catch(() => {
              this.joinableCallSignal.set(null);
            });
          }
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

  private noteRemoteParticipantTrack(sid: string, kind: string): void {
    let kinds = this.remoteParticipantKinds.get(sid);
    if (!kinds) {
      kinds = new Set();
      this.remoteParticipantKinds.set(sid, kinds);
    }
    kinds.add(kind);
    this.remoteParticipantIdsSignal.set(new Set(this.remoteParticipantKinds.keys()));
  }

  private clearRemoteParticipantTrack(sid: string, kind: string): void {
    const kinds = this.remoteParticipantKinds.get(sid);
    if (!kinds) {
      return;
    }
    kinds.delete(kind);
    if (kinds.size === 0) {
      this.remoteParticipantKinds.delete(sid);
    }
    this.remoteParticipantIdsSignal.set(new Set(this.remoteParticipantKinds.keys()));
  }

  private clearMediaTracks(): void {
    this.localVideoTrackSignal.set(null);
    this.remoteVideoTracksSignal.set([]);
    this.remoteAudioTrackSignal.set(null);
    this.remoteParticipantKinds.clear();
    this.remoteIdentities.clear();
    this.remoteParticipantIdsSignal.set(new Set());
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
