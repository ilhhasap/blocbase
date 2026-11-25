import assert from "node:assert/strict";
import { test } from "node:test";
import { blockLabel, canonicalId, isDraft } from "./block-meta.ts";

const now = Date.parse("2026-11-26T12:00:00Z");

test("a block is New for 30 days after it is added", () => {
  assert.equal(blockLabel({ added: "2026-11-26" }, now), "New");
  assert.equal(blockLabel({ added: "2026-10-28" }, now), "New");
  assert.equal(blockLabel({ added: "2026-10-27" }, now), null);
});

test("Updated shows after the New window, and never before the date", () => {
  assert.equal(blockLabel({ added: "2026-01-01", updated: "2026-11-20" }, now), "Updated");
  assert.equal(blockLabel({ added: "2026-11-20", updated: "2026-11-25" }, now), "New");
  assert.equal(blockLabel({ added: "2026-12-30" }, now), null);
  assert.equal(blockLabel({ updated: "2025-01-01" }, now), null);
});

test("bad or missing dates give no label", () => {
  assert.equal(blockLabel({}, now), null);
  assert.equal(blockLabel({ added: "soon" }, now), null);
});

test("canonicalId follows aliases and ignores unknown ids", () => {
  const blocks = [{ id: "button-set" }, { id: "primary", aliases: ["old-primary", "btn"] }];
  assert.equal(canonicalId(blocks, "button-set"), "button-set");
  assert.equal(canonicalId(blocks, "old-primary"), "primary");
  assert.equal(canonicalId(blocks, "nope"), null);
});

test("only status draft is a draft", () => {
  assert.equal(isDraft({ status: "draft" }), true);
  assert.equal(isDraft({ status: "live" }), false);
  assert.equal(isDraft({}), false);
});

test("a date one day ahead (time zones) still counts", () => {
  assert.equal(blockLabel({ added: "2026-11-27" }, now), "New");
});
