# Sendsar UI Kit for Angular

Ready-to-use chat UI for Angular, built on [`@sendsar/chat-sdk-javascript`](https://www.npmjs.com/package/@sendsar/chat-sdk-javascript).

The **sample app** is a full-feature demo: direct messages, groups, images/files, reactions, typing indicators, read receipts, presence, edit/delete, and pagination.

## Auth model

| | **Your server** | **Browser** |
|---|-----------------|-------------|
| **Credential** | `sk_*` in `sample-bff/.env` | Session JWT only |
| **Calls** | Mint token, create rooms | Chat REST + WebSocket |

```text
Browser → your server   POST /api/chat/session   → JWT
Browser → Sendsar gateway                      → chat (Bearer JWT)
```

> `sample-bff/` is a demo — it skips real login. In production, authenticate **your** user before minting a JWT.

## Quick start

**Prerequisites:** Node.js 18+, a Sendsar tenant API key ([docs](https://docs.sendsar.com/setup/authentication)).

```bash
git clone https://github.com/Sendsar-Chat/sendsar-uikit-angular.git
cd sendsar-uikit-angular
npm install
npm run setup
# Edit sample-bff/.env → SENDSAR_API_KEY
npm start
```

Open **http://localhost:4300**.

## Sample app features

| Feature | How it works |
|---------|----------------|
| **Direct messages** | BFF `POST /api/chat/demo/ensure-dm` — deduped by `externalId`, friendly labels via user directory |
| **Groups** | BFF `POST /api/chat/demo/ensure-group` — named room + participants |
| **Text + attachments** | Composer: text, image upload (≤200 KB demo), or hosted file URL |
| **Reactions** | Quick emoji on messages → `toggleReaction()` |
| **Typing** | `ComposerTypingController` + thread header indicator |
| **Read receipts** | ✓ / ✓✓ on your messages in 1:1 |
| **Presence** | Online dot in sidebar (DM) and new-chat picker |
| **Edit / delete** | Sender-only actions on your messages |
| **Leave / delete / clear** | Conversation overflow + room info: leave group, hide DM, clear history for you |
| **Group members** | Room info: list, OPERATOR add/kick; membership system lines in the thread |
| **Pagination** | “Load older messages” in thread |
| **Fast conversation switch** | In-memory thread cache — revisited rooms open without a loading flash |

## Integrate in your app

Install:

```bash
npm install @sendsar/chat-uikit-angular @sendsar/chat-sdk-javascript @sendsar/call-sdk-javascript @sendsar/protocol
```

### Option A — NgModule apps

```ts
import { NgModule } from '@angular/core';
import { SendsarChatModule } from '@sendsar/chat-uikit-angular';

@NgModule({
  imports: [
    SendsarChatModule.forRoot({
      fetchSession: () => fetch('/api/chat/session').then((r) => r.json()),
    }),
  ],
})
export class AppModule {}
```

```html
<!-- any component template -->
<sc-chat-shell [users]="users" />
```

`forRoot` registers **all** UI kit services (`SendsarSessionService`, `SendsarChatService`, `SendsarCallService`, emoji).  
`<sc-chat-shell>` **auto-starts** the session — you do not call `session.start()` yourself.

### Option B — Standalone apps (Angular 15+)

```ts
import { ApplicationConfig } from '@angular/core';
import { provideSendsar } from '@sendsar/chat-uikit-angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideSendsar({
      fetchSession: () => fetch('/api/chat/session').then((r) => r.json()),
    }),
  ],
};
```

```ts
import { Component } from '@angular/core';
import { SendsarChatShellComponent, type UserDirectoryEntry } from '@sendsar/chat-uikit-angular';

@Component({
  standalone: true,
  imports: [SendsarChatShellComponent],
  template: `<sc-chat-shell [users]="users" />`,
})
export class ChatPageComponent {
  users: UserDirectoryEntry[] = [
    { id: 'usr_alice', displayName: 'Alice' },
  ];
}
```

Pass a **user directory** (`{ id, displayName }[]`) so DM rooms show peer names instead of internal ids.

Your backend must mint a session JWT (never put `sk_*` in the browser). See the [JavaScript SDK docs](https://docs.sendsar.com/sdk/javascript/html).

Also add Material Icons (used by call / action buttons):

```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
```

## UI kit components

| Component | Description |
|-----------|-------------|
| `SendsarChatShellComponent` | Inbox + thread, typing, presence, mobile layout |
| `SendsarConversationListComponent` | Rooms, unread badges, avatars |
| `SendsarMessageListComponent` | Live messages, media, reactions, receipts; caches threads when switching rooms |
| `SendsarComposerComponent` | Text + attachments + typing |

**Scripts:** `npm run build:lib` · `npm run build` (lib + sample app)

## Repository layout

| Path | Purpose |
|------|---------|
| `projects/sendsar-uikit/` | Publishable library `@sendsar/chat-uikit-angular` |
| `projects/sample-app/` | Demo Angular app |
| `sample-bff/` | Demo backend (session JWT + room helpers) |

## License

MIT
