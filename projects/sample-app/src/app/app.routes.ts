import { Routes } from '@angular/router';
import { ChatPageComponent } from './chat-page.component';
import { LoginComponent } from './login.component';

export const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'chat', component: ChatPageComponent },
  { path: '**', redirectTo: '' },
];
