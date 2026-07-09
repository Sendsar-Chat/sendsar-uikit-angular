import { Provider } from '@angular/core';
import { provideLottieOptions } from 'ngx-lottie';
import player from 'lottie-web';

/**
 * Enable Noto animated emoji in message bubbles.
 * Add to your app providers alongside `provideSendsar()`.
 *
 * @see https://googlefonts.github.io/noto-emoji-animation/
 */
export function provideSendsarEmojiAnimation(): Provider[] {
  return provideLottieOptions({
    player: () => player,
  });
}
