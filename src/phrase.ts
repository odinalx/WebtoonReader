// Same helper as the website's src/lib/phrase.ts; keep the two in step.
/**
 * Split a sentence into the analysed words and what lies between them.
 *
 * The analysis returns words without punctuation (a word is what you can look
 * up), but the reader should still see "너, 대체 … 거지?" with its comma and
 * question mark. Walking the original text, each word is located in order and
 * the text between words (spaces, punctuation) is kept as plain gaps.
 * A word that can't be found (OCR respacing) is appended as its own part so
 * no word is ever lost.
 */
export type PhrasePart = { kind: "word"; index: number; text: string } | { kind: "gap"; text: string }

export function phraseParts(text: string, words: string[]): PhrasePart[] {
  const parts: PhrasePart[] = []
  let cursor = 0
  words.forEach((surface, index) => {
    const at = surface ? text.indexOf(surface, cursor) : -1
    if (at === -1) {
      if (parts.length) parts.push({ kind: "gap", text: " " })
      parts.push({ kind: "word", index, text: surface })
      return
    }
    if (at > cursor) parts.push({ kind: "gap", text: text.slice(cursor, at) })
    parts.push({ kind: "word", index, text: surface })
    cursor = at + surface.length
  })
  if (cursor < text.length) parts.push({ kind: "gap", text: text.slice(cursor) })
  return parts
}
