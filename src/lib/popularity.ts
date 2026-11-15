import { createServerFn } from "@tanstack/react-start";
import type { Popularity } from "@/lib/sort-blocks";

/** Public copy and save counts per block, for the homepage sort. */
export const blockPopularity = createServerFn({ method: "GET" }).handler(
  async (): Promise<Popularity> => {
    const popularity = await import("@/lib/popularity.server");
    return popularity.getPopularity();
  },
);
