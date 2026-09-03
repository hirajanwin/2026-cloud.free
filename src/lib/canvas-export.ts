/**
 * Canvas → image. The canvas registers an exporter when it mounts (it needs
 * React Flow's viewport maths); tools and buttons call exportCanvasImage.
 */
export interface CanvasImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}
export interface ExportOptions {
  /** Device pixels per canvas pixel. 2 for crisp slides. */
  scale?: number;
  /** Padding around the diagram, canvas pixels. */
  padding?: number;
}

let exporter: ((opts: ExportOptions) => Promise<CanvasImage>) | null = null;

export function registerCanvasExporter(fn: typeof exporter): () => void {
  exporter = fn;
  return () => {
    if (exporter === fn) exporter = null;
  };
}

export async function exportCanvasImage(opts: ExportOptions = {}): Promise<CanvasImage> {
  if (!exporter) throw new Error("The canvas is not mounted, so there is nothing to export.");
  return exporter(opts);
}

/** Hand the image to the browser as a download. */
export function downloadImage(img: CanvasImage, filename: string) {
  const a = document.createElement("a");
  a.href = img.dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function safeFilename(title: string | undefined): string {
  const base = (title ?? "freenet").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "freenet"}.png`;
}
