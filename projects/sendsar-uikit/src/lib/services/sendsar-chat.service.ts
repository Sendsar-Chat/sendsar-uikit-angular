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
  UploadFileResult,
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
      /** Optional caption sent in the same message as the file part. */
      text?: string;
    },
  ): Promise<Message> {
    const { text, ...fileParams } = params;
    const caption = text?.trim();

    if (!caption) {
      return this.requireClient().sendFileMessage(roomId, fileParams);
    }

    return this.requireClient()
      .uploadFile({ ...fileParams, roomId })
      .then((uploaded) =>
        this.sendMessage(roomId, {
          parts: [
            {
              type: 'file',
              uploadId: uploaded.uploadId,
              mediaType: uploaded.mediaType,
              filename: uploaded.filename,
            },
            { type: 'text', text: caption },
          ],
          clientMessageId: params.clientMessageId,
          parentMessageId: params.parentMessageId,
          senderId: params.senderId,
        }),
      );
  }

  uploadFile(roomId: string, params: UploadFileParams): Promise<UploadFileResult> {
    return this.requireClient().uploadFile({ ...params, roomId });
  }
}
