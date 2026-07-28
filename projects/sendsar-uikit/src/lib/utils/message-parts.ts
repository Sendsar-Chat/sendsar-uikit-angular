import type { Message, MessagePart } from '@sendsar/chat-sdk-javascript';
import {
  formatCallLogPreview,
  formatMembershipPreview,
  parseCallLogPart,
  parseMembershipPart,
  textFromMessageParts,
} from '@sendsar/chat-sdk-javascript';

export function filePartUrl(part: MessagePart): string | undefined {
  const url = part.url ?? part.accessUrl;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

export function isFilePart(part: MessagePart): boolean {
  return part.type === 'file' && Boolean(filePartUrl(part) || part.uploadId);
}

export function fileParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter(isFilePart);
}

/**
 * Socket `message-updated` payloads (e.g. reactions) often omit temporary
 * `accessUrl`s. Copy them from the previous local message so attachments stay visible.
 */
export function preserveFileAccessUrls(updated: Message, previous: Message | undefined): Message {
  if (!previous) return updated;

  const previousByUploadId = new Map<string, MessagePart>();
  for (const part of previous.parts) {
    if (part.type === 'file' && typeof part.uploadId === 'string' && filePartUrl(part)) {
      previousByUploadId.set(part.uploadId, part);
    }
  }
  if (previousByUploadId.size === 0) return updated;

  let changed = false;
  const parts = updated.parts.map((part) => {
    if (part.type !== 'file' || filePartUrl(part) || typeof part.uploadId !== 'string') {
      return part;
    }
    const prior = previousByUploadId.get(part.uploadId);
    if (!prior) return part;
    changed = true;
    return {
      ...part,
      url: part.url ?? prior.url,
      accessUrl: part.accessUrl ?? prior.accessUrl,
      accessUrlExpiresAt: part.accessUrlExpiresAt ?? prior.accessUrlExpiresAt,
    };
  });

  return changed ? { ...updated, parts } : updated;
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

/** Material Icons glyph name for a non-image, non-audio file attachment. */
export function fileIconName(part: MessagePart): string {
  return fileIconForDescriptor(part.filename ?? '', part.mediaType ?? '');
}

export function fileIconForFile(file: Pick<File, 'name' | 'type'>): string {
  return fileIconForAttachment(file.name, file.type);
}

export function fileIconForAttachment(name: string, mediaType = ''): string {
  return fileIconForDescriptor(name, mediaType);
}

export function filePreviewFromPart(part: MessagePart): {
  name: string;
  previewUrl?: string;
  mediaType?: string;
} {
  return {
    name: part.filename ?? 'Download file',
    previewUrl: isImagePart(part) ? filePartUrl(part) : undefined,
    mediaType: part.mediaType ?? '',
  };
}

function fileIconForDescriptor(name: string, media: string): string {
  const lowerName = name.toLowerCase();
  const lowerMedia = media.toLowerCase();

  if (lowerMedia.includes('pdf') || lowerName.endsWith('.pdf')) return 'picture_as_pdf';
  if (/\.(doc|docx)$/.test(lowerName) || lowerMedia.includes('word')) return 'description';
  if (/\.(xls|xlsx|csv)$/.test(lowerName) || lowerMedia.includes('spreadsheet') || lowerMedia.includes('excel')) {
    return 'table_chart';
  }
  if (/\.(ppt|pptx)$/.test(lowerName) || lowerMedia.includes('presentation')) return 'slideshow';
  if (/\.(zip|rar|7z|tar|gz)$/.test(lowerName) || lowerMedia.includes('zip')) return 'folder_zip';
  if (lowerMedia.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/.test(lowerName)) return 'videocam';
  return 'insert_drive_file';
}

export function messagePreview(
  message: Pick<Message, 'parts' | 'previewText' | 'deletedAt' | 'deletedHidden'>,
  deletedPlaceholder = 'Message deleted',
  selfUserId?: string,
): string {
  if (message.deletedHidden) return '';
  if (message.deletedAt) return deletedPlaceholder;
  const callLog = parseCallLogPart(message.parts);
  if (callLog) {
    return formatCallLogPreview(callLog, selfUserId);
  }
  const membership = parseMembershipPart(message.parts);
  if (membership) {
    return formatMembershipPreview(membership);
  }
  const text = textFromMessageParts(message.parts);
  if (text) return text;
  if (fileParts(message.parts).length > 0) return 'Attachment';
  return message.previewText ?? '';
}
