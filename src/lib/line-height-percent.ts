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

type Guid = { sessionID: number; localID: number };
type RowNode = {
  type?: string;
  guid?: Guid;
  parentIndex?: { guid?: Guid };
  stackMode?: string;
  stackPrimaryAlignItems?: string;
  stackPrimarySizing?: string;
  size?: { x: number; y: number };
  fontSize?: number;
};

/** A row wider than this is a bar or a panel, whose width is part of the design. */
const HUG_MAX_WIDTH = 480;

/**
 * A button, chip or pill (a short row of one-line text) is let to hug its content in Figma. The converter fixes every
 * frame's width, so a font that is a little wider there than in the browser would push the label out of the pill.
 * Returns whether the outer frame was changed.
 */
export function hugRowRoot(message: { nodeChanges?: RowNode[] }): boolean {
  const nodes = message.nodeChanges ?? [];
  const key = (guid?: Guid) => (guid ? `${guid.sessionID}:${guid.localID}` : "");
  const canvas = nodes.find((node) => node.type === "CANVAS");
  const root = nodes.find((node) => node.type === "FRAME" && key(node.parentIndex?.guid) === key(canvas?.guid));
  if (!root || root.stackMode !== "HORIZONTAL" || root.stackPrimaryAlignItems?.startsWith("SPACE")) return false;
  if (!root.size || root.size.x > HUG_MAX_WIDTH) return false;
  const texts = nodes.filter((node) => node.type === "TEXT");
  // Wrapped text needs the width it was measured at.
  if (!texts.length || texts.some((text) => !text.size || !text.fontSize || text.size.y >= text.fontSize * 1.9))
    return false;
  root.stackPrimarySizing = "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE";
  return true;
}
