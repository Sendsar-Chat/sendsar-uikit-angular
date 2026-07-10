import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { DEFAULT_EMOJI_GROUPS, SendsarEmojiGroup } from '../../../utils/emoji-groups';
import { SendsarAnimatedEmojiComponent } from '../../mini-components/sendsar-animated-emoji/sendsar-animated-emoji.component';

@Component({
  selector: 'sc-emoji-picker',
  standalone: true,
  imports: [SendsarAnimatedEmojiComponent],  templateUrl: './sendsar-emoji-picker.component.html',
  styleUrl: './sendsar-emoji-picker.component.css',
})
export class SendsarEmojiPickerComponent {
  @Input() groups: readonly SendsarEmojiGroup[] = DEFAULT_EMOJI_GROUPS;
  @Output() readonly emojiSelected = new EventEmitter<string>();

  @HostListener('click', ['$event'])
  stopPropagation(event: MouseEvent): void {
    event.stopPropagation();
  }

  selectEmoji(emoji: string): void {
    this.emojiSelected.emit(emoji);
  }
}
