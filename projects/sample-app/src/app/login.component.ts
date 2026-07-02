import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly router = inject(Router);

  readonly users = environment.users;

  selectUser(chatUserId: string): void {
    void this.router.navigate(['/chat'], {
      queryParams: { as: chatUserId },
    });
  }
}
