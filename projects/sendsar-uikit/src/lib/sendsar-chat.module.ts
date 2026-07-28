import { ModuleWithProviders, NgModule } from '@angular/core';
import type { SendsarConfig } from './config/sendsar-config';
import { SENDSAR_CONFIG } from './config/sendsar-config';
import { provideSendsarEmojiAnimation } from './provide-sendsar-emoji-animation';
import { SendsarCallService } from './services/sendsar-call.service';
import { SendsarChatService } from './services/sendsar-chat.service';
import { SendsarSessionService } from './services/sendsar-session.service';
import { SendsarChatShellComponent } from './components/sendsar-chat-shell/sendsar-chat-shell.component';

/**
 * Drop-in NgModule for classic Angular apps.
 *
 * ```ts
 * @NgModule({
 *   imports: [
 *     SendsarChatModule.forRoot({
 *       fetchSession: () => fetch('/api/chat/session').then((r) => r.json()),
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Then in any template: `<sc-chat-shell [users]="users" />`
 *
 * For standalone apps, prefer {@link provideSendsar} in `app.config.ts`.
 */
@NgModule({
  imports: [SendsarChatShellComponent],
  exports: [SendsarChatShellComponent],
})
export class SendsarChatModule {
  static forRoot(config: SendsarConfig): ModuleWithProviders<SendsarChatModule> {
    const animatedEmoji = config.animatedEmoji !== false;
    return {
      ngModule: SendsarChatModule,
      providers: [
        { provide: SENDSAR_CONFIG, useValue: config },
        SendsarSessionService,
        SendsarChatService,
        SendsarCallService,
        ...(animatedEmoji ? provideSendsarEmojiAnimation() : []),
      ],
    };
  }
}
