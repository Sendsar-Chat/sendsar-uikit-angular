import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { SendsarCallService, callRecordIsGroup } from '../../../services/sendsar-call.service';
import { initialsFor } from '../../../utils/user-directory';
import { SendsarCallTrackDirective } from './sendsar-call-track.directive';

/** Meet-ish column density for equal-tile grids. */
export function callGridColsFor(n: number): number {
  if (n <= 1) return 1;
  // 3 → 2 cols (2 on top, 1 centered below) avoids tall portrait strips
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  if (n <= 9) return 3;
  return Math.ceil(Math.sqrt(n));
}

export type CallGridTile = {
  key: string;
  identity: string;
  label: string;
  track: ReturnType<SendsarCallService['localVideoTrack']> | null;
  isLocal: boolean;
  avatarUrl: string | null;
  initials: string;
};

@Component({
  selector: 'sc-call-overlay',
  standalone: true,
  imports: [CommonModule, SendsarCallTrackDirective],
  templateUrl: './sendsar-call-overlay.component.html',
  styleUrl: './sendsar-call-overlay.component.css',
})
export class SendsarCallOverlayComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly calls = inject(SendsarCallService);

  @ViewChild('dialogEl') dialogEl?: ElementRef<HTMLElement>;
  @ViewChild('remoteAudioEl') remoteAudioEl?: ElementRef<HTMLAudioElement>;

  @Input() title = 'Call';
  @Input() avatarUrl: string | null = null;
  @Input() peerInitials = '?';
  /** When true, use Meet-style participant grid instead of 1:1 PiP. */
  @Input() isGroup = false;
  /** Resolve LiveKit identity → display label for grid tiles. */
  @Input() labelForIdentity: ((identity: string) => string) | null = null;
  /** Resolve LiveKit identity (or `'local'`) → avatar URL for no-video tiles. */
  @Input() avatarForIdentity: ((identity: string) => string | null) | null = null;

  /** Expanded to fill the chat shell / viewport (CSS). */
  readonly expanded = signal(false);
  /** Native browser fullscreen active. */
  readonly nativeFullscreen = signal(false);
  /** Drag offset from the centered position. */
  readonly offset = signal({ x: 0, y: 0 });
  readonly dragging = signal(false);

  private dragPointerId: number | null = null;
  private dragOrigin = { x: 0, y: 0 };
  private offsetOrigin = { x: 0, y: 0 };

  constructor() {
    effect(() => {
      // Re-bind whenever the remote audio track appears / changes.
      this.calls.remoteAudioTrack();
      queueMicrotask(() => this.bindRemoteAudio());
    });
  }

  ngAfterViewInit(): void {
    this.bindRemoteAudio();
  }

  avatarLetter(): string {
    if (this.peerInitials && this.peerInitials !== '?') {
      return this.peerInitials;
    }
    return initialsFor(this.title);
  }

  useGroupGrid(): boolean {
    const state = this.calls.callState();
    if (state !== 'active' && state !== 'connecting') {
      return false;
    }
    const count = this.calls.inCallParticipantCount();
    // Group voice: show participant avatar tiles from 2+ (not 1:1 PiP — group
    // has no single "peer", so PiP only showed a room-letter disc).
    if (this.isGroupVoiceCall() && count >= 2) {
      return true;
    }
    // Meet equal-tile grid when local + remotes >= 3 (LiveKit count).
    return count >= 3;
  }

  /** Audio call in a group room (or call.isGroup). */
  isGroupVoiceCall(): boolean {
    const call = this.calls.activeCall() ?? this.calls.incomingInvite();
    const type = call && 'type' in call ? call.type : null;
    const audio = type === 'audio';
    if (!audio) {
      return false;
    }
    return callRecordIsGroup(this.calls.activeCall()) === true || this.isGroup;
  }

  /** Enlarge circular avatars when the call is voice / tile has no video. */
  isVoiceOnlyCall(): boolean {
    const call = this.calls.activeCall() ?? this.calls.incomingInvite();
    return call?.type === 'audio';
  }

  /** Decline (1:1) vs Dismiss (group) — group decline is local-only. */
  declineLabel(): string {
    const call = this.calls.activeCall() ?? this.calls.joinableCall();
    if (callRecordIsGroup(call) === true || this.isGroup) {
      return 'Dismiss';
    }
    return 'Decline';
  }

  private identityUserId(identity: string): string {
    const colon = identity.lastIndexOf(':');
    return colon >= 0 ? identity.slice(colon + 1) : identity;
  }

  tileLabel(identity: string): string {
    const userId = this.identityUserId(identity);
    return this.labelForIdentity?.(userId) ?? this.labelForIdentity?.(identity) ?? userId;
  }

  tileAvatarUrl(identity: string): string | null {
    const userId = this.identityUserId(identity);
    return this.avatarForIdentity?.(userId) ?? this.avatarForIdentity?.(identity) ?? null;
  }

  /** Local + remote tiles for Meet-style grid (avatar when no video). */
  gridTiles(): CallGridTile[] {
    const tiles: CallGridTile[] = [
      {
        key: 'local',
        identity: 'local',
        label: 'You',
        track: this.isVoiceOnlyCall() ? null : this.calls.localVideoTrack(),
        isLocal: true,
        avatarUrl: this.avatarForIdentity?.('local') ?? null,
        initials: initialsFor('You'),
      },
    ];
    for (const remote of this.calls.remoteParticipants()) {
      const label = this.tileLabel(remote.identity);
      const videoTrack = this.isVoiceOnlyCall() ? null : remote.videoTrack;
      tiles.push({
        key: remote.sid,
        identity: remote.identity,
        label,
        track: videoTrack,
        isLocal: false,
        avatarUrl: this.tileAvatarUrl(remote.identity),
        initials: initialsFor(label),
      });
    }
    return tiles;
  }

  /** Max columns for the current participant count (Meet density). */
  gridCols(): number {
    return callGridColsFor(this.gridTiles().length);
  }

  /** Row chunks; incomplete last row is centered via CSS (equal tile widths). */
  gridRows(): CallGridTile[][] {
    const tiles = this.gridTiles();
    const n = tiles.length;
    const cols = callGridColsFor(n);
    const rows: CallGridTile[][] = [];
    for (let i = 0; i < n; i += cols) {
      rows.push(tiles.slice(i, i + cols));
    }
    return rows;
  }

  statusLabel(): string {
    if (this.calls.mediaStatus() === 'reconnecting') {
      return 'Reconnecting…';
    }

    const duration = this.calls.durationLabel();
    if (duration && this.calls.callState() === 'active') {
      return duration;
    }

    if (this.calls.calling()) {
      const state = this.calls.callState();
      if (state === 'incoming' || state === 'connecting') {
        return 'Connecting…';
      }
      if (state === 'outgoing' || state === 'idle') {
        return 'Calling…';
      }
    }

    switch (this.calls.callState()) {
      case 'outgoing':
        return 'Calling…';
      case 'incoming':
        return 'Incoming call';
      case 'connecting':
        return 'Connecting…';
      case 'active':
        return 'In call';
      default:
        return 'Call';
    }
  }

  canDrag(): boolean {
    return !this.expanded() && !this.nativeFullscreen() && !this.calls.minimized();
  }

  canMinimize(): boolean {
    const state = this.calls.callState();
    return state === 'outgoing' || state === 'connecting' || state === 'active';
  }

  dialogTransform(): string | null {
    if (!this.canDrag()) {
      return null;
    }
    const { x, y } = this.offset();
    return `translate(${x}px, ${y}px)`;
  }

  onDragStart(event: PointerEvent): void {
    if (!this.canDrag()) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest('button')) {
      return;
    }

    event.preventDefault();
    this.dragPointerId = event.pointerId;
    this.dragOrigin = { x: event.clientX, y: event.clientY };
    this.offsetOrigin = { ...this.offset() };
    this.dragging.set(true);

    const header = event.currentTarget as HTMLElement | null;
    header?.setPointerCapture(event.pointerId);
  }

  onDragMove(event: PointerEvent): void {
    if (!this.dragging() || event.pointerId !== this.dragPointerId) {
      return;
    }

    const dx = event.clientX - this.dragOrigin.x;
    const dy = event.clientY - this.dragOrigin.y;
    this.offset.set(this.clampOffset(this.offsetOrigin.x + dx, this.offsetOrigin.y + dy));
  }

  onDragEnd(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    this.dragging.set(false);
    this.dragPointerId = null;

    const header = event.currentTarget as HTMLElement | null;
    if (header?.hasPointerCapture(event.pointerId)) {
      header.releasePointerCapture(event.pointerId);
    }
  }

  minimize(): void {
    if (!this.canMinimize()) {
      return;
    }
    if (this.nativeFullscreen()) {
      void this.exitNativeFullscreen();
    }
    this.expanded.set(false);
    this.calls.setMinimized(true);
  }

  restore(): void {
    this.calls.setMinimized(false);
  }

  async hangUp(): Promise<void> {
    if (this.nativeFullscreen()) {
      await this.exitNativeFullscreen();
    }
    const state = this.calls.callState();
    try {
      await this.calls.hangUp({
        reason: state === 'outgoing' ? 'cancelled' : undefined,
      });
    } catch {
      // error surfaced via calls.error
    }
  }

  async accept(): Promise<void> {
    try {
      await this.calls.accept();
    } catch {
      // error surfaced via calls.error
    }
  }

  async decline(): Promise<void> {
    try {
      await this.calls.decline();
    } catch {
      // error surfaced via calls.error
    }
  }

  async toggleMic(): Promise<void> {
    try {
      await this.calls.toggleMicrophone();
    } catch {
      // error surfaced via calls.error
    }
  }

  async toggleCamera(): Promise<void> {
    try {
      await this.calls.toggleCamera();
    } catch {
      // error surfaced via calls.error
    }
  }

  async toggleSpeaker(): Promise<void> {
    try {
      await this.calls.toggleSpeaker();
    } catch {
      // error surfaced via calls.error
    }
  }

  toggleExpanded(): void {
    if (this.nativeFullscreen()) {
      void this.exitNativeFullscreen();
      return;
    }

    const next = !this.expanded();
    this.expanded.set(next);
    if (next) {
      this.offset.set({ x: 0, y: 0 });
    }
  }

  async toggleFullscreen(): Promise<void> {
    const el = this.dialogEl?.nativeElement;
    if (!el) {
      return;
    }

    if (this.nativeFullscreen() || document.fullscreenElement) {
      await this.exitNativeFullscreen();
      return;
    }

    this.expanded.set(true);
    this.offset.set({ x: 0, y: 0 });
    try {
      await el.requestFullscreen();
      this.nativeFullscreen.set(true);
    } catch {
      this.nativeFullscreen.set(false);
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    const active = document.fullscreenElement === this.dialogEl?.nativeElement;
    this.nativeFullscreen.set(active);
    if (!active) {
      this.expanded.set(true);
      this.offset.set({ x: 0, y: 0 });
    }
  }

  ngOnDestroy(): void {
    this.calls.bindRemoteAudioElement(null);
    if (document.fullscreenElement === this.dialogEl?.nativeElement) {
      void document.exitFullscreen();
    }
  }

  private bindRemoteAudio(): void {
    this.calls.bindRemoteAudioElement(this.remoteAudioEl?.nativeElement ?? null);
  }

  private clampOffset(x: number, y: number): { x: number; y: number } {
    const host = this.host.nativeElement.getBoundingClientRect();
    const dialog = this.dialogEl?.nativeElement.getBoundingClientRect();
    if (!dialog) {
      return { x, y };
    }

    const maxX = Math.max(0, (host.width - dialog.width) / 2);
    const maxY = Math.max(0, (host.height - dialog.height) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  private async exitNativeFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // ignore
      }
    }
    this.nativeFullscreen.set(false);
  }
}
