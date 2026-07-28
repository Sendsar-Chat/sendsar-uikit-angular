import { Injectable } from '@angular/core';
import type { SessionResponse } from '@sendsar/chat-sdk-javascript';
import { environment, type DemoUser } from '../environments/environment';

/**
 * Calls the sample tenant backend (`sample-bff/`).
 * In your app, replace this with `fetch('/api/chat/session')` to your own server.
 */
@Injectable({ providedIn: 'root' })
export class DemoSessionService {
  async fetchSession(identity: DemoUser): Promise<SessionResponse> {
    const res = await fetch('/api/chat/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatUserId: identity.chatUserId,
        displayName: identity.displayName,
        seedUsers: environment.users,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Session failed: ${res.status}`);
    }

    return (await res.json()) as SessionResponse;
  }
}
