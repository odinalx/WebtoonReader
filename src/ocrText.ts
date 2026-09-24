// Turning Tesseract's word boxes into the text sent to the Dokhae server.
//
// Lives outside the offscreen document so it can be tested without loading
// Tesseract.

// Below this confidence (0–100) a token is treated as noise, but only when it
// carries no Hangul. Bubble outlines and tails come back as low-confidence
// quotes, dots and tildes; real syllables often do too (체 at 3, 너 at 47 on a
// bold webtoon font) and dropping those cut words in half ("너대체" → "대").
// A doubtful syllable is still better than a missing one: the server's
// segmenter and translator read it in context.
export const MIN_NOISE_CONFIDENCE = 50;
const HANGUL = /[가-힣]/;

export interface OcrWord {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; x1: number; y0: number; y1: number };
}

export interface OcrText {
  text: string;
  /**
   * Offsets in `text` of the Hangul syllables whose word was read below
   * MIN_NOISE_CONFIDENCE. The model cannot print 1,274 common syllables and
   * substitutes a look-alike (어둠 → 어돔), often at confidence 0: the server
   * needs less evidence to correct a syllable flagged here.
   */
  uncertain: number[];
}

// Rebuild the text line by line from Tesseract's words. Tesseract often
// reports each syllable of a bold line as its own "word", so words are joined
// with a space only where the image shows a real gap (more than a third of
// the line height), not after every token.
export function confidentText(data: { text?: string; blocks?: unknown }): OcrText {
  const blocks = data?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { text: (data?.text ?? '').trim(), uncertain: [] };
  }
  const lines: string[] = [];
  const uncertain: number[] = [];
  // Offset in the joined text where the current line starts.
  let lineStart = 0;
  for (const block of blocks as any[]) {
    for (const para of block?.paragraphs ?? []) {
      for (const line of para?.lines ?? []) {
        const words = ((line?.words ?? []) as OcrWord[]).filter((w) => {
          const t = String(w?.text ?? '').trim();
          if (!t) return false;
          return HANGUL.test(t) || (w.confidence ?? 0) >= MIN_NOISE_CONFIDENCE;
        });
        let out = '';
        let prev: OcrWord | null = null;
        const flagged: number[] = [];
        for (const w of words) {
          const t = String(w.text).trim();
          if (prev?.bbox && w.bbox) {
            const height = Math.max(1, w.bbox.y1 - w.bbox.y0);
            out += w.bbox.x0 - prev.bbox.x1 > height / 3 ? ' ' : '';
          } else if (prev) {
            out += ' ';
          }
          if ((w.confidence ?? 0) < MIN_NOISE_CONFIDENCE) {
            for (let i = 0; i < t.length; i++) if (HANGUL.test(t[i]!)) flagged.push(out.length + i);
          }
          out += t;
          prev = w;
        }
        if (!out) continue;
        if (lines.length) lineStart += 1; // the '\n' joining it to the previous line
        for (const i of flagged) uncertain.push(lineStart + i);
        lines.push(out);
        lineStart += out.length;
      }
    }
  }
  // Lines are never empty and words are trimmed, so the joined text has no
  // outer whitespace to trim and the offsets hold as they are.
  return { text: lines.join('\n'), uncertain };
}
