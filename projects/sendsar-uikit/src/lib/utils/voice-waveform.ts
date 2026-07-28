export interface SendsarVoicePlaybackData {
  previewUrl: string;
  durationSeconds: number;
  recordedAt: Date;
  waveform: number[];
  file?: File;
}

/** @deprecated Use SendsarVoicePlaybackData */
export type SendsarVoicePreviewData = SendsarVoicePlaybackData;

const VOICE_WAVEFORM_MIN_BARS = 48;
const VOICE_WAVEFORM_MAX_BARS = 80;

export function waveformBarCount(durationSeconds: number): number {
  const scaled = Math.round(42 + durationSeconds * 4.5);
  return Math.min(VOICE_WAVEFORM_MAX_BARS, Math.max(VOICE_WAVEFORM_MIN_BARS, scaled));
}

export async function buildVoiceWaveform(blob: Blob, barCount: number): Promise<number[]> {
  try {
    const audioContext = new AudioContext();
    const buffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(channel.length / barCount));
    const bars: number[] = [];

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const start = i * samplesPerBar;
      for (let j = 0; j < samplesPerBar; j++) {
        sum += Math.abs(channel[start + j] ?? 0);
      }
      bars.push(sum / samplesPerBar);
    }

    const max = Math.max(...bars, 0.01);
    await audioContext.close();
    return bars.map((value) => 0.2 + (value / max) * 0.8);
  } catch {
    return Array.from({ length: barCount }, (_, index) => {
      const wave = Math.abs(Math.sin(index * 0.55) * Math.cos(index * 0.18));
      return 0.25 + wave * 0.75;
    });
  }
}

function probeAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    const done = (seconds: number) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(Math.max(1, Math.floor(seconds)));
    };

    audio.addEventListener('loadedmetadata', () => done(audio.duration));
    audio.addEventListener('error', () => done(1));
    audio.src = url;
  });
}

export async function buildVoiceWaveformFromUrl(
  url: string,
  durationHint = 0,
  maxBars = VOICE_WAVEFORM_MAX_BARS,
): Promise<{ waveform: number[]; durationSeconds: number }> {
  const durationSeconds = durationHint > 0 ? durationHint : await probeAudioDuration(url);
  const barCount = Math.min(maxBars, waveformBarCount(durationSeconds));

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch audio');
    }

    const blob = await response.blob();
    const waveform = await buildVoiceWaveform(blob, barCount);
    return { waveform, durationSeconds };
  } catch {
    const waveform = Array.from({ length: barCount }, (_, index) => {
      const wave = Math.abs(Math.sin(index * 0.55) * Math.cos(index * 0.18));
      return 0.25 + wave * 0.75;
    });
    return { waveform, durationSeconds };
  }
}
