/**
 * Runs Remake's prompt over a fixed set of screenshots, so a change can be compared before and after.
 *
 *   Put screenshots in .qc/remake/shots/ (git-ignored), then:
 *   npm run remake:eval -- <label>            one real model call per screenshot (costs money)
 *   npm run remake:eval -- <label> --dry      no model calls, to check the report
 *
 * Open .qc/remake/runs/<label>/index.html. `--model <id>` picks another model.
 * This is the first pass only: the app also sends measured colours and can run the automatic check.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, parse } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { creditsFor } from "../src/lib/mimic-credits.ts";
import { expandIcons } from "../src/lib/mimic-icons.ts";
import { loadLogo, loadLucide } from "../src/lib/mimic-lucide.ts";
import { hasPlaceholders, MIMIC_SCHEMA, MIMIC_SYSTEM } from "../src/lib/mimic-prompt.ts";

const MIMES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const at = args.indexOf("--model");
const model = at >= 0 ? args[at + 1]! : "claude-sonnet-5-5";
const label = args.find((arg, i) => !arg.startsWith("--") && (at < 0 || i !== at + 1));
if (!label || !/^[\w.-]+$/.test(label)) throw new Error("Give the run a label: npm run remake:eval -- before");

const shots = ".qc/remake/shots";
const out = join(".qc/remake/runs", label);
mkdirSync(shots, { recursive: true });
const files = readdirSync(shots).filter((file) => MIMES[extname(file).toLowerCase()]).sort();
if (!files.length) throw new Error(`Put screenshots in ${shots}/ first.`);
mkdirSync(out, { recursive: true });

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const client = dry ? null : new Anthropic();
const rows: string[] = [];
let total = 0;

for (const file of files) {
  const data = readFileSync(join(shots, file)).toString("base64");
  const mime = MIMES[extname(file).toLowerCase()]!;
  let html = '<div style="padding:16px"><svg data-icon="search" width="20" height="20"></svg> dry run</div>';
  let note = "dry run";
  let credits = 0;
  const started = Date.now();
  try {
    if (client) {
      const response = await client.messages.create({
        model,
        max_tokens: 16000,
        system: MIMIC_SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: MIMIC_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime, data } },
              { type: "text", text: "Rebuild this component." },
            ],
          },
        ],
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
      credits = creditsFor(response.model, {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      });
      const text = response.content.find((block) => block.type === "text");
      const parsed = JSON.parse(text && text.type === "text" ? text.text : "{}") as { html?: string; note?: string };
      html = parsed.html ?? "";
      note = parsed.note ?? "";
      if (hasPlaceholders(html)) note = `PLACEHOLDERS LEFT IN. ${note}`;
    }
    html = await expandIcons(html, loadLucide, loadLogo);
  } catch (error) {
    html = "";
    note = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }
  total += credits;
  const seconds = Math.round((Date.now() - started) / 1000);
  writeFileSync(join(out, `${parse(file).name}.html`), html);
  const page = `<!doctype html><meta charset="utf-8"><body style="margin:16px;font-family:Geist,sans-serif;background:#f4f4f3">${html}`;
  rows.push(
    `<section><h2>${escape(file)}</h2><p>${seconds}s · ${credits} credits · ${escape(note)}</p><div class="pair">` +
      `<img src="data:${mime};base64,${data}" alt=""><iframe sandbox="" srcdoc="${escape(page)}"></iframe></div></section>`,
  );
  console.log(`${file}: ${seconds}s, ${credits} credits${note.startsWith("FAILED") ? `, ${note}` : ""}`);
}

writeFileSync(
  join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Remake ${label}</title><style>body{font:14px system-ui;margin:24px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}img{max-width:100%}iframe{width:100%;height:520px;border:1px solid #ddd}</style><h1>${label} · ${model} · ${total} credits</h1>${rows.join("")}`,
);
console.log(`Report: ${join(out, "index.html")}`);
