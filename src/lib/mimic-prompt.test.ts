import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPlaceholders } from "./mimic-prompt.ts";

test("flags shorthand the model left where rows belong", () => {
  assert.equal(hasPlaceholders('<div data-layer="Tree">ROWS</div>'), true);
  assert.equal(hasPlaceholders("<span>ROW_D_Perpetuals_85</span>"), true);
  assert.equal(hasPlaceholders("<span>{{item}}</span>"), true);
});

test("lets real content through, including layer names", () => {
  assert.equal(
    hasPlaceholders(
      '<div data-layer="Row Perpetuals"><span>Perpetuals</span><span>85</span></div>',
    ),
    false,
  );
});
