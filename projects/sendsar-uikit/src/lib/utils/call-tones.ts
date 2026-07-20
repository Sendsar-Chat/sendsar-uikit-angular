/**
 * Lightweight Web Audio call cues (no asset files).
 * Patterns roughly mimic phone ringback / ringtone / hangup beep.
 */

type ToneHandle = {
  stop: () => void;
};

function getAudioContext(): AudioContext | null {
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) {
    return null;
  }
  return new Ctor();
}

function tone(
  ctx: AudioContext,
  frequency: number,
  durationMs: number,
  startAt: number,
  gain = 0.08,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(startAt);
  g.gain.setValueAtTime(gain, startAt);
  g.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);
  osc.stop(startAt + durationMs / 1000 + 0.02);
}

/** Outgoing ringback: repeating dual-tone burst. */
export function playRingback(): ToneHandle {
  const ctx = getAudioContext();
  if (!ctx) {
    return { stop: () => undefined };
  }
  void ctx.resume();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const burst = () => {
    if (stopped) return;
    const t0 = ctx.currentTime;
    tone(ctx, 440, 400, t0, 0.06);
    tone(ctx, 480, 400, t0, 0.06);
    timer = setTimeout(burst, 2000);
  };
  burst();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void ctx.close().catch(() => undefined);
    },
  };
}

/** Incoming ringtone: repeating ascending chirp. */
export function playRingtone(): ToneHandle {
  const ctx = getAudioContext();
  if (!ctx) {
    return { stop: () => undefined };
  }
  void ctx.resume();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const burst = () => {
    if (stopped) return;
    const t0 = ctx.currentTime;
    tone(ctx, 523.25, 180, t0, 0.09);
    tone(ctx, 659.25, 180, t0 + 0.2, 0.09);
    tone(ctx, 783.99, 220, t0 + 0.4, 0.09);
    timer = setTimeout(burst, 1600);
  };
  burst();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      void ctx.close().catch(() => undefined);
    },
  };
}

/** Short end/hangup beep. */
export function playEndTone(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  void ctx.resume().then(() => {
    const t0 = ctx.currentTime;
    tone(ctx, 320, 160, t0, 0.07);
    tone(ctx, 220, 220, t0 + 0.18, 0.07);
    setTimeout(() => void ctx.close().catch(() => undefined), 500);
  });
}
