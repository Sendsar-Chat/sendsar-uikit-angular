import { Component, computed, effect, input, signal } from '@angular/core';
import { AnimationOptions, LottieComponent } from 'ngx-lottie';
import { hasNotoAnimation, notoLottieUrl } from '../../../utils/noto-emoji';

@Component({
  selector: 'sc-animated-emoji',
  standalone: true,
  imports: [LottieComponent],
  template: `
    @if (useAnimation()) {
      <ng-lottie class="sc-animated-emoji__lottie" [options]="lottieOptions()" />
    } @else {
      <span class="sc-animated-emoji__static">{{ emoji() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-block;
      vertical-align: middle;
    }

    .sc-animated-emoji__lottie {
      display: inline-block;
      width: 1.375rem;
      height: 1.375rem;
      vertical-align: -0.2em;
    }

    .sc-animated-emoji__static {
      font-size: 1.1em;
      line-height: 1;
      vertical-align: -0.1em;
    }
  `,
})
export class SendsarAnimatedEmojiComponent {
  readonly emoji = input.required<string>();
  readonly useAnimation = signal(false);

  readonly lottieOptions = computed<AnimationOptions>(() => ({
    path: notoLottieUrl(this.emoji()),
    loop: true,
    autoplay: true,
  }));

  constructor() {
    effect(() => {
      const value = this.emoji();
      this.useAnimation.set(false);
      void hasNotoAnimation(value).then((available) => {
        if (value === this.emoji()) {
          this.useAnimation.set(available);
        }
      });
    });
  }
}
