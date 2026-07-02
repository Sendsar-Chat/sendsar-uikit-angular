import { Injectable, signal } from '@angular/core';
import type { DemoUser } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class SendsarIdentityService {
  readonly identity = signal<DemoUser | null>(null);
}
