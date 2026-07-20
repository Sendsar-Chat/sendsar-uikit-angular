import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  SendsarChatShellComponent,
  SendsarSessionService,
  type UserDirectoryEntry,
} from 'sendsar-uikit';
import { DemoSessionService } from './demo-session.service';
import {
  NewChatDialogComponent,
  type NewChatRequest,
} from './new-chat-dialog.component';
import { SendsarIdentityService } from './sendsar-identity.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, RouterLink, SendsarChatShellComponent, NewChatDialogComponent],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly demoSession = inject(DemoSessionService);
  private readonly identityService = inject(SendsarIdentityService);
  private readonly sendsarSession = inject(SendsarSessionService);

  @ViewChild(SendsarChatShellComponent)
  chatShell?: SendsarChatShellComponent;

  readonly emptyOnline = new Set<string>();

  readonly identity = signal<{ chatUserId: string; displayName: string } | null>(null);
  readonly peers = environment.users;
  readonly userDirectory = computed<UserDirectoryEntry[]>(() =>
    this.peers.map((u) => ({ id: u.chatUserId, displayName: u.displayName })),
  );
  readonly showNewChat = signal(false);
  readonly creatingChat = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const as = this.route.snapshot.queryParamMap.get('as');
    const user = environment.users.find((u) => u.chatUserId === as);
    if (!user) {
      void this.router.navigate(['/']);
      return;
    }
    this.identity.set(user);
    this.identityService.identity.set(user);
    void this.sendsarSession.start();
  }

  openNewChat(): void {
    this.error.set(null);
    this.showNewChat.set(true);
  }

  closeNewChat(): void {
    this.showNewChat.set(false);
  }

  async onNewChat(request: NewChatRequest): Promise<void> {
    const self = this.identity();
    if (!self) return;

    this.creatingChat.set(true);
    this.error.set(null);

    try {
      let roomId: string;
      let openOpts: {
        title?: string;
        externalId?: string;
        customType?: string;
      };

      if (request.kind === 'direct') {
        roomId = await this.demoSession.ensureDirectMessage(
          self.chatUserId,
          request.peerId,
        );
        openOpts = {
          externalId: `dm:${[self.chatUserId, request.peerId].sort().join(':')}`,
          customType: 'demo_dm',
        };
      } else {
        roomId = await this.demoSession.ensureGroup(
          self.chatUserId,
          request.name,
          request.memberIds,
        );
        openOpts = { title: request.name, customType: 'demo_group' };
      }

      this.showNewChat.set(false);
      await this.chatShell?.openRoom(roomId, openOpts);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to create chat');
    } finally {
      this.creatingChat.set(false);
    }
  }
}
