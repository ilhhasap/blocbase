import assert from "node:assert/strict";
import { test } from "node:test";
import { linePercent, maxLinePercent } from "./mimic-type.ts";

test("keeps the model's ratio when it is inside the band", () => {
  assert.equal(linePercent(14, "20px"), 143);
  assert.equal(linePercent(16, "1.5"), 150);
  assert.equal(linePercent(16, "140%"), 140);
});

test("bigger text gets a tighter ceiling", () => {
  assert.ok(maxLinePercent(40) < maxLinePercent(16));
  assert.equal(linePercent(40, "60px"), 110);
  assert.equal(linePercent(72, "100px"), 100);
});

test("never goes below 80%", () => {
  assert.equal(linePercent(40, "20px"), 80);
  assert.equal(linePercent(12, "50%"), 80);
});

test("falls back to the middle of the band without a value", () => {
  assert.equal(linePercent(16, null), 118);
  assert.equal(linePercent(16, "normal"), 118);
});
