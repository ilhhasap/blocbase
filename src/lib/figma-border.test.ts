import assert from "node:assert/strict";
import { test } from "node:test";
import { evenBorderColors } from "./figma-border.ts";

const bottomOnly =
  "border-top-width: 0px; border-top-style: solid; border-top-color: rgb(23, 24, 26); border-bottom-width: 1px; border-bottom-style: dashed; border-bottom-color: rgb(229, 229, 229); border-left-color: rgb(23, 24, 26)";

test("sides without a border take the colour of the side that has one", () => {
  const out = evenBorderColors(bottomOnly);
  assert.match(out, /border-top-color: rgb\(229, 229, 229\)/);
  assert.match(out, /border-left-color: rgb\(229, 229, 229\)/);
  assert.match(out, /border-bottom-color: rgb\(229, 229, 229\)/);
});

test("keeps the longhands, never collapses them to shorthands", () => {
  const out = evenBorderColors(bottomOnly);
  assert.match(out, /border-top-width: 0px/);
  assert.match(out, /border-bottom-width: 1px/);
  assert.doesNotMatch(out, /(^|; )border-color:/);
  assert.doesNotMatch(out, /(^|; )border-width:/);
});

test("leaves styles with no real border alone", () => {
  const plain = "border-top-width: 0px; border-top-color: rgb(0, 0, 0); color: red";
  assert.equal(evenBorderColors(plain), plain);
});
