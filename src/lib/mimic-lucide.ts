/** Loads one Lucide icon's shapes by name; only the icons a result uses are downloaded. */
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import type { IconLoader, IconNode } from "./mimic-icons.ts";

export const loadLucide: IconLoader = async (name) => {
  const load = (dynamicIconImports as Record<string, (() => Promise<unknown>) | undefined>)[name];
  if (!load) return null;
  return ((await load()) as { __iconNode?: IconNode }).__iconNode ?? null;
};
