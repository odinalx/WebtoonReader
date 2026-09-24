import { describe, expect, it } from 'vitest';
import { createQueue, withCard, withoutIds } from '../queue';
import type { AnkiCardDraft } from '../types';

const card = (id: string) => ({ id, word: id, addedAt: 0 }) as unknown as AnkiCardDraft;
const ids = (q: AnkiCardDraft[]) => q.map((c) => c.id);

describe('withoutIds', () => {
  it('removes only the given ids and keeps order', () => {
    expect(ids(withoutIds([card('a'), card('b'), card('c')], ['b']))).toEqual(['a', 'c']);
  });
  it('ignores ids not in the queue', () => {
    expect(ids(withoutIds([card('a')], ['z']))).toEqual(['a']);
  });
});

describe('withCard', () => {
  it('appends a new card and skips a duplicate id', () => {
    const q = withCard([card('a')], card('b'));
    expect(ids(q)).toEqual(['a', 'b']);
    expect(ids(withCard(q, card('a')))).toEqual(['a', 'b']);
  });
});

describe('createQueue', () => {
  function memoryStore(initial: AnkiCardDraft[] = []) {
    let value = initial;
    return {
      read: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return value;
      },
      write: async (q: AnkiCardDraft[]) => {
        await new Promise((r) => setTimeout(r, 1));
        value = q;
      },
      get: () => value,
    };
  }

  it('keeps a card added while a flush is in flight', async () => {
    const store = memoryStore([card('a'), card('b')]);
    const queue = createQueue(store);

    // Flush: snapshot, "send" slowly, then remove what was sent.
    const snapshot = await queue.read();
    const sending = new Promise((r) => setTimeout(r, 10));
    const added = queue.update((q) => withCard(q, card('c')));
    await sending;
    await added;
    await queue.update((q) => withoutIds(q, ids(snapshot)));

    expect(ids(store.get())).toEqual(['c']);
  });

  it('serializes concurrent appends', async () => {
    const store = memoryStore();
    const queue = createQueue(store);
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => queue.update((q) => withCard(q, card(id)))));
    expect(ids(store.get()).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps going after a failed update', async () => {
    const store = memoryStore();
    const queue = createQueue(store);
    await expect(
      queue.update(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await queue.update((q) => withCard(q, card('a')));
    expect(ids(store.get())).toEqual(['a']);
  });
});
