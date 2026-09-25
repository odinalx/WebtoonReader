/** Hangul syllables + compatibility/conjoining Jamo. */
export const HANGUL_RE = /[가-힣㄰-㆏ᄀ-ᇿ]/;

/** Longest selection worth sending: a bubble or a paragraph, not a page. */
export const MAX_SELECTION = 500;

/**
 * The page selection as the popup offers it: trimmed, whitespace collapsed,
 * capped, and only when it holds some Korean. Null otherwise.
 */
export function koreanSelection(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTION);
  return text && HANGUL_RE.test(text) ? text : null;
}
