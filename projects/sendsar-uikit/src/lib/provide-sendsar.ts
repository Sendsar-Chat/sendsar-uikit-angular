import { EnvironmentProviders, makeEnvironmentProviders, type Provider } from '@angular/core';
import type { SendsarConfig } from './config/sendsar-config';
import { SENDSAR_CONFIG } from './config/sendsar-config';
import { provideSendsarEmojiAnimation } from './provide-sendsar-emoji-animation';
import { SendsarCallService } from './services/sendsar-call.service';
import { SendsarChatService } from './services/sendsar-chat.service';
import { SendsarSessionService } from './services/sendsar-session.service';

function sendsarServiceProviders(animatedEmoji = true): Provider[] {
  return [
    SendsarSessionService,
    SendsarChatService,
    SendsarCallService,
    ...(animatedEmoji ? provideSendsarEmojiAnimation() : []),
  ];
}

/**
 * Session + chat services (and animated emoji by default).
 * Use with a separate `SENDSAR_CONFIG` provider when config needs `inject()`.
 */
export function provideSendsarCore(options?: { animatedEmoji?: boolean }): EnvironmentProviders {
  const animatedEmoji = options?.animatedEmoji !== false;
  return makeEnvironmentProviders(sendsarServiceProviders(animatedEmoji));
}

/** Register Sendsar session + chat services for your Angular app. */
export function provideSendsar(config: SendsarConfig): EnvironmentProviders {
  const animatedEmoji = config.animatedEmoji !== false;
  return makeEnvironmentProviders([
    { provide: SENDSAR_CONFIG, useValue: config },
    ...sendsarServiceProviders(animatedEmoji),
  ]);
}
