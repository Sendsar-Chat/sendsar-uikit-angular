import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { SendsarCallService } from '../../../services/sendsar-call.service';
import { SendsarCallTrackDirective } from './sendsar-call-track.directive';

@Component({
  selector: 'sc-call-overlay',
  standalone: true,
  imports: [CommonModule, SendsarCallTrackDirective],
  templateUrl: './sendsar-call-overlay.component.html',
  styleUrl: './sendsar-call-overlay.component.css',
})
export class SendsarCallOverlayComponent implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly calls = inject(SendsarCallService);

  @ViewChild('dialogEl') dialogEl?: ElementRef<HTMLElement>;

  @Input() title = 'Call';

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

  statusLabel(): string {
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
    return !this.expanded() && !this.nativeFullscreen();
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

  async hangUp(): Promise<void> {
    if (this.nativeFullscreen()) {
      await this.exitNativeFullscreen();
    }
    const state = this.calls.callState();
    await this.calls.hangUp({
      reason: state === 'outgoing' ? 'cancelled' : undefined,
    });
  }

  async accept(): Promise<void> {
    await this.calls.accept();
  }

  async decline(): Promise<void> {
    await this.calls.decline();
  }

  async toggleMic(): Promise<void> {
    await this.calls.toggleMicrophone();
  }

  async toggleCamera(): Promise<void> {
    await this.calls.toggleCamera();
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
    if (document.fullscreenElement === this.dialogEl?.nativeElement) {
      void document.exitFullscreen();
    }
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
