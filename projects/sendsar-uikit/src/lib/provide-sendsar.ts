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
 * Session + chat + call services (and animated emoji by default).
 * Use with a separate `SENDSAR_CONFIG` provider when config needs `inject()`.
 *
 * Prefer {@link provideSendsar} or {@link SendsarChatModule.forRoot} for a full setup.
 */
export function provideSendsarCore(options?: { animatedEmoji?: boolean }): EnvironmentProviders {
  const animatedEmoji = options?.animatedEmoji !== false;
  return makeEnvironmentProviders(sendsarServiceProviders(animatedEmoji));
}

/**
 * Register all Sendsar UI kit services for a standalone Angular app.
 *
 * ```ts
 * providers: [
 *   provideSendsar({
 *     fetchSession: () => fetch('/api/chat/session').then((r) => r.json()),
 *   }),
 * ]
 * ```
 *
 * Then render `<sc-chat-shell [users]="users" />` — session starts automatically.
 *
 * For NgModule apps, use {@link SendsarChatModule.forRoot}.
 */
export function provideSendsar(config: SendsarConfig): EnvironmentProviders {
  const animatedEmoji = config.animatedEmoji !== false;
  return makeEnvironmentProviders([
    { provide: SENDSAR_CONFIG, useValue: config },
    ...sendsarServiceProviders(animatedEmoji),
  ]);
}
