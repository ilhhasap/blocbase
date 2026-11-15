import { getSql } from "@/lib/db";
import type { Popularity } from "@/lib/sort-blocks";

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; data: Popularity } | null = null;

/**
 * How often each block was copied (all time and in the last 30 days) and saved in the last 30 days.
 * Aggregates only, no one's activity; kept for a few minutes so sorting does not hit the database per visit.
 */
export async function getPopularity(): Promise<Popularity> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const sql = await getSql();
  const out: Popularity = {};
  const at = (id: string) => (out[id] ??= { copies: 0, recent: 0, saves: 0 });
  const copies = await sql.query<{
    block_id: string;
    total: string;
    recent: string;
  }>(
    `select block_id, count(*) as total,
            count(*) filter (where created_at > now() - interval '30 days') as recent
     from copy_events group by block_id`,
  );
  for (const row of copies) {
    const entry = at(row.block_id);
    entry.copies = Number(row.total);
    entry.recent = Number(row.recent);
  }
  const saves = await sql.query<{ block_id: string; recent: string }>(
    `select block_id, count(*) filter (where created_at > now() - interval '30 days') as recent
     from saved_blocks group by block_id`,
  );
  for (const row of saves) at(row.block_id).saves = Number(row.recent);
  cache = { at: Date.now(), data: out };
  return out;
}
