/**
 * Lifecycle data every block can carry, kept apart from the data file so it is plain TypeScript
 * with no aliases and can be tested on its own.
 */
export type BlockStatus = "draft" | "live";

export type BlockMeta = {
  /** Day the block was added, `YYYY-MM-DD`. It wears a "New" label for `NEW_DAYS` days. */
  added?: string;
  /** Day it was last changed in a way worth showing, `YYYY-MM-DD`. Wears "Updated" for `NEW_DAYS` days. */
  updated?: string;
  /** Earlier ids of this block. `/b/<alias>` redirects to the block, so shared links keep working. */
  aliases?: string[];
  /** `draft` hides the block everywhere in production. It still shows in `npm run dev` for review. */
  status?: BlockStatus;
  /** A paid block, shown in Signature. `price` is in US dollars; `by` credits a guest author. */
  premium?: { price: number; by?: string };
};

export const NEW_DAYS = 30;
const DAY = 86_400_000;

function ageInDays(date: string | undefined, now: number): number | null {
  if (!date) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return null;
  return (now - time) / DAY;
}

/** A date up to a day ahead still counts, so a time zone ahead of UTC does not hide a block. "New" for a month after `added`, else "Updated" for a month after `updated`, else nothing. */
export function blockLabel(meta: BlockMeta, now: number = Date.now()): "New" | "Updated" | null {
  const added = ageInDays(meta.added, now);
  if (added !== null && added > -1 && added < NEW_DAYS) return "New";
  const updated = ageInDays(meta.updated, now);
  if (updated !== null && updated > -1 && updated < NEW_DAYS) return "Updated";
  return null;
}

export const isDraft = (meta: BlockMeta) => meta.status === "draft";

/** The block's current id for `id`, which may be an old alias. `null` when nothing matches. */
export function canonicalId(blocks: ({ id: string } & BlockMeta)[], id: string): string | null {
  const direct = blocks.find((block) => block.id === id);
  if (direct) return direct.id;
  return blocks.find((block) => block.aliases?.includes(id))?.id ?? null;
}
