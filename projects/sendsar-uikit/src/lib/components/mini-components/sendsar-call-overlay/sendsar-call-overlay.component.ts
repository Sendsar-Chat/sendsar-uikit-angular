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
import { SendsarCallService } from '../../../services/sendsar-call.service';
import { initialsFor } from '../../../utils/user-directory';
import { SendsarCallTrackDirective } from './sendsar-call-track.directive';

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
