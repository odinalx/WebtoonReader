import { describe, expect, it } from 'vitest';
import { romanize } from '../romanize';

/**
 * Romanization is the one piece of the extension that turns Korean into text a
 * beginner can pronounce, and it is what gets stored as a card's `reading` — so
 * a regression here is written into the deck permanently.
 *
 * The tests pin the documented behaviour rather than Revised Romanization:
 * no sound-change rules, one hyphen between syllables, pass-through for
 * anything that isn't a Hangul syllable block.
 */
describe('romanize', () => {
  it('decomposes a syllable into initial, medial and final', () => {
    expect(romanize('안')).toBe('an');
    expect(romanize('밥')).toBe('bab');
  });

  it('hyphenates between syllables', () => {
    expect(romanize('안녕')).toBe('an-nyeong');
    expect(romanize('사랑')).toBe('sa-rang');
  });

  it('reads a final ㅇ as ng and a bare initial ㅇ as nothing', () => {
    expect(romanize('아')).toBe('a');
    expect(romanize('강')).toBe('gang');
  });

  it('does not apply sound changes — a final ㄱ stays g', () => {
    // The module says so explicitly: 속에서 is a reading hint, not RR, which
    // would give "sog-eseo" with liaison.
    expect(romanize('속에서')).toBe('sog-e-seo');
  });

  it('keeps compound finals', () => {
    expect(romanize('앉')).toBe('anj');
    expect(romanize('닭')).toBe('dalg');
  });

  it('passes non-Hangul through untouched and does not hyphenate across it', () => {
    expect(romanize('a')).toBe('a');
    expect(romanize('안 녕')).toBe('an nyeong');
    expect(romanize('안녕!')).toBe('an-nyeong!');
    expect(romanize('')).toBe('');
  });

  it('leaves jamo outside the syllable block alone', () => {
    // ㄱ (U+3131) is a compatibility jamo, not a composed syllable.
    expect(romanize('ㄱ')).toBe('ㄱ');
  });
});
