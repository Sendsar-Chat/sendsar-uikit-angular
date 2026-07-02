import { InjectionToken } from '@angular/core';
import type { SessionResponse } from '@sendsar/chat-sdk-javascript';

/** Configuration for {@link provideSendsar}. */
export interface SendsarConfig {
  /** Fetch session JWT from your backend (never use `sk_*` in the browser). */
  fetchSession: () => Promise<Response | SessionResponse>;
  refreshBeforeExpiryMs?: number;
}

export const SENDSAR_CONFIG = new InjectionToken<SendsarConfig>('SENDSAR_CONFIG');
