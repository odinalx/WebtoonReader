import { describe, expect, it } from 'vitest';
import { koreanSelection, MAX_SELECTION } from '../hangul';

describe('koreanSelection', () => {
  it('keeps a Korean sentence, whitespace collapsed', () => {
    expect(koreanSelection('  그녀는\n  어둠 속에서 ')).toBe('그녀는 어둠 속에서');
  });

  it('accepts mixed text as long as some of it is Korean', () => {
    expect(koreanSelection('Chapitre 3 : 비밀')).toBe('Chapitre 3 : 비밀');
  });

  it('refuses a selection without Korean, or none at all', () => {
    expect(koreanSelection('Bonjour')).toBeNull();
    expect(koreanSelection('')).toBeNull();
    expect(koreanSelection(undefined)).toBeNull();
  });

  it('caps a long selection', () => {
    expect(koreanSelection('가'.repeat(MAX_SELECTION + 50))).toHaveLength(MAX_SELECTION);
  });
});
