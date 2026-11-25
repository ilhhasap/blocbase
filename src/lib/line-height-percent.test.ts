import assert from "node:assert/strict";
import { test } from "node:test";
import { lowerLineHeights } from "./line-height-percent.ts";

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
