import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import type { SendsarCallMediaTrack } from '../../../utils/call-media-track';

/** Attaches a LiveKit-compatible track to a `<video>` / `<audio>` host element. */
@Directive({
  selector: '[scCallTrack]',
  standalone: true,
})
export class SendsarCallTrackDirective implements OnChanges, OnDestroy {
  @Input('scCallTrack') track: SendsarCallMediaTrack | null = null;

  private attached: SendsarCallMediaTrack | null = null;

  constructor(private readonly host: ElementRef<HTMLMediaElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['track']) {
      return;
    }
    this.detach();
    const next = this.track;
    if (!next) {
      return;
    }
    next.attach(this.host.nativeElement);
    this.attached = next;
  }

  ngOnDestroy(): void {
    this.detach();
  }

  private detach(): void {
    if (this.attached) {
      this.attached.detach(this.host.nativeElement);
      this.attached = null;
    }
    this.host.nativeElement.removeAttribute('src');
    this.host.nativeElement.srcObject = null;
  }
}
