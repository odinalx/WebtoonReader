import { describe, expect, it } from 'vitest';
import { clearBorderInk, otsuThreshold, prepareForOcr, toGray } from '../ocrPrep';

// Build an RGBA image from rows of characters: '#' dark, '.' light.
function image(rows: string[], dark = 20, light = 235): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const v = c === '#' ? dark : light;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }),
  );
  return { data, w, h };
}

// Read back an RGBA result as rows of '#' (black) and '.' (white).
function rows(out: { data: Uint8ClampedArray; width: number; height: number }, margin: number): string[] {
  const res: string[] = [];
  for (let y = margin; y < out.height - margin; y++) {
    let r = '';
    for (let x = margin; x < out.width - margin; x++) r += out.data[(y * out.width + x) * 4] === 0 ? '#' : '.';
    res.push(r);
  }
  return res;
}

// A bubble outline touching the frame, with a glyph inside that does not.
const BUBBLE = [
  '##########',
  '#........#',
  '#..##....#',
  '#..##..#.#',
  '#......#.#',
  '#........#',
  '##########',
];

describe('toGray', () => {
  it('treats transparent pixels as white paper', () => {
    const g = toGray(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), 2, 1);
    expect([...g]).toEqual([255, 0]);
  });
});

describe('otsuThreshold', () => {
  it('splits a two-level histogram between the levels', () => {
    const g = new Uint8Array([10, 10, 10, 200, 200, 200, 200]);
    const t = otsuThreshold(g);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(200);
  });
});

describe('clearBorderInk', () => {
  it('clears only the ink connected to the border', () => {
    const ink = new Uint8Array([
      1, 1, 1, 1, 1,
      1, 0, 0, 0, 1,
      1, 0, 1, 0, 1,
      1, 0, 0, 0, 1,
      1, 1, 1, 1, 1,
    ]);
    const cleared = clearBorderInk(ink, 5, 5);
    expect(cleared).toBe(16);
    expect([...ink].reduce((s, v) => s + v, 0)).toBe(1);
    expect(ink[12]).toBe(1);
  });
});

describe('prepareForOcr', () => {
  it('erases the bubble outline, keeps the text, pads with white', () => {
    const { data, w, h } = image(BUBBLE);
    const out = prepareForOcr(data, w, h, 3);
    expect(out.width).toBe(w + 6);
    expect(out.height).toBe(h + 6);
    expect(rows(out, 3)).toEqual([
      '..........',
      '..........',
      '...##.....',
      '...##..#..',
      '.......#..',
      '..........',
      '..........',
    ]);
    // Margin is white.
    expect(out.data[0]).toBe(255);
    expect(out.data[3]).toBe(255);
  });

  it('inverts light text on a dark bubble', () => {
    const { data, w, h } = image(BUBBLE, 235, 20); // '#' now light, '.' dark
    const out = prepareForOcr(data, w, h, 0);
    expect(rows(out, 0)).toEqual([
      '..........',
      '..........',
      '...##.....',
      '...##..#..',
      '.......#..',
      '..........',
      '..........',
    ]);
  });

  it('keeps the text when a tight frame makes every stroke touch the edge', () => {
    const tight = ['#..#', '#..#', '#..#', '....', '....', '....'];
    const { data, w, h } = image(tight);
    expect(rows(prepareForOcr(data, w, h, 1), 1)).toEqual(tight);
  });
});
