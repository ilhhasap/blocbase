import Anthropic from "@anthropic-ai/sdk";
import { getSql } from "@/lib/db";
import {
  MIMIC_EDIT,
  MIMIC_REFINE,
  MIMIC_SCHEMA,
  MIMIC_SYSTEM,
  hasPlaceholders,
} from "@/lib/mimic-prompt";
import { creditsFor, DEFAULT_CREDITS, DEFAULT_RUN_CREDITS } from "@/lib/mimic-credits";
import {
  DEFAULT_MIMIC_MODEL,
  isMimicModel,
  providerOf,
} from "@/lib/mimic-models";

/** Mimic is built behind a flag: it only exists where VITE_MIMIC_ENABLED=true (local, for now). */
export const mimicEnabled = () => process.env.VITE_MIMIC_ENABLED === "true";

const DEFAULT_MODEL = process.env.MIMIC_MODEL || DEFAULT_MIMIC_MODEL;
/** Credits per session. A session starts with a run and lasts 5 hours, like Claude's own limit; a run costs what its tokens cost. */
const CREDITS = Math.max(1, Number(process.env.MIMIC_CREDITS) || DEFAULT_CREDITS);
const SESSION_MS = 5 * 3600 * 1000;
const MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Vercel refuses a request body over 4.5 MB, and a refine sends the screenshot and a render together.
const MAX_BASE64 = 2_600_000; // about 1.9 MB of image
const MAX_RENDER = 1_600_000;
const MAX_HTML = 60_000;

export type MimicStatus = {
  enabled: boolean;
  configured: boolean;
  /** Which model providers have a key on this server. */
  providers: { anthropic: boolean; openrouter: boolean };
  mock: boolean;
  used: number;
  limit: number;
  resetsAt: string | null;
  /** The account is on MIMIC_PASS_EMAILS: no daily limit. */
  pass: boolean;
};
export type MimicResult = {
  name: string;
  html: string;
  note: string;
  used: number;
  limit: number;
};

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic());

const mockOn = () =>
  process.env.NODE_ENV !== "production" && process.env.MIMIC_MOCK === "true";

