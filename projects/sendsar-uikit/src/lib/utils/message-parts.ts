import type { Message, MessagePart } from '@sendsar/chat-sdk-javascript';
import { textFromMessageParts } from '@sendsar/chat-sdk-javascript';

export function fileParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((p) => p.type === 'file' && typeof p.url === 'string');
}

export function isImagePart(part: MessagePart): boolean {
  const media = part.mediaType ?? '';
  return media.startsWith('image/');
}

export function messagePreview(
  message: Pick<Message, 'parts' | 'previewText' | 'deletedAt' | 'deletedHidden'>,
  deletedPlaceholder = 'Message deleted',
): string {
  if (message.deletedHidden) return '';
  if (message.deletedAt) return deletedPlaceholder;
  const text = textFromMessageParts(message.parts);
  if (text) return text;
  if (fileParts(message.parts).length > 0) return 'Attachment';
  return message.previewText ?? '';
}
