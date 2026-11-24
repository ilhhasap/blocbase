/**
 * Mimic's limit is a balance of credits per 5-hour session. A run costs what the model charged for it:
 * tokens times the model's price, turned into credits. A simple screenshot costs little, a complex one more,
 * and Opus more than Sonnet.
 */

/** One credit is this many US dollars of model cost (so 1,000 credits are $0.50). */
export const CREDIT_USD = 0.0005;

/** Credits in a session when MIMIC_CREDITS is not set. */
export const DEFAULT_CREDITS = 1000;

/** What a run with no recorded cost counts as: runs from before credits existed, and the run in flight. */
export const DEFAULT_RUN_CREDITS = 250;

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Anthropic list prices in US dollars per million tokens (cache writes at the 5-minute rate, 1.25x input). */
const PRICES: Record<string, Price> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};

/** A model that is not listed (a fallback that answered instead) is charged at the dearest listed rate. */
const FALLBACK_PRICE = PRICES["claude-fable-5-2"]!;

export type Tokens = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

/** Credits a run cost, at least 1. */
export function creditsFor(model: string | null | undefined, tokens: Tokens): number {
  const price = (model && PRICES[model]) || FALLBACK_PRICE;
  const dollars =
    (tokens.input * price.input +
      tokens.output * price.output +
      (tokens.cacheRead ?? 0) * price.cacheRead +
      (tokens.cacheWrite ?? 0) * price.cacheWrite) /
    1_000_000;
  return Math.max(1, Math.ceil(dollars / CREDIT_USD));
}
