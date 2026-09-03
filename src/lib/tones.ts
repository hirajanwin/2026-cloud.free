/**
 * One stable hue per node so the canvas, the layer list and the timeline all
 * point at the same thing with the same colour. Chosen to stay clear of the
 * request-class colours (green humans, blue search, amber AI, red bots).
 */
export const NODE_TONES = [
  "#7dd3fc", // sky
  "#c4b5fd", // violet
  "#f9a8d4", // pink
  "#fcd34d", // amber
  "#6ee7b7", // mint
  "#fdba74", // orange
  "#a5b4fc", // indigo
  "#f0abfc", // fuchsia
  "#bef264", // lime
  "#67e8f9", // cyan
  "#fda4af", // rose
  "#d9f99d", // chartreuse
];

export function toneAt(index: number): string {
  return NODE_TONES[((index % NODE_TONES.length) + NODE_TONES.length) % NODE_TONES.length];
}

/** Tone for a node id given the document's node order. */
export function toneFor(id: string, ids: readonly string[]): string {
  const i = ids.indexOf(id);
  return toneAt(i < 0 ? ids.length : i);
}
