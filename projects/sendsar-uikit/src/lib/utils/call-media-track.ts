/** Minimal LiveKit Track surface used by the call overlay. */
export type SendsarCallMediaTrack = {
  kind: string;
  attach(element: HTMLMediaElement): HTMLMediaElement;
  detach(element?: HTMLMediaElement): HTMLMediaElement[];
};
