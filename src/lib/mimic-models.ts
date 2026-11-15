/** Models Mimic can use. The server only accepts ids from this list. */
export const MIMIC_MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Fast, lowest cost", provider: "anthropic" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Most accurate, higher cost", provider: "anthropic" },
  // Free models on OpenRouter: no cost and no daily limit here, but rate limited and less exact.
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", hint: "Free, rate limited", provider: "openrouter" },
  { id: "nvidia/nemotron-3.5-super-vl:free", label: "Nemotron 3.5 VL", hint: "Free, rate limited", provider: "openrouter" },
] as const;

export type MimicProvider = (typeof MIMIC_MODELS)[number]["provider"];

export const DEFAULT_MIMIC_MODEL: string = MIMIC_MODELS[0].id;

export const isMimicModel = (value: unknown): value is string =>
  typeof value === "string" && MIMIC_MODELS.some((model) => model.id === value);

export const providerOf = (id: string): MimicProvider =>
  MIMIC_MODELS.find((model) => model.id === id)?.provider ?? "anthropic";
