import type { Block } from "@/data/blocks";
import { blockLabel } from "./block-meta.ts";

export type SortMode = "featured" | "new" | "popular" | "copied" | "name";
export type Popularity = Record<
  string,
  { copies: number; recent: number; saves: number }
>;

export const SORTS: { id: SortMode; label: string; hint: string }[] = [
  { id: "featured", label: "Featured", hint: "Our own order" },
  { id: "new", label: "New first", hint: "Newly added blocks on top" },
  { id: "popular", label: "Popular", hint: "Copied and saved most this month" },
  { id: "copied", label: "Most copied", hint: "Copied most of all time" },
  { id: "name", label: "A to Z", hint: "By name" },
];

export const isSortMode = (value: unknown): value is SortMode =>
  typeof value === "string" && SORTS.some((sort) => sort.id === value);

/** Whether this sort needs the copy and save counts. */
export const needsCounts = (mode: SortMode) =>
  mode === "popular" || mode === "copied";

/**
 * The blocks in the chosen order. Ties, and every block before the counts have arrived, keep the
 * featured order, so the list never jumps around for no reason.
 */
export function sortBlocks(
  blocks: Block[],
  mode: SortMode,
  counts: Popularity | null,
): Block[] {
  const index = new Map(blocks.map((block, i) => [block.id, i]));
  const at = (block: Block) => index.get(block.id) ?? 0;
  const by = (score: (block: Block) => number) =>
    [...blocks].sort((a, b) => score(b) - score(a) || at(a) - at(b));
  switch (mode) {
    case "new":
      return by((block) => (blockLabel(block) === "New" ? 1 : 0));
    case "popular": {
      if (!counts) return blocks;
      return by((block) => {
        const entry = counts[block.id];
        return entry ? entry.recent + entry.saves * 2 : 0;
      });
    }
    case "copied": {
      if (!counts) return blocks;
      return by((block) => counts[block.id]?.copies ?? 0);
    }
    case "name":
      return [...blocks].sort(
        (a, b) => a.name.localeCompare(b.name) || at(a) - at(b),
      );
    default:
      return blocks;
  }
}
