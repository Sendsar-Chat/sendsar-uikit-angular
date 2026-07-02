import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import type { SendsarConfig } from './config/sendsar-config';
import { SENDSAR_CONFIG } from './config/sendsar-config';
import { SendsarChatService } from './services/sendsar-chat.service';
import { SendsarSessionService } from './services/sendsar-session.service';

/** Register Sendsar session + chat services for your Angular app. */
export function provideSendsar(config: SendsarConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: SENDSAR_CONFIG, useValue: config },
    SendsarSessionService,
    SendsarChatService,
  ]);
}
