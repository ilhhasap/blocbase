import assert from "node:assert/strict";
import { test } from "node:test";
import { hugRowRoot, lowerLineHeights } from "./line-height-percent.ts";

test("a pixel line height becomes a percentage of the font size", () => {
  const message = {
    nodeChanges: [
      { type: "TEXT", fontSize: 14, lineHeight: { value: 21, units: "PIXELS" } },
      { type: "TEXT", fontSize: 40, lineHeight: { value: 42, units: "PIXELS" } },
    ],
  };
  assert.equal(lowerLineHeights(message), 2);
  assert.deepEqual(message.nodeChanges[0]!.lineHeight, { value: 150, units: "PERCENT" });
  assert.deepEqual(message.nodeChanges[1]!.lineHeight, { value: 105, units: "PERCENT" });
});

test("leaves frames, percent values and texts without a size alone", () => {
  const message = {
    nodeChanges: [
      { type: "FRAME", fontSize: 14, lineHeight: { value: 21, units: "PIXELS" } },
      { type: "TEXT", fontSize: 14, lineHeight: { value: 120, units: "PERCENT" } },
      { type: "TEXT", lineHeight: { value: 21, units: "PIXELS" } },
    ],
  };
  assert.equal(lowerLineHeights(message), 0);
});

const guid = (localID: number) => ({ sessionID: 1, localID });
const pill = (extra: Record<string, unknown> = {}, textHeight = 28) => ({
  nodeChanges: [
    { type: "CANVAS", guid: guid(1) },
    { type: "FRAME", guid: guid(2), parentIndex: { guid: guid(1) }, stackMode: "HORIZONTAL", stackPrimarySizing: "FIXED", size: { x: 225, y: 68 }, ...extra },
    { type: "TEXT", guid: guid(3), parentIndex: { guid: guid(2) }, fontSize: 24, size: { x: 151, y: textHeight } },
  ],
});

test("a short one-line row hugs its content", () => {
  const message = pill();
  assert.equal(hugRowRoot(message), true);
  assert.equal((message.nodeChanges[1] as { stackPrimarySizing?: string }).stackPrimarySizing, "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE");
});

test("columns, spread rows, wide rows and wrapped text keep their width", () => {
  assert.equal(hugRowRoot(pill({ stackMode: "VERTICAL" })), false);
  assert.equal(hugRowRoot(pill({ stackPrimaryAlignItems: "SPACE_BETWEEN" })), false);
  assert.equal(hugRowRoot(pill({ size: { x: 900, y: 60 } })), false);
  assert.equal(hugRowRoot(pill({}, 58)), false);
});
