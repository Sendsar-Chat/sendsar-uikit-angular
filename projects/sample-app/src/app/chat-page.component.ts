import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  SendsarChatShellComponent,
  SendsarSessionService,
  type UserDirectoryEntry,
} from 'sendsar-uikit';
import { SendsarIdentityService } from './sendsar-identity.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, RouterLink, SendsarChatShellComponent],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly identityService = inject(SendsarIdentityService);
  private readonly sendsarSession = inject(SendsarSessionService);

  readonly identity = signal<{ chatUserId: string; displayName: string } | null>(null);
  readonly peers = environment.users;
  readonly userDirectory = computed<UserDirectoryEntry[]>(() =>
    this.peers.map((u) => ({ id: u.chatUserId, displayName: u.displayName })),
  );

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
}
