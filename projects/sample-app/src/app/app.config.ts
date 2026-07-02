import { ApplicationConfig, inject, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  SENDSAR_CONFIG,
  SendsarChatService,
  SendsarSessionService,
} from 'sendsar-uikit';
import { routes } from './app.routes';
import { DemoSessionService } from './demo-session.service';
import { SendsarIdentityService } from './sendsar-identity.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: SENDSAR_CONFIG,
      useFactory: () => {
        const demo = inject(DemoSessionService);
        const identitySvc = inject(SendsarIdentityService);
        return {
          fetchSession: () => {
            const identity = identitySvc.identity();
            if (!identity) {
              return Promise.reject(new Error('No demo user selected'));
            }
            return demo.fetchSession(identity);
          },
        };
      },
    },
    SendsarSessionService,
    SendsarChatService,
  ],
};
