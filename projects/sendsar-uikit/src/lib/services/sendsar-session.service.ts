import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  createSessionManager,
  type SessionManagerState,
  type SendsarClient,
  type SessionResponse,
} from '@sendsar/chat-sdk-javascript';
import { SENDSAR_CONFIG } from '../config/sendsar-config';

@Injectable()
export class SendsarSessionService {
  private readonly config = inject(SENDSAR_CONFIG);
  private readonly destroyRef = inject(DestroyRef);
  private readonly manager = createSessionManager({
    fetchSession: () => this.config.fetchSession(),
    refreshBeforeExpiryMs: this.config.refreshBeforeExpiryMs,
    onStateChange: (state) => this.stateSignal.set(state),
  });

  private readonly stateSignal = signal<SessionManagerState>(this.manager.getState());

  readonly state = this.stateSignal.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      void this.manager.stop();
    });
  }

  get client(): SendsarClient | null {
    return this.state().client;
  }

  get session(): SessionResponse | null {
    return this.state().session;
  }

  get isReady(): boolean {
    return this.state().status === 'ready';
  }

  start(): Promise<void> {
    return this.manager.start();
  }

  stop(): Promise<void> {
    return this.manager.stop();
  }

  restart(): Promise<void> {
    return this.manager.restart();
  }
}
