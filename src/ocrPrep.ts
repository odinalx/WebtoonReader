// Turn a captured speech bubble into what Tesseract reads best: black text on
// a clean white page.
//
// A webtoon crop is rarely just text. The frame catches the bubble outline,
// the tail, a corner of the panel or some artwork, and Tesseract reads those
// strokes as glyphs (quotes, tildes, stray syllables). Measured on a
// 162-line bench of rendered bubbles, this cleanup roughly halved the
// character error rate compared with a plain grayscale and contrast stretch:
//
//   1. grayscale, compositing transparency onto white;
//   2. binarize with Otsu's threshold (picks the split between ink and paper
//      from the histogram, so tinted and dark bubbles work too);
//   3. invert when the text is light on a dark background;
//   4. erase every dark region connected to the image border: the bubble
//      outline and panel corners touch the frame, the text inside does not;
//   5. add a white margin, since Tesseract misses glyphs flush with an edge.
//
// Pure functions on raw RGBA so they run in the service worker (on an
// OffscreenCanvas's ImageData), in Node for the bench, and in unit tests.

export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export const OCR_MARGIN = 20;

/** Luma of each pixel, with transparent pixels treated as white paper. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const n = width * height;
  const gray = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const luma = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    const a = rgba[i + 3] / 255;
    gray[p] = Math.round(luma * a + 255 * (1 - a));
  }
  return gray;
}

/**
 * Otsu's threshold: the gray level that best separates the histogram into two
 * classes. Pixels strictly above it count as paper.
 */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length || 1;
  let meanTotal = 0;
  for (let v = 0; v < 256; v++) meanTotal += v * hist[v];
  meanTotal /= total;

  let best = 0;
  let bestVar = -1;
  let w = 0;
  let m = 0;
  for (let v = 0; v < 256; v++) {
    const p = hist[v] / total;
    w += p;
    m += v * p;
    const between = (meanTotal * w - m) ** 2 / (w * (1 - w) + 1e-9);
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  return best;
}

/**
 * Clear (set to paper) every ink pixel 4-connected to the image border.
 * `ink` is 1 for ink, 0 for paper, modified in place. Returns how many ink
 * pixels were cleared.
 */
export function clearBorderInk(ink: Uint8Array, width: number, height: number): number {
  const stack = new Int32Array(width * height);
  let top = 0;
  let cleared = 0;
  const push = (p: number) => {
    if (ink[p]) {
      ink[p] = 0;
      cleared++;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < width * (height - 1)) push(p + width);
  }
  return cleared;
}

/**
 * The whole cleanup: RGBA in, black-on-white RGBA out, `margin` pixels wider
 * on every side.
 */
export function prepareForOcr(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  margin = OCR_MARGIN,
): RgbaImage {
  const gray = toGray(rgba, width, height);
  const t = otsuThreshold(gray);
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] > t ? 0 : 1;

  // Polarity: the middle of a bubble is mostly paper. If the centre is
  // mostly "ink", the text is light on a dark background: swap the classes.
  const y0 = Math.floor(height / 4);
  const y1 = Math.max(y0 + 1, Math.floor((3 * height) / 4));
  const x0 = Math.floor(width / 6);
  const x1 = Math.max(x0 + 1, Math.floor((5 * width) / 6));
  let inkCount = 0;
  let count = 0;
  for (let y = y0; y < Math.min(y1, height); y++) {
    for (let x = x0; x < Math.min(x1, width); x++) {
      inkCount += ink[y * width + x];
      count++;
    }
  }
  if (count > 0 && inkCount / count > 0.5) {
    for (let i = 0; i < ink.length; i++) ink[i] ^= 1;
  }

  // A frame so tight that the text itself touches the edge would lose
  // everything to the border cleanup; keep the plain binarization then.
  const before = ink.slice();
  const inkTotal = before.reduce((s, v) => s + v, 0);
  const cleared = clearBorderInk(ink, width, height);
  const kept = cleared === inkTotal && inkTotal > 0 ? before : ink;

  const outW = width + 2 * margin;
  const outH = height + 2 * margin;
  const out = new Uint8ClampedArray(outW * outH * 4).fill(255);
  for (let y = 0; y < height; y++) {
    let o = ((y + margin) * outW + margin) * 4;
    for (let x = 0, p = y * width; x < width; x++, p++, o += 4) {
      if (kept[p]) out[o] = out[o + 1] = out[o + 2] = 0;
    }
  }
  return { data: out, width: outW, height: outH };
}
