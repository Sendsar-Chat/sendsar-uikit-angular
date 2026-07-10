import type { Message, MessagePart } from '@sendsar/chat-sdk-javascript';
import { textFromMessageParts } from '@sendsar/chat-sdk-javascript';

export function filePartUrl(part: MessagePart): string | undefined {
  const url = part.url ?? part.accessUrl;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

export function fileParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((part) => part.type === 'file' && filePartUrl(part));
}

export function isImagePart(part: MessagePart): boolean {
  const media = part.mediaType ?? '';
  return media.startsWith('image/');
}

export function isAudioPart(part: MessagePart): boolean {
  const media = part.mediaType ?? '';
  if (media.startsWith('audio/')) {
    return true;
  }

  const filename = part.filename ?? '';
  return /^voice-message-/i.test(filename) || /\.(webm|m4a|mp3|ogg|wav|aac)(\?|$)/i.test(filename);
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
