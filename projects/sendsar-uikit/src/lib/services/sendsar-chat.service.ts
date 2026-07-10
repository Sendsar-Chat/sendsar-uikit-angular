import { Injectable, inject } from '@angular/core';
import type {
  ListMessagesParams,
  ListRoomsParams,
  Message,
  RoomSummary,
  SendMessageParams,
  ToggleReactionParams,
  UpdateMessageParams,
  UploadFileParams,
} from '@sendsar/chat-sdk-javascript';
import { SendsarSessionService } from './sendsar-session.service';

@Injectable()
export class SendsarChatService {
  private readonly session = inject(SendsarSessionService);

  requireClient() {
    const client = this.session.client;
    if (!client) {
      throw new Error('Sendsar client is not connected');
    }
    return client;
  }

  listRooms(params?: ListRoomsParams): Promise<{ rooms: RoomSummary[]; nextCursor: string | null }> {
    return this.requireClient().listRooms(params);
  }

  getMessages(roomId: string, params?: ListMessagesParams) {
    return this.requireClient().getMessages(roomId, params);
  }

  sendMessage(roomId: string, params: SendMessageParams): Promise<Message> {
    return this.requireClient().sendMessage(roomId, params);
  }

  updateMessage(roomId: string, messageId: string, params: UpdateMessageParams): Promise<Message> {
    return this.requireClient().updateMessage(roomId, messageId, params);
  }

  deleteMessage(roomId: string, messageId: string): Promise<Message> {
    return this.requireClient().deleteMessage(roomId, messageId);
  }

  toggleReaction(
    roomId: string,
    messageId: string,
    params: ToggleReactionParams,
  ): Promise<Message> {
    return this.requireClient().toggleReaction(roomId, messageId, params);
  }

  sendFileMessage(
    roomId: string,
    params: UploadFileParams & {
      clientMessageId?: string;
      parentMessageId?: string;
      senderId?: string;
    },
  ): Promise<Message> {
    return this.requireClient().sendFileMessage(roomId, params);
  }
}
