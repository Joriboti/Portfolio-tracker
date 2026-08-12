// Browser download helpers for the generated artefacts.

/** Save a Blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  // Revoking synchronously can cancel the download in some browsers; one turn
  // of the event loop is enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * Rasterise a self-contained SVG string at `scale` and download it as a PNG.
 *
 * The SVG must reference nothing external — an <img> loaded from a blob URL is
 * a clean origin, so any remote reference would taint the canvas and make
 * toBlob() throw.
 */
export function downloadSvgAsPng(
  svg: string,
  filename: string,
  width: number,
  height: number,
  scale = 2,
): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return;
    }
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      if (b) downloadBlob(b, filename);
    }, "image/png");
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
