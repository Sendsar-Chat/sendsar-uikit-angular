import { InjectionToken } from '@angular/core';
import type { SessionResponse } from '@sendsar/chat-sdk-javascript';

/** Configuration for {@link provideSendsar} / {@link SendsarChatModule.forRoot}. */
export interface SendsarConfig {
  /** Fetch session JWT from your backend (never use `sk_*` in the browser). */
  fetchSession: () => Promise<Response | SessionResponse>;
  refreshBeforeExpiryMs?: number;
  /** Noto animated emoji in message bubbles (default: true). */
  animatedEmoji?: boolean;
  /**
   * When true (default), `<sc-chat-shell>` calls `session.start()` on init.
   * Set false if your app starts the session itself before rendering the shell.
   */
  autoStartSession?: boolean;
}

export const SENDSAR_CONFIG = new InjectionToken<SendsarConfig>('SENDSAR_CONFIG');
