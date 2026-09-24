import type { AnkiCardDraft } from './types';

// The flashcard queue lives in chrome.storage.local and is changed from
// several message handlers that interleave at every await. A flush reads the
// queue, spends seconds sending it, then writes the result back: writing its
// stale copy would wipe any card added meanwhile. So every change goes through
// `updateQueue`, which serializes read-modify-write cycles, and a flush only
// removes the ids it actually handled from whatever the queue holds by then.

/** The queue without the cards whose ids are in `ids`; order is kept. */
export function withoutIds(queue: AnkiCardDraft[], ids: Iterable<string>): AnkiCardDraft[] {
  const drop = new Set(ids);
  return drop.size === 0 ? queue : queue.filter((c) => !drop.has(c.id));
}

/** The queue with `card` at the end, unless a card with that id is already there. */
export function withCard(queue: AnkiCardDraft[], card: AnkiCardDraft): AnkiCardDraft[] {
  return queue.some((c) => c.id === card.id) ? queue : [...queue, card];
}

export interface QueueStore {
  read(): Promise<AnkiCardDraft[]>;
  write(queue: AnkiCardDraft[]): Promise<void>;
}

/**
 * Serialize updates to one queue: each `update` runs after the previous one
 * finished, on a fresh read. Returns the queue as written.
 */
export function createQueue(store: QueueStore) {
  let last: Promise<unknown> = Promise.resolve();
  function update(
    change: (queue: AnkiCardDraft[]) => AnkiCardDraft[],
  ): Promise<AnkiCardDraft[]> {
    const run = last.then(async () => {
      const next = change(await store.read());
      await store.write(next);
      return next;
    });
    last = run.catch(() => {});
    return run;
  }
  return { read: () => store.read(), update };
}