/** Emails in MIMIC_PASS_EMAILS are exempt from the daily limit (in production the email must be verified). */
async function hasPass(userId: string): Promise<boolean> {
  const allowed = (process.env.MIMIC_PASS_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return false;
  const sql = await getSql();
  const rows = await sql.query<{ email: string; emailVerified: boolean }>(
    'select email, "emailVerified" from "user" where id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) return false;
  const verified = row.emailVerified || process.env.NODE_ENV !== "production";
  return verified && allowed.includes(row.email.toLowerCase());
}

/**
 * The person's current session: it opens with the first run after the last one ended and lasts 5 hours,
 * and everything resets when it ends. `start` is null when no session is open.
 */
async function currentSession(userId: string) {
  const sql = await getSql();
  const rows = await sql.query<{ at: string; credits: number | null }>(
    `select created_at as at, credits from mimic_runs
     where user_id = $1 and status <> 'failed' and created_at > now() - interval '3 days'
     order by created_at asc`,
    [userId],
  );
  let start: Date | null = null;
  let used = 0;
  for (const row of rows) {
    const at = new Date(row.at);
    const cost = row.credits ?? DEFAULT_RUN_CREDITS;
    if (!start || at.getTime() >= start.getTime() + SESSION_MS) {
      start = at;
      used = cost;
    } else used += cost;
  }
  if (start && start.getTime() + SESSION_MS <= Date.now()) return { start: null, used: 0 };
  return { start, used };
}

export async function getMimicStatus(userId: string): Promise<MimicStatus> {
  if (!mimicEnabled()) throw new Error("Not found");
  const sql = await getSql();
  const { start, used } = await currentSession(userId);
  const pass = await hasPass(userId);
  return {
    enabled: true,
    configured:
      Boolean(process.env.ANTHROPIC_API_KEY) ||
      Boolean(process.env.OPENROUTER_API_KEY) ||
      mockOn(),
    providers: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    },
    mock: mockOn(),
    used,
    limit: CREDITS,
    pass,
    resetsAt:
      !pass && start ? new Date(start.getTime() + SESSION_MS).toISOString() : null,
  };
}

const SAMPLE = `<div class="kit" data-layer="Sample card" style="display:flex;flex-direction:column;gap:12px;padding:24px;width:320px;background:#ffffff;border-radius:20px;border:1px solid #e6e5e2;box-shadow:0 12px 32px rgba(23,24,26,0.08);">
<svg data-icon="sparkles" width="20" height="20" color="#17181a"></svg>
<div data-layer="Title" style="font-family:Geist, sans-serif;font-size:18px;font-weight:600;line-height:24px;color:#17181a;">Mock result</div>
<div data-layer="Body" style="font-family:Geist, sans-serif;font-size:14px;font-weight:400;line-height:20px;color:#6f6e68;">MIMIC_MOCK is on, so this card is a stand-in and no model was called.</div>
<div data-layer="Primary button" style="display:flex;align-items:center;justify-content:center;height:40px;padding:0px 18px;border-radius:999px;background:#17181a;align-self:flex-start;"><span style="font-family:Geist, sans-serif;font-size:14px;font-weight:500;line-height:20px;color:#ffffff;">Continue</span></div>
</div>`;

/** Run one generation for a signed-in user. The daily limit is checked and taken before anything is sent. */
export async function generateMimic(
  userId: string,
  input: {
    image?: unknown;
    mime?: unknown;
    hint: unknown;
    width?: unknown;
    height?: unknown;
    model?: unknown;
    html?: unknown;
    render?: unknown;
    instruction?: unknown;
    facts?: unknown;
  },
): Promise<MimicResult> {
  if (!mimicEnabled()) throw new Error("Not found");
  const instruction =
    typeof input.instruction === "string"
      ? input.instruction.replace(/\s+/g, " ").trim().slice(0, 300)
      : "";
  // With `html` this is a correction pass over an earlier result; `render` is how that HTML looks (PNG).
  // With an instruction too it is an edit, which can run without the screenshot.
  const current =
    typeof input.html === "string" ? input.html.slice(0, MAX_HTML) : "";
  const edit = Boolean(instruction && current);
  const image = typeof input.image === "string" ? input.image : "";
  const mime = typeof input.mime === "string" ? input.mime : "";
  if (image) {
    if (!MIMES.has(mime) || !/^[A-Za-z0-9+/=]+$/.test(image)) {
      throw new Error("Send a PNG, JPEG, WebP or GIF image.");
    }
    if (image.length > MAX_BASE64)
      throw new Error(
        "That image is too large. Crop it to just the component.",
      );
  } else if (!edit) {
    throw new Error("Send a PNG, JPEG, WebP or GIF image.");
  }
  const hint =
    typeof input.hint === "string"
      ? input.hint.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";
  const dim = (value: unknown) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 4096
      ? Math.round(value)
      : 0;
  const width = dim(input.width);
  const height = dim(input.height);
  const size =
    width && height
      ? ` The image is ${width} by ${height} pixels; it may be a 2x or 3x capture, so scale every measure down by one factor as the rules say.`
      : "";
  const MODEL = isMimicModel(input.model) ? input.model : DEFAULT_MODEL;
  const provider = providerOf(MODEL);
  if (!mockOn()) {
    if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY)
      throw new Error("Add OPENROUTER_API_KEY to use this model.");
    if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY)
      throw new Error("Remake is not set up on this server yet.");
  }
  const render =
    typeof input.render === "string" &&
    /^[A-Za-z0-9+/=]+$/.test(input.render) &&
    input.render.length <= MAX_RENDER
      ? input.render
      : "";

  // Colours the page measured from the picture; only a first build uses them.
  const facts =
    !current && typeof input.facts === "string"
      ? input.facts.slice(0, 1000)
      : "";
  const prompt = edit
    ? `${hint ? `What it is: ${hint}. ` : ""}Apply this change and keep everything else exactly as it is: ${instruction}.${size}\n\nCurrent HTML:\n${current}`
    : current
      ? `${hint ? `What it is: ${hint}. ` : ""}Correct this rebuild so it matches the screenshot.${size}${render ? " The second image is how the current HTML renders." : ""}\n\nCurrent HTML:\n${current}`
      : `${hint ? `Rebuild this component. The user's notes (what it is, and anything to change from the screenshot, such as colours or what to leave out): ${hint}` : "Rebuild this component."}${size}${facts ? `\n\n${facts}` : ""}`;

  // Free models cost nothing, so they skip the daily limit and are not logged as runs.
  if (provider === "openrouter") {
    return generateViaOpenRouter(userId, {
      model: MODEL,
      mime,
      image,
      render: current && !edit ? render : "",
      mode: edit ? "edit" : current ? "refine" : "build",
      prompt,
    });
  }

  const pass = await hasPass(userId);
  const sql = await getSql();
  const session = await currentSession(userId);
  const taken = await sql.query<{ id: string }>(
    `insert into mimic_runs (user_id, model)
     select $1, $2
     where ($4::boolean or $5::timestamptz is null or (select coalesce(sum(coalesce(credits, $6)), 0) from mimic_runs where user_id = $1 and status <> 'failed' and created_at >= $5::timestamptz) < $3)
       and not exists (select 1 from mimic_runs where user_id = $1 and status = 'pending' and created_at > now() - interval '3 minutes')
     returning id`,
    [userId, MODEL, CREDITS, pass, session.start?.toISOString() ?? null, DEFAULT_RUN_CREDITS],
  );
  const runId = taken[0]?.id;
  if (!runId) {
    const status = await getMimicStatus(userId);
    throw new Error(
      status.used >= CREDITS
        ? "You have used all your Remake credits for this 5-hour window."
        : "A generation is already running.",
    );
  }

  const finish = async (
    status: string,
    usage?: { input: number; output: number; cached: number },
    credits?: number,
  ) =>
    sql.query(
      "update mimic_runs set status = $2, input_tokens = $3, output_tokens = $4, cache_read_tokens = $5, credits = $6 where id = $1",
      [
        runId,
        status,
        usage?.input ?? null,
        usage?.output ?? null,
        usage?.cached ?? null,
        credits ?? null,
      ],
    );

  try {
    if (mockOn()) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await finish("failed"); // a mock run costs nothing, so it does not use up the limit
      return {
        name: "Mock result",
        html: SAMPLE,
        note: "Mock mode.",
        used: 0,
        limit: CREDITS,
      };
    }

    const response = await anthropic().beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        // A safety decline is retried on another model inside the same call.
        fallbacks: "default",
        system: [
          {
            type: "text",
            text: MIMIC_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
          ...(edit
            ? [{ type: "text", text: MIMIC_EDIT }]
            : current
              ? [{ type: "text", text: MIMIC_REFINE }]
              : []),
        ],
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: MIMIC_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [
              ...(image
                ? [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: mime as "image/png",
                        data: image,
                      },
                    },
                  ]
                : []),
              ...(current && !edit && render
                ? [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: render,
                      },
                    },
                  ]
                : []),
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      } as Parameters<
        ReturnType<typeof anthropic>["beta"]["messages"]["create"]
      >[0],
      { timeout: 230_000, maxRetries: 0 },
    );

    if (!("content" in response)) throw new Error("No answer came back.");
    const usage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cached: response.usage.cache_read_input_tokens ?? 0,
    };
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[mimic] ${MODEL} in ${usage.input} (cached ${usage.cached}) out ${usage.output} tokens, stop ${response.stop_reason}`,
      );
    }
    if (response.stop_reason === "refusal") {
      await finish("failed", usage);
      throw new Error("That image could not be rebuilt. Try a different one.");
    }
    const text = response.content.find((block) => block.type === "text");
    const parsed =
      text && text.type === "text"
        ? (JSON.parse(text.text) as {
            name?: unknown;
            html?: unknown;
            note?: unknown;
          })
        : null;
    const html = typeof parsed?.html === "string" ? parsed.html.trim() : "";
    const note =
      typeof parsed?.note === "string" ? parsed.note.slice(0, 240) : "";
    if (!html) {
      await finish("failed", usage);
      throw new Error(note || "No component could be rebuilt from that image.");
    }
    if (hasPlaceholders(html)) {
      await finish("failed", usage);
      throw new Error(
        "The model left part of the block out. This run was not counted; try again.",
      );
    }
    if (html.length > MAX_HTML) {
      await finish("failed", usage);
      throw new Error(
        "That component is too detailed to rebuild. Try a simpler crop.",
      );
    }
    // The cost of this run: its tokens at the price of the model that answered (a fallback model may have).
    const cost = creditsFor(response.model ?? MODEL, {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cached,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    });
    await finish("done", usage, cost);
    const status = await getMimicStatus(userId);
    return {
      name:
        typeof parsed?.name === "string" && parsed.name.trim()
          ? parsed.name.trim().slice(0, 40)
          : "Remake block",
      html,
      note,
      used: status.used,
      limit: status.limit,
    };
  } catch (error) {
    // Anything that did not hand back a block gives the run back.
    await finish("failed").catch(() => {});
    if (error instanceof Anthropic.APIError) {
      console.error("[mimic]", error.status, error.message);
      throw new Error(
        error.status === 429
          ? "Remake is busy. Try again in a minute."
          : "The model could not be reached. Try again.",
      );
    }
    throw error;
  }
}

const JSON_ONLY =
  '\n\nReply with exactly one JSON object and nothing else: {"name": string, "html": string, "note": string}. No markdown and no code fences.';

/** Pull the JSON object out of a model reply that may wrap it in text or fences. */
function readJson(
  text: string,
): { name?: unknown; html?: unknown; note?: unknown } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** One generation through OpenRouter's chat endpoint, for the free models. */
async function generateViaOpenRouter(
  userId: string,
  input: {
    model: string;
    mime: string;
    image: string;
    render: string;
    mode: "build" | "refine" | "edit";
    prompt: string;
  },
): Promise<MimicResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key && !mockOn())
    throw new Error("Add OPENROUTER_API_KEY to use this model.");
  if (mockOn()) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const status = await getMimicStatus(userId);
    return {
      name: "Mock result",
      html: SAMPLE,
      note: "Mock mode.",
      used: status.used,
      limit: status.limit,
    };
  }

  const picture = (data: string, mime: string) => ({
    type: "image_url",
    image_url: { url: `data:${mime};base64,${data}` },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 12000,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              MIMIC_SYSTEM +
              (input.mode === "edit"
                ? `\n\n${MIMIC_EDIT}`
                : input.mode === "refine"
                  ? `\n\n${MIMIC_REFINE}`
                  : "") +
              JSON_ONLY,
          },
          {
            role: "user",
            content: [
              ...(input.image ? [picture(input.image, input.mime)] : []),
              ...(input.render ? [picture(input.render, "image/png")] : []),
              { type: "text", text: input.prompt },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new Error("The model could not be reached. Try again.");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    console.error("[mimic] openrouter", response.status, input.model);
    throw new Error(
      response.status === 401 || response.status === 403
        ? "OpenRouter rejected the key."
        : response.status === 402
          ? "OpenRouter needs credits for this model."
          : response.status === 404
            ? "That model is not available on OpenRouter right now. Pick another."
            : response.status === 429
              ? "The free model is busy or its limit is reached. Try again later or pick another."
              : "The model could not be reached. Try again.",
    );
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (body.error) {
    console.error("[mimic] openrouter", body.error.message);
    throw new Error(
      "The free model could not answer right now. Try again or pick another.",
    );
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[mimic] ${input.model} in ${body.usage?.prompt_tokens ?? "?"} out ${body.usage?.completion_tokens ?? "?"} tokens (openrouter)`,
    );
  }
  const content = body.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : "",
            )
            .join("")
        : "";
  const parsed = readJson(text);
  const html = typeof parsed?.html === "string" ? parsed.html.trim() : "";
  const note =
    typeof parsed?.note === "string" ? parsed.note.slice(0, 240) : "";
  if (!html)
    throw new Error(
      note ||
        "That model did not return a usable block. Try again or pick another.",
    );
  if (hasPlaceholders(html))
    throw new Error(
      "The model left part of the block out. Try again or pick another.",
    );
  if (html.length > MAX_HTML)
    throw new Error(
      "That component is too detailed to rebuild. Try a simpler crop.",
    );
  const status = await getMimicStatus(userId);
  return {
    name:
      typeof parsed?.name === "string" && parsed.name.trim()
        ? parsed.name.trim().slice(0, 40)
        : "Remake block",
    html,
    note,
    used: status.used,
    limit: status.limit,
  };
}
