/** Loaders for the real drawings; they are only downloaded when a result uses one. */
import dynamicIconImports from "lucide-react/dynamicIconImports.mjs";
import type { IconLoader, IconNode, LogoLoader } from "./mimic-icons.ts";

export const loadLucide: IconLoader = async (name) => {
  const load = (dynamicIconImports as Record<string, (() => Promise<unknown>) | undefined>)[name];
  if (!load) return null;
  return ((await load()) as { __iconNode?: IconNode }).__iconNode ?? null;
};

/** One brand logo from the committed file (see scripts/build-logos.mjs). */
export const loadLogo: LogoLoader = async (name) => {
  const logos = (await import("./mimic-logos.ts")).default;
  return Object.hasOwn(logos, name) ? logos[name]! : null;
};
