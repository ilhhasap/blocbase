/** Pure part of the line height conversion, apart from the payload handling in figma-line-height.ts. */

/** Text layers (as decoded from the payload) get their pixel line height as a percentage. Returns how many changed. */
export function lowerLineHeights(message: {
  nodeChanges?: Array<{
    type?: string;
    fontSize?: number;
    lineHeight?: { value?: number; units?: string };
  }>;
}): number {
  let changed = 0;
  for (const node of message.nodeChanges ?? []) {
    const line = node.lineHeight;
    if (node.type !== "TEXT" || !line || line.units !== "PIXELS") continue;
    if (!node.fontSize || node.fontSize <= 0 || typeof line.value !== "number") continue;
    node.lineHeight = {
      value: Math.round((line.value / node.fontSize) * 10_000) / 100,
      units: "PERCENT",
    };
    changed += 1;
  }
  return changed;
}
