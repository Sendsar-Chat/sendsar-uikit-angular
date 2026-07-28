export interface SendsarEmojiGroup {
  label: string;
  emojis: readonly string[];
}

export const DEFAULT_EMOJI_GROUPS: readonly SendsarEmojiGroup[] = [
  {
    label: 'Popular',
    emojis: ['👍', '❤️', '😂', '🔥', '🙏', '👏', '😭', '😍', '🎉', '😊', '✨', '🤔'],
  },
  {
    label: 'Smileys',
    emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🥳', '😭', '😡', '🤔'],
  },
  {
    label: 'People',
    emojis: ['🙌', '👋', '👌', '💪', '🤝', '👀', '✅', '❌', '👎', '🙏', '👏', '👍'],
  },
  {
    label: 'Hearts & Symbols',
    emojis: ['❤️', '💛', '💚', '💙', '💜', '🖤', '🤍', '💯', '⭐', '✨', '🔥', '🎯'],
  },
  {
    label: 'Celebration',
    emojis: ['🎉', '🥳', '🎊', '🙌', '👏', '🍾', '🏆', '🚀', '🌟', '🎂', '🎁', '🍀'],
  },
];
