import assert from "node:assert/strict";
import { test } from "node:test";
import { creditsFor, shortCredits } from "./mimic-credits.ts";

test("a bigger run costs more, and Opus costs more than Sonnet", () => {
  const small = { input: 2000, output: 2000 };
  const big = { input: 3000, output: 7000 };
  assert.ok(creditsFor("claude-sonnet-5-5", big) > creditsFor("claude-sonnet-5-5", small));
  assert.ok(creditsFor("claude-opus-5-5", big) > creditsFor("claude-sonnet-5-5", big));
});

test("a typical Opus build is a few hundred credits", () => {
  // 3,000 in + 6,500 out at $4 / $20 per million = $0.142 = 284 credits at $0.0005 each.
  assert.equal(creditsFor("claude-opus-5-5", { input: 3000, output: 6500 }), 284);
});

test("cached input is cheaper than fresh input", () => {
  const fresh = creditsFor("claude-opus-5-5", { input: 10000, output: 0 });
  const cached = creditsFor("claude-opus-5-5", { input: 0, output: 0, cacheRead: 10000 });
  assert.ok(cached < fresh);
});

test("an unlisted model is charged at the dearest rate, and a run costs at least 1", () => {
  const tokens = { input: 1000, output: 1000 };
  assert.equal(creditsFor("something-else", tokens), creditsFor("claude-fable-5-2", tokens));
  assert.equal(creditsFor("claude-haiku-5-5", { input: 1, output: 1 }), 1);
});

test("short balances for the ring", () => {
  assert.equal(shortCredits(974), "974");
  assert.equal(shortCredits(1000), "1k");
  assert.equal(shortCredits(1250), "1.3k");
  assert.equal(shortCredits(0), "0");
});
