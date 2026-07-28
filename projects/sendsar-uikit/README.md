# @sendsar/chat-uikit-angular

Angular chat components for Sendsar.

## Install

```bash
npm install @sendsar/chat-uikit-angular @sendsar/chat-sdk-javascript @sendsar/call-sdk-javascript @sendsar/protocol
```

## Use (drop-in)

### NgModule

```ts
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
<sc-chat-shell [users]="users" />
```

### Standalone

```ts
providers: [
  provideSendsar({
    fetchSession: () => fetch('/api/chat/session').then((r) => r.json()),
  }),
]
```

```html
<sc-chat-shell [users]="users" />
```

`forRoot` / `provideSendsar` registers session, chat, and call services.  
`<sc-chat-shell>` auto-starts the session.

Include the stylesheet (theme tokens + Material Icons font helper):

```ts
// angular.json styles
"node_modules/@sendsar/chat-uikit-angular/styles/sendsar-uikit.css"
```

### Light / dark

Set `data-theme="light"` or `data-theme="dark"` on `<html>`. The kit reads `--sc-*` CSS variables from that attribute.

```ts
document.documentElement.setAttribute('data-theme', 'dark');
```

See the [repository README](../../README.md) for the sample app and full guide.
