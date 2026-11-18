import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFacts, dominantColors } from "./mimic-facts.ts";

/** A 100 x 100 picture: grey background, white panel, and a small orange square. */
function picture() {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let color = [238, 236, 237];
      if (x >= 10 && x < 90 && y >= 10 && y < 90) color = [255, 255, 255];
      if (x >= 20 && x < 24 && y >= 20 && y < 24) color = [232, 97, 58];
      data.set([...color, 255], i);
    }
  }
  return { data, width, height };
}

test("finds the background, the panel and the small accent colour", () => {
  const found = dominantColors(picture()).map((swatch) => swatch.hex);
  assert.ok(found.includes("#ffffff"));
  assert.ok(found.includes("#eeeced"));
  assert.ok(found.some((hex) => hex.startsWith("#e8")), `no accent in ${found}`);
});

test("describes colours in one sentence, and nothing when there are none", () => {
  assert.equal(describeFacts([]), "");
  assert.match(describeFacts([{ hex: "#ffffff", share: 0.7 }]), /#ffffff 70%/);
});
