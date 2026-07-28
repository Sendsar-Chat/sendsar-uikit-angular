import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { fileIconForAttachment } from '../../../utils/message-parts';

export type SendsarFilePreviewData = {
  name: string;
  previewUrl?: string;
  mediaType?: string;
  /** Local file pending upload (composer only). */
  file?: File;
};

@Component({
  selector: 'sc-file-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sendsar-file-preview.component.html',
  styleUrl: './sendsar-file-preview.component.css',
})
export class SendsarFilePreviewComponent {
  @Input({ required: true }) attachment!: SendsarFilePreviewData;
  @Input() href: string | null = null;
  @Input() disabled = false;
  @Input() removable = true;
  @Input() tone: 'default' | 'inverted' = 'default';
  @Output() readonly removed = new EventEmitter<void>();

  iconName(): string {
    return fileIconForAttachment(this.attachment.name, this.attachment.mediaType ?? '');
  }

  isImagePreview(): boolean {
    if (!this.attachment.previewUrl) {
      return false;
    }

    const media = this.attachment.mediaType ?? '';
    if (media.startsWith('image/')) {
      return true;
    }

    return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(this.attachment.name);
  }
}
