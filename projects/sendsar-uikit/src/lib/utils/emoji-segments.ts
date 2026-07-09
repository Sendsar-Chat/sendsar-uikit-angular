export type TextSegment =
  | { type: 'text'; value: string }
  | { type: 'emoji'; value: string };

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Split message text into plain text runs and emoji graphemes. */
export function segmentTextWithEmoji(text: string): TextSegment[] {
  if (!text) {
    return [];
  }

  const segments: TextSegment[] = [];
  let textBuffer = '';

  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (EMOJI_PATTERN.test(segment)) {
      if (textBuffer) {
        segments.push({ type: 'text', value: textBuffer });
        textBuffer = '';
      }
      segments.push({ type: 'emoji', value: segment });
    } else {
      textBuffer += segment;
    }
  }

  if (textBuffer) {
    segments.push({ type: 'text', value: textBuffer });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }];
}
