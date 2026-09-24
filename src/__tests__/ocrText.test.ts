import { describe, expect, it } from 'vitest';
import { confidentText, type OcrWord } from '../ocrText';

const word = (text: string, confidence: number, x0: number, x1: number): OcrWord => ({
  text,
  confidence,
  bbox: { x0, x1, y0: 0, y1: 30 },
});
const page = (...lines: OcrWord[][]) => ({
  blocks: [{ paragraphs: [{ lines: lines.map((words) => ({ words })) }] }],
});

describe('confidentText', () => {
  it('joins words with a space only across a real gap', () => {
    const out = confidentText(page([word('어둠', 90, 0, 60), word('속에서', 90, 61, 150), word('뭔가', 90, 200, 260)]));
    expect(out.text).toBe('어둠속에서 뭔가');
    expect(out.uncertain).toEqual([]);
  });

  it('flags the Hangul of low-confidence words by offset', () => {
    const out = confidentText(page([word('어돔', 0, 0, 60), word('속에서', 90, 100, 190)]));
    expect(out.text).toBe('어돔 속에서');
    expect(out.uncertain).toEqual([0, 1]);
    expect(out.uncertain.map((i) => out.text[i])).toEqual(['어', '돔']);
  });

  it('keeps offsets right across lines and punctuation', () => {
    const out = confidentText(
      page(
        [word('이', 90, 0, 30), word('옷,', 90, 60, 100)],
        [word('네가', 90, 0, 60), word('상어?', 20, 100, 190)],
      ),
    );
    expect(out.text).toBe('이 옷,\n네가 상어?');
    expect(out.uncertain.map((i) => out.text[i])).toEqual(['상', '어']);
  });

  it('drops low-confidence noise without Hangul, and never flags it', () => {
    const out = confidentText(page([word('"', 10, 0, 5), word('쾅!!', 30, 40, 100)]));
    expect(out.text).toBe('쾅!!');
    expect(out.uncertain).toEqual([0]);
  });

  it('falls back to the plain text when there are no blocks', () => {
    expect(confidentText({ text: ' 안녕 \n' })).toEqual({ text: '안녕', uncertain: [] });
  });
});
