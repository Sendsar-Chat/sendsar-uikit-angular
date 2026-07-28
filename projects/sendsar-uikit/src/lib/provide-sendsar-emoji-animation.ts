import { Provider } from '@angular/core';
import { provideLottieOptions } from 'ngx-lottie';
import player from 'lottie-web';

/**
 * Enable Noto animated emoji in message bubbles.
 * Included automatically by {@link provideSendsar} / {@link provideSendsarCore}.
 * Call directly only if you manage services yourself.
 *
 * @see https://googlefonts.github.io/noto-emoji-animation/
 */
export function provideSendsarEmojiAnimation(): Provider[] {
  return provideLottieOptions({
    player: () => player,
  });
}
