import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BlockView } from "@/components/block-view";
import { FigmaMark } from "@/components/figma-mark";
import { Editor } from "@/components/editor";
import { kitIn } from "@/components/shadow-host";
import type { Block } from "@/data/blocks";
import { registerGenerated } from "@/lib/generated";
import { mimicGenerate, mimicStatus } from "@/lib/mimic";
import type { MimicStatus } from "@/lib/mimic.server";
import { CodeMenu } from "@/components/code-menu";
import { sanitizeBlockHtml } from "@/lib/mimic-html";
import {
  DEFAULT_MIMIC_MODEL,
  MIMIC_MODELS,
  isMimicModel,
  providerOf,
} from "@/lib/mimic-models";
import { renderBlockPng } from "@/lib/mimic-render";

/**
 * Mimic turns a screenshot of a component into an editable block. It is built behind a flag: in
 * production the page only says it is coming soon; set `VITE_MIMIC_ENABLED=true` to work on it locally.
 *
 * The tool is a free canvas: pan and zoom it like Figma, drag any node anywhere. An image node feeds
 * one or more Mimic nodes (each with its own hint), and every Mimic node feeds a block node. Nodes live
 * in world coordinates inside one transformed layer, so the lines between them are plain SVG.
 */
export const MIMIC_ENABLED = import.meta.env.VITE_MIMIC_ENABLED === "true";

type Result = {
  id: string;
  name: string;
  html: string;
  note: string;
  /** The model that drew it, so the block says who made it. */
  model?: string;
};
/** One block on the board: a result (or its error) that grows out of an image node. */
type Run = {
  id: string;
  working: boolean;
  /** True while a correction or an edit runs over an existing result. */
  refining?: boolean;
  error: string | null;
  /** What the person typed under the block, to change it. */
  instruction?: string;
  result: Result | null;
};
/**
 * One screenshot and everything that comes from it. The image node carries the input (what it is,
 * which model); each run is a block. `picture` is what the node shows; `thumb` survives a reload.
 */
type Flow = {
  id: string;
  picture: string | null;
  thumb: string | null;
  hint: string;
  model?: string;
  /** Set when the picture looks like a photo; a warning only, never saved. */
  photo?: boolean;
  /** Original size of the picture, e.g. "1080 × 1350"; not saved. */
  dims?: string;
  runs: Run[];
};
type Prepared = {
  image: string;
  mime: string;
  thumb: string;
  width: number;
  height: number;
  photo: boolean;
  sourceWidth: number;
  sourceHeight: number;
};
type Point = { x: number; y: number };
type Size = { w: number; h: number };
type View = { x: number; y: number; z: number };
type Edge = {
  key: string;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const STORE_KEY = "block-supply-mimic-canvas";
const LEGACY_KEY = "block-supply-mimic";
const KEEP = 8;
const MAX_RUNS = 3;
const MAX_EDGE = 1568;
const THUMB_EDGE = 360;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
// Default layout of one board row, in world px.
const IMG_W = 300;
const GAP_X = 110;
const ROW = 460;

type Props = {
  signedIn: boolean;
  /** Whose canvas this is; null when signed out. The canvas is stored per account. */
  userId: string | null;
  /** True while the session is still being looked up. */
  pending: boolean;
  onLogin: () => void;
  onCopy: (block: Block, kit: HTMLElement | null) => void;
  onNotify: (message: string) => void;
  busy: string | null;
  copied: string | null;
};

export function MimicPage(props: Props) {
  return MIMIC_ENABLED ? <MimicTool {...props} /> : <ComingSoon />;
}

function ComingSoon() {
  return (
    <section className="mimic">
      <p className="mimic-soon" aria-hidden="true">
        Soon
      </p>
      <h1 className="mimic-title">Mimic</h1>
      <p className="mimic-sub">
        Upload a screenshot of a component and get it back as an editable block,
        ready to paste into Figma.
      </p>
      <span className="hero-pill mimic-pill">Coming soon</span>
    </section>
  );
}

/**
 * A photo has thousands of colours that blend into each other; a screenshot of a component is a few
 * flat colours. Samples a small copy and checks how much of the picture the six commonest colours cover.
 * A guess, so it only warns.
 */
function looksLikePhoto(source: HTMLCanvasElement): boolean {
  const edge = 96;
  const k = Math.min(1, edge / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k));
  const h = Math.max(1, Math.round(source.height * k));
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(source, 0, 0, w, h);
  const { data } = context.getImageData(0, 0, w, h);
  const buckets = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key =
      ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const top = Array.from(buckets.values())
    .sort((a, b) => b - a)
    .slice(0, 6)
    .reduce((sum, n) => sum + n, 0);
  return buckets.size > 400 && top / (w * h) < 0.45;
}

/** Why a file cannot be used as a screenshot, or null when it can. */
function fileProblem(file: File): string | null {
  if (!file.type.startsWith("image/"))
    return "Choose an image file: PNG, JPEG, WebP or GIF.";
  if (file.size > 15 * 1024 * 1024)
    return "That file is over 15 MB. Crop it to just the component.";
  return null;
}

/** Shrink a screenshot to what the model can use and encode it, so the upload stays small. */
async function prepare(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot read the image.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const small = document.createElement("canvas");
  const shrink = Math.min(
    1,
    THUMB_EDGE / Math.max(canvas.width, canvas.height),
  );
  small.width = Math.max(1, Math.round(canvas.width * shrink));
  small.height = Math.max(1, Math.round(canvas.height * shrink));
  small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
  const thumb = small.toDataURL("image/jpeg", 0.7);

  // Kept small: the whole request, screenshot and any render of the block, must stay under Vercel's 4.5 MB.
  for (const quality of [0.92, 0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    const image = url.slice(url.indexOf(",") + 1);
    if (image.length < 2_500_000) {
      return {
        image,
        mime: "image/jpeg",
        thumb,
        width: canvas.width,
        height: canvas.height,
        photo: looksLikePhoto(canvas),
        sourceWidth,
        sourceHeight,
      };
    }
  }
  throw new Error("That image is too large. Crop it to just the component.");
}

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Rebuild a stored result and register it, or drop it when it no longer passes the sanitizer. */
function revive(item: Partial<Result> | undefined): Result | null {
  if (
    typeof item?.id !== "string" ||
    !item.id.startsWith("mimic-") ||
    typeof item.html !== "string"
  ) {
    return null;
  }
  const html = sanitizeBlockHtml(item.html);
  if (!html) return null;
  registerGenerated(item.id, html);
  return {
    id: item.id,
    name: String(item.name ?? "Mimic block").slice(0, 40),
    html,
    note: String(item.note ?? ""),
    model: isMimicModel(item.model) ? item.model : undefined,
  };
}

const isThumb = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("data:image/jpeg;base64,") &&
  value.length < 400_000;

const nodeIdsOf = (flow: Flow) => [
  `img-${flow.id}`,
  ...flow.runs.map((run) => `out-${run.id}`),
];
const nodeIds = (flows: Flow[]) => flows.flatMap(nodeIdsOf);

const blankRun = (): Run => ({
  id: uid(),
  working: false,
  refining: false,
  error: null,
  instruction: "",
  result: null,
});

/** Default spots for one board row whose image node sits at `origin`; blocks stack to its right. */
function placeFlow(flow: Flow, origin: Point): Record<string, Point> {
  const out: Record<string, Point> = { [`img-${flow.id}`]: origin };
  flow.runs.forEach((run, index) => {
    out[`out-${run.id}`] = {
      x: origin.x + IMG_W + GAP_X,
      y: origin.y + index * ROW,
    };
  });
  return out;
}

type Saved = { flows: Flow[]; pos: Record<string, Point> };

function loadSaved(key: string): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    const flows: Flow[] = [];
    let pos: Record<string, Point> = {};
    if (
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as { flows?: unknown }).flows)
    ) {
      const stored = raw as {
        flows: Array<{
          id?: unknown;
          thumb?: unknown;
          hint?: unknown;
          model?: unknown;
          runs?: unknown;
        }>;
        pos?: Record<string, Partial<Point>>;
      };
      for (const item of stored.flows) {
        if (typeof item?.id !== "string" || !Array.isArray(item.runs)) continue;
        const runs: Run[] = [];
        let hint = typeof item.hint === "string" ? item.hint : "";
        let model = isMimicModel(item.model) ? item.model : undefined;
        for (const entry of item.runs as Array<{
          id?: unknown;
          hint?: unknown;
          model?: unknown;
          result?: Partial<Result>;
        }>) {
          const result = revive(entry?.result);
          if (!result || typeof entry.id !== "string") continue;
          // Boards saved before the image node held the input kept them on each version.
          if (!runs.length) {
            if (!hint && typeof entry.hint === "string") hint = entry.hint;
            if (!model && isMimicModel(entry.model)) model = entry.model;
          }
          runs.push({ ...blankRun(), id: entry.id, result });
        }
        if (runs.length) {
          const thumb = isThumb(item.thumb) ? item.thumb : null;
          flows.push({
            id: item.id,
            picture: thumb,
            thumb,
            hint: hint.slice(0, 200),
            model,
            runs,
          });
        }
      }
      for (const [id, point] of Object.entries(stored.pos ?? {})) {
        if (typeof point?.x === "number" && typeof point.y === "number") {
          pos[id] = { x: point.x, y: point.y };
        }
      }
    } else {
      // The first version kept a flat list of results; show each as its own board row.
      const legacy: unknown = JSON.parse(
        localStorage.getItem(LEGACY_KEY) ?? "[]",
      );
      if (Array.isArray(legacy)) {
        for (const item of legacy as Partial<Result>[]) {
          const result = revive(item);
          if (result) {
            flows.push({
              id: uid(),
              picture: null,
              thumb: null,
              hint: "",
              runs: [{ ...blankRun(), result }],
            });
          }
        }
      }
    }
    const kept = flows.slice(0, KEEP);
    // Anything without a saved spot gets a default one, stacked below what is already placed.
    let top = 0;
    for (const flow of kept) {
      if (!nodeIdsOf(flow).every((id) => pos[id])) {
        pos = { ...pos, ...placeFlow(flow, { x: 0, y: top }) };
      }
      top += Math.max(1, flow.runs.length) * ROW;
    }
    return { flows: kept, pos };
  } catch {
    return { flows: [], pos: {} };
  }
}

/** Keep the newest results only, and only the parts that can be restored. */
function trimmed(flows: Flow[], pos: Record<string, Point>) {
  let room = KEEP;
  const outFlows: Array<{
    id: string;
    thumb: string | null;
    hint: string;
    model?: string;
    runs: Array<{ id: string; result: Result }>;
  }> = [];
  const outPos: Record<string, Point> = {};
  for (const flow of flows) {
    const runs: Array<{ id: string; result: Result }> = [];
    for (const run of flow.runs) {
      if (!run.result || room <= 0) continue;
      runs.push({ id: run.id, result: run.result });
      room -= 1;
    }
    if (!runs.length) continue;
    outFlows.push({
      id: flow.id,
      thumb: flow.thumb,
      hint: flow.hint,
      model: flow.model,
      runs,
    });
    for (const id of [
      `img-${flow.id}`,
      ...runs.map((run) => `out-${run.id}`),
    ]) {
      const point = pos[id];
      if (point)
        outPos[id] = { x: Math.round(point.x), y: Math.round(point.y) };
    }
  }
  return { flows: outFlows, pos: outPos };
}

const asBlock = (result: Result): Block => ({
  id: result.id,
  name: result.name,
  cat: "Card",
  h: 240,
});

/** The root width the model drew, so the block node can be as wide as the block itself. */
function blockWidth(html: string) {
  const match =
    /^\s*<div[^>]*?style="(?:[^"]*?[;\s])?width:\s*(\d+(?:\.\d+)?)px/i.exec(
      html,
    );
  const natural = match ? Number(match[1]) : 300;
  return clamp(Math.round(natural) + 112, 360, 860);
}

const MODEL_GROUPS = [
  { provider: "anthropic", label: "Claude", note: "Uses your daily limit" },
  {
    provider: "openrouter",
    label: "Free",
    note: "No daily limit, rate limited",
  },
] as const;

/** The model picker: a small menu in the app's own style instead of the browser's select. */
function ModelMenu({
  value,
  onChange,
  unavailable,
}: {
  value: string;
  onChange: (id: string) => void;
  unavailable: (item: (typeof MIMIC_MODELS)[number]) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = MIMIC_MODELS.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const move = (step: number) => {
    const usable = MIMIC_MODELS.filter((item) => !unavailable(item));
    const index = usable.findIndex((item) => item.id === value);
    const next = usable[(index + step + usable.length) % usable.length];
    if (next) onChange(next.id);
  };

  return (
    <div
      className="mimic-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Closes the menu only; the node stays selected.
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) setOpen(true);
          else move(event.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <button
        type="button"
        className="mimic-menu-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
        title={current?.hint}
        onClick={() => setOpen((on) => !on)}
      >
        {current?.label ?? "Model"}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m3 4.5 3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <ul className="mimic-menu-list" role="listbox" aria-label="Model">
          {MODEL_GROUPS.map((group) => (
            <li key={group.provider} role="presentation">
              <p className="mimic-menu-group">
                {group.label}
                <small>{group.note}</small>
              </p>
              <ul role="presentation">
                {MIMIC_MODELS.filter(
                  (item) => item.provider === group.provider,
                ).map((item) => {
                  const missing = unavailable(item);
                  return (
                    <li key={item.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={item.id === value}
                        disabled={missing}
                        onClick={() => {
                          onChange(item.id);
                          setOpen(false);
                        }}
                      >
                        <span className="mimic-menu-name">
                          {item.label}
                          <small>
                            {missing ? "Add a key to use this" : item.hint}
                          </small>
                        </span>
                        {item.id === value ? (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="m3.5 8.5 3 3 6-7"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Snapshot = { flows: Flow[]; pos: Record<string, Point> };

/** What counts as a change worth undoing: which rows and blocks exist, their model and where they sit. */
const snapshotKey = (flows: Flow[], pos: Record<string, Point>) =>
  JSON.stringify([
    flows.map((flow) => [
      flow.id,
      flow.model ?? "",
      flow.runs.map((run) => [run.id, run.result?.id ?? ""]),
    ]),
    pos,
  ]);

const isBusy = (flows: Flow[]) =>
  flows.some((flow) => flow.runs.some((run) => run.working || run.refining));

const WORKING_STEPS = [
  "Reading the screenshot",
  "Measuring the spacing",
  "Matching colors and fonts",
  "Building the layout",
  "Almost there",
];

/** A small cluster of dots that turns: the "AI is working" mark. */
function Spark() {
  return (
    <svg
      className="mimic-spark"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle cx="9" cy="3.2" r="1.7" />
      <circle cx="14.6" cy="11.6" r="1.3" />
      <circle cx="4.6" cy="12.4" r="2.1" />
    </svg>
  );
}

const elapsed = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

/**
 * What shows while a block is being made: a turning mark, a line that moves on every couple of seconds, the time
 * it has taken, and a chevron that opens the steps so far. A detailed image can take a minute or more, so after a
 * while it says so and offers to stop waiting.
 */
function Working({ onCancel }: { onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const slow = seconds >= 20;
  const step = Math.min(Math.floor(seconds / 2.4), WORKING_STEPS.length - 1);
  return (
    <span className="mimic-working-wrap" role="status">
      <button
        type="button"
        className="mimic-work-row"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
      >
        <Spark />
        <span key={slow ? "slow" : step} className="mimic-work-text">
          {slow ? "Still working on a detailed image" : WORKING_STEPS[step]}
        </span>
        <span className="mimic-work-time">{elapsed(seconds)}</span>
        <svg
          className="mimic-work-chev"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4.5 3 3 3-3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <ul className="mimic-work-steps">
          {WORKING_STEPS.slice(0, step + 1).map((label, index) => (
            <li key={label} data-done={index < step ? "true" : "false"}>
              {index < step ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="m2.5 6.4 2.2 2.2 4.8-5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <Spark />
              )}
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {slow ? (
        <button type="button" className="mimic-link" onClick={onCancel}>
          Stop waiting
        </button>
      ) : null}
    </span>
  );
}

const PROMPT_TIPS = [
  "What is it? e.g. pricing card",
  "Ask for changes: make it blue",
  "Only the modal in the middle",
  "Add notes: dark mode, no icons",
];

/** The notes field under an image. Its hint line changes every few seconds to show what can be asked for. */
function PromptField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    if (value) return;
    const timer = window.setInterval(
      () => setTip((n) => (n + 1) % PROMPT_TIPS.length),
      3200,
    );
    return () => window.clearInterval(timer);
  }, [value]);
  return (
    <span className="mimic-prompt-field">
      <input
        value={value}
        maxLength={200}
        aria-label="Notes for the clone: what it is, or what to change"
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? null : (
        <span key={tip} className="mimic-prompt-tip" aria-hidden="true">
          {PROMPT_TIPS[tip]}
        </span>
      )}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 2.6v10.8a.6.6 0 0 0 .92.5l8.4-5.4a.6.6 0 0 0 0-1L5.42 2.1a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 6h11M8 6V4.5h4V6M6 6l.6 9a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6M8.5 9v4M11.5 9v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplaceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="3"
        width="6"
        height="6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="11.5"
        y="11"
        width="6"
        height="6"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M11 5.5h3.5a2 2 0 0 1 2 2V9M9 14.5H5.5a2 2 0 0 1-2-2V11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 16V4.5M5 9.2 10 4.2l5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.75"
        y="2.75"
        width="12.5"
        height="10.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="5.6" cy="6.4" r="1.1" fill="currentColor" />
      <path
        d="m2.5 12 3.6-3.4 2.6 2.4 2-1.8 3.3 2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A block is not redrawn while the canvas is panned, zoomed or a node is dragged. */
const Preview = memo(function Preview({ id }: { id: string }) {
  return <BlockView id={id} />;
});

const EXAMPLE_ID = "mimic-example";
const EXAMPLE_HTML = `<div class="kit" data-layer="Pricing card" style="display: flex; flex-direction: column; gap: 16px; width: 248px; padding: 20px; background-color: #ffffff; border: 1px solid #E6E5E2; border-radius: 16px; font-family: Geist, sans-serif"><div data-layer="Plan" style="display: flex; flex-direction: column; gap: 4px"><span style="font-size: 14px; font-weight: 500; line-height: 18px; color: #6F6E68; font-family: Geist, sans-serif">Pro</span><div style="display: flex; align-items: flex-end; gap: 4px"><span style="font-size: 32px; font-weight: 600; line-height: 36px; color: #17181A; font-family: Geist, sans-serif">$12</span><span style="font-size: 14px; line-height: 22px; color: #6F6E68; font-family: Geist, sans-serif">/ month</span></div></div><div data-layer="Features" style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 14px; line-height: 18px; color: #17181A; font-family: Geist, sans-serif">Unlimited blocks</span><span style="font-size: 14px; line-height: 18px; color: #17181A; font-family: Geist, sans-serif">Priority support</span></div><div data-layer="Button" style="display: flex; align-items: center; justify-content: center; padding: 10px 16px; background-color: #17181A; border-radius: 10px"><span style="font-size: 14px; font-weight: 500; line-height: 18px; color: #ffffff; font-family: Geist, sans-serif">Get started</span></div></div>`;
/** A plain stand-in for the screenshot: the same card, drawn flat on a grey page. */
const EXAMPLE_SHOT = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220" viewBox="0 0 300 220"><rect width="300" height="220" fill="#ECEBE8"/><rect x="38" y="20" width="224" height="180" rx="14" fill="#fff" stroke="#DADAD6"/><rect x="56" y="38" width="30" height="8" rx="4" fill="#B9B8B3"/><rect x="56" y="56" width="62" height="20" rx="6" fill="#17181A"/><rect x="56" y="92" width="96" height="7" rx="3.5" fill="#DADAD6"/><rect x="56" y="108" width="80" height="7" rx="3.5" fill="#DADAD6"/><rect x="56" y="140" width="188" height="36" rx="10" fill="#17181A"/></svg>`,
)}`;

/** One finished flow, only to show how it works. Not clickable and gone as soon as a screenshot is added. */
function Example() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const html = sanitizeBlockHtml(EXAMPLE_HTML);
    if (html) {
      registerGenerated(EXAMPLE_ID, html);
      setReady(true);
    }
  }, []);
  return (
    <div className="mimic-example" aria-hidden="true" inert>
      <p className="mimic-example-tag">Example</p>
      <div className="mimic-example-row">
        <div className="mimic-item mimic-source" data-example="">
          <p className="mimic-label">
            <ImageIcon /> Image
          </p>
          <div className="mimic-pic">
            <img src={EXAMPLE_SHOT} alt="" draggable={false} />
            <span className="mimic-badge">1080 × 1350</span>
            <span className="mimic-replace">
              <ReplaceIcon /> Replace
            </span>
          </div>
          <div className="mimic-float mimic-toolbar">
            <span className="mimic-run">
              <PlayIcon /> Clone again
            </span>
            <span className="mimic-example-model">Sonnet 5.5</span>
          </div>
          <div className="mimic-float mimic-prompt">
            <input value="Pricing card" readOnly tabIndex={-1} />
            <span className="mimic-example-send">
              <SendIcon />
            </span>
          </div>
        </div>
        <svg
          className="mimic-example-edge"
          width="64"
          height="12"
          viewBox="0 0 64 12"
          fill="none"
        >
          <path
            d="M2 6h56"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 4"
            strokeLinecap="round"
          />
          <path
            d="m54 2 5 4-5 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="mimic-node mimic-out">
          <article className="card" style={{ ["--h" as string]: "240px" }}>
            <div className="stage">
              {ready ? <Preview id={EXAMPLE_ID} /> : null}
            </div>
            <span className="cname">Pricing card</span>
            <span className="copy">
              <FigmaMark />
              Copy
            </span>
          </article>
        </div>
      </div>
    </div>
  );
}

function MimicTool({
  signedIn,
  userId,
  pending,
  onLogin,
  onCopy,
  onNotify,
  busy,
  copied,
}: Props) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [pos, setPos] = useState<Record<string, Point>>({});
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<MimicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [selected, setSelected] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MIMIC_MODEL);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const nodes = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const observer = useRef<ResizeObserver | null>(null);
  const dragged = useRef(false);
  const space = useRef(false);
  const easeTimer = useRef(0);
  const refit = useRef(false);
  const selectedRef = useRef(selected);
  const openRef = useRef<string | null>(null);
  const api = useRef({
    zoomBy: (_factor: number) => {},
    zoomTo: (_z: number) => {},
    focus: (_ids: string[], _mode: "fit" | "reveal" | "center") => {},
    remove: (_ids: string[]) => {},
    nudge: (_ids: string[], _dx: number, _dy: number) => {},
    history: (_direction: "undo" | "redo") => {},
  });
  selectedRef.current = selected;
  openRef.current = openId;
  const fitted = useRef(false);
  /** Nodes the view should go to once they are measured: "reveal" if off screen, "center" always. */
  const reveal = useRef<{ ids: string[]; mode: "reveal" | "center" } | null>(
    null,
  );
  const posRef = useRef(pos);
  const flowsRef = useRef(flows);
  const lastKey = useRef<string | null>(null);
  const sizesRef = useRef(sizes);
  posRef.current = pos;
  flowsRef.current = flows;
  /** Undo and redo: snapshots of the board (rows, blocks, positions) taken after each settled change. */
  /** True while a node is being dragged: a drag is one undo step, recorded when it ends. */
  const dragging = useRef(false);
  const history = useRef<{
    past: Snapshot[];
    future: Snapshot[];
    present: Snapshot;
    key: string;
  } | null>(null);
  sizesRef.current = sizes;
  /** The shrunk screenshot of each board row, kept in memory so a Mimic node can run again. */
  const prepared = useRef(new Map<string, Promise<Prepared>>());

  const storeKey = userId ? `${STORE_KEY}:${userId}` : null;
  /** Record the board as one undo step when it differs from the last one. */
  function commitHistory() {
    const f = flowsRef.current;
    const p = posRef.current;
    if (isBusy(f)) return;
    const key = snapshotKey(f, p);
    const h = history.current;
    if (!h) {
      history.current = {
        past: [],
        future: [],
        present: { flows: f, pos: p },
        key,
      };
      return;
    }
    if (key === h.key) {
      // Only things that are not undone (a hint, a thumbnail): keep the latest copy.
      h.present = { flows: f, pos: p };
      return;
    }
    h.past.push(h.present);
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    h.present = { flows: f, pos: p };
    h.key = key;
  }

  function stepHistory(direction: "undo" | "redo") {
    // Not while a block is being made: it would be dropped from under the running request.
    if (isBusy(flowsRef.current)) return;
    commitHistory();
    const h = history.current;
    if (!h) return;
    const from = direction === "undo" ? h.past : h.future;
    const snap = from.pop();
    if (!snap) return;
    (direction === "undo" ? h.future : h.past).push(h.present);
    h.present = snap;
    h.key = snapshotKey(snap.flows, snap.pos);
    // Text typed into a hint is not part of the history: keep what is there now.
    const hints = new Map(flowsRef.current.map((flow) => [flow.id, flow.hint]));
    setFlows(
      snap.flows.map((flow) => ({
        ...flow,
        hint: hints.get(flow.id) ?? flow.hint,
      })),
    );
    setPos(snap.pos);
    const alive = new Set(nodeIds(snap.flows));
    setSelected((old) => old.filter((id) => alive.has(id)));
  }

  useEffect(() => {
    if (pending || (storeKey && !loaded) || isBusy(flows) || dragging.current)
      return;
    const timer = window.setTimeout(commitHistory, history.current ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [flows, pos, pending, loaded, storeKey]);

  // The canvas belongs to the account: signed out there is none, and another account never sees it.
  useEffect(() => {
    if (pending) return;
    const before = lastKey.current;
    lastKey.current = storeKey;
    if (before === storeKey) return;
    // A different board starts with a clean undo history.
    history.current = null;
    setLoaded(false);
    setOpenId(null);
    setSelected([]);
    // Pictures added while signed out come along when the visitor logs in; any other switch starts clean.
    const guest = !before && storeKey ? flowsRef.current : [];
    if (!guest.length) prepared.current.clear();
    if (!storeKey) {
      // A visitor who was never signed in keeps what they added; only a logout empties the board.
      if (before) {
        setFlows([]);
        setPos({});
      }
      return;
    }
    try {
      // The board kept before boards were per account goes to the first account that opens Mimic.
      if (!localStorage.getItem(storeKey) && localStorage.getItem(STORE_KEY)) {
        localStorage.setItem(storeKey, localStorage.getItem(STORE_KEY) ?? "");
      }
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* storage can be blocked */
    }
    const saved = loadSaved(storeKey);
    if (guest.length) {
      // Put the new pictures below what the account already has.
      let left = Infinity;
      let bottom = -Infinity;
      for (const point of Object.values(saved.pos)) {
        left = Math.min(left, point.x);
        bottom = Math.max(bottom, point.y + ROW);
      }
      const origin = Number.isFinite(left)
        ? { x: left, y: bottom }
        : { x: 0, y: 0 };
      const placed: Record<string, Point> = {};
      guest.forEach((flow, index) => {
        Object.assign(
          placed,
          placeFlow(flow, { x: origin.x, y: origin.y + index * ROW }),
        );
      });
      setFlows([...guest, ...saved.flows]);
      setPos({ ...saved.pos, ...placed });
      reveal.current = {
        ids: guest.flatMap((flow) => nodeIdsOf(flow)),
        mode: "reveal",
      };
    } else {
      setFlows(saved.flows);
      setPos(saved.pos);
    }
    try {
      const model = localStorage.getItem("block-supply-mimic-model");
      if (isMimicModel(model)) setDefaultModel(model);
    } catch {
      /* storage can be blocked */
    }
    setLoaded(true);
  }, [pending, storeKey]);

  useEffect(() => {
    if (!loaded || !storeKey) return;
    try {
      localStorage.setItem(
        storeKey,
        JSON.stringify({ v: 3, ...trimmed(flows, pos) }),
      );
    } catch {
      /* storage can be blocked */
    }
  }, [flows, pos, loaded, storeKey]);

  useEffect(() => {
    if (!signedIn) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    mimicStatus()
      .then((next) => !cancelled && setStatus(next))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // ---- view: pan and zoom ----------------------------------------------------------------------

  /** `animated` eases the move; wheel, drag and pinch always follow the hand with no delay. */
  const applyView = useCallback((animated = false) => {
    const { x, y, z } = view.current;
    const layer = world.current;
    const frame = viewport.current;
    if (layer) layer.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    if (frame) {
      window.clearTimeout(easeTimer.current);
      if (animated) {
        frame.dataset.ease = "true";
        easeTimer.current = window.setTimeout(
          () => delete frame.dataset.ease,
          360,
        );
      } else {
        delete frame.dataset.ease;
      }
      frame.style.setProperty("--vx", `${x}px`);
      frame.style.setProperty("--vy", `${y}px`);
      frame.style.setProperty("--vz", String(z));
    }
    setZoom(Math.round(z * 100));
  }, []);

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number, animated = false) => {
      const v = view.current;
      const z = clamp(v.z * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = z / v.z;
      view.current = {
        z,
        x: cx - (cx - v.x) * ratio,
        y: cy - (cy - v.y) * ratio,
      };
      applyView(animated);
    },
    [applyView],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const frame = viewport.current;
      if (frame)
        zoomAt(frame.clientWidth / 2, frame.clientHeight / 2, factor, true);
    },
    [zoomAt],
  );

  const zoomTo = useCallback(
    (z: number) => zoomBy(z / view.current.z),
    [zoomBy],
  );

  useEffect(() => {
    applyView();
    const frame = viewport.current;
    if (!frame) return;
    // Wheel pans; pinch (ctrl) and Cmd or Ctrl with the wheel zoom around the pointer, like Figma.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = frame.getBoundingClientRect();
        const speed = event.ctrlKey ? 0.01 : 0.0025;
        zoomAt(
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(-clamp(event.deltaY, -60, 60) * speed),
        );
        return;
      }
      const v = view.current;
      const sideways = event.shiftKey && !event.deltaX;
      view.current = {
        ...v,
        x: v.x - (sideways ? event.deltaY : event.deltaX),
        y: v.y - (sideways ? 0 : event.deltaY),
      };
      applyView();
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [applyView, zoomAt]);

  // Background gestures: drag or one finger pans, two fingers pinch and pan, Shift-drag selects a box.
  // A press on a node is left to the node, unless Space is held or the middle button is used.
  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    const pointers = new Map<number, Point>();
    let mode: "none" | "pan" | "pinch" | "marquee" = "none";
    let start: Point = { x: 0, y: 0 };
    let origin: View = { ...view.current };
    let travelled = 0;
    let pinch = { dist: 1, z: 1, cx: 0, cy: 0, vx: 0, vy: 0 };
    const local = (event: PointerEvent): Point => {
      const rect = frame.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const firstPointer = () => pointers.values().next().value as Point;
    const beginPinch = () => {
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        z: view.current.z,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        vx: view.current.x,
        vy: view.current.y,
      };
      setMarquee(null);
      mode = "pinch";
    };

    const down = (event: PointerEvent) => {
      const onNode = (event.target as HTMLElement).closest(".mimic-item");
      if (onNode && !space.current && event.button === 0) return;
      if (event.pointerType === "mouse" && event.button > 1) return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      try {
        frame.setPointerCapture(event.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
      pointers.set(event.pointerId, local(event));
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      start = local(event);
      origin = { ...view.current };
      travelled = 0;
      mode =
        event.shiftKey && event.pointerType === "mouse" ? "marquee" : "pan";
      if (mode === "pan") frame.dataset.panning = "true";
    };

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, local(event));
      if (mode === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const z = clamp(pinch.z * (dist / pinch.dist), MIN_ZOOM, MAX_ZOOM);
        const ratio = z / pinch.z;
        view.current = {
          z,
          x: cx - (pinch.cx - pinch.vx) * ratio,
          y: cy - (pinch.cy - pinch.vy) * ratio,
        };
        applyView();
      } else if (mode === "pan") {
        const point = firstPointer();
        travelled = Math.max(
          travelled,
          Math.abs(point.x - start.x) + Math.abs(point.y - start.y),
        );
        view.current = {
          ...origin,
          x: origin.x + point.x - start.x,
          y: origin.y + point.y - start.y,
        };
        applyView();
      } else if (mode === "marquee") {
        const point = firstPointer();
        setMarquee({ x0: start.x, y0: start.y, x1: point.x, y1: point.y });
      }
    };

    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 0) {
        if (mode === "marquee") {
          const end = local(event);
          const v = view.current;
          const x0 = (Math.min(start.x, end.x) - v.x) / v.z;
          const x1 = (Math.max(start.x, end.x) - v.x) / v.z;
          const y0 = (Math.min(start.y, end.y) - v.y) / v.z;
          const y1 = (Math.max(start.y, end.y) - v.y) / v.z;
          const hit = Object.entries(posRef.current)
            .filter(([id, point]) => {
              const size = sizesRef.current[id];
              return (
                size &&
                point.x < x1 &&
                point.x + size.w > x0 &&
                point.y < y1 &&
                point.y + size.h > y0
              );
            })
            .map(([id]) => id);
          setSelected(hit);
          setMarquee(null);
        } else if (mode === "pan" && travelled < 4) {
          setSelected([]);
        }
        delete frame.dataset.panning;
        mode = "none";
      } else if (pointers.size === 1) {
        // One finger left after a pinch: carry on as a pan from where it is.
        start = firstPointer();
        origin = { ...view.current };
        travelled = 9;
        mode = "pan";
      }
    };

    frame.addEventListener("pointerdown", down);
    frame.addEventListener("pointermove", move);
    frame.addEventListener("pointerup", up);
    frame.addEventListener("pointercancel", up);
    return () => {
      frame.removeEventListener("pointerdown", down);
      frame.removeEventListener("pointermove", move);
      frame.removeEventListener("pointerup", up);
      frame.removeEventListener("pointercancel", up);
    };
  }, [applyView]);

  // Keyboard, like Figma: Space pans, Cmd +/- zoom, Shift 1 fits, Shift 0 is 100%, Delete removes.
  useEffect(() => {
    const frame = viewport.current;
    const idle = (event: KeyboardEvent) =>
      !openRef.current &&
      !(event.target as HTMLElement | null)?.closest?.(
        "input, textarea, select, [contenteditable]",
      );
    const onKey = (event: KeyboardEvent) => {
      if (!idle(event)) return;
      const onControl = (event.target as HTMLElement | null)?.closest?.(
        "button, a",
      );
      if (event.code === "Space") {
        if (onControl) return;
        event.preventDefault();
        space.current = true;
        if (frame) frame.dataset.space = "true";
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      const ids = selectedRef.current;
      const letter = event.key.toLowerCase();
      if (mod && letter === "z") {
        event.preventDefault();
        api.current.history(event.shiftKey ? "redo" : "undo");
      } else if (event.ctrlKey && !event.metaKey && letter === "y") {
        event.preventDefault();
        api.current.history("redo");
      } else if (mod && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        api.current.zoomBy(1.25);
      } else if (mod && event.key === "-") {
        event.preventDefault();
        api.current.zoomBy(1 / 1.25);
      } else if (
        (mod && event.key === "0") ||
        (event.shiftKey && event.code === "Digit0")
      ) {
        event.preventDefault();
        api.current.zoomTo(1);
      } else if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        api.current.focus([], "fit");
      } else if (event.shiftKey && event.code === "Digit2" && ids.length) {
        event.preventDefault();
        api.current.focus(ids, "fit");
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        ids.length &&
        !onControl
      ) {
        event.preventDefault();
        api.current.remove(ids);
      } else if (event.key === "Escape") {
        setSelected([]);
      } else if (ids.length && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10;
        api.current.nudge(
          ids,
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
        );
      }
    };
    const release = () => {
      space.current = false;
      if (frame) delete frame.dataset.space;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  function startDrag(event: ReactPointerEvent, id: string) {
    if (event.button !== 0 || space.current) return;
    // Press selects: Shift adds or removes, a plain press on an unselected node selects only it.
    let group = selectedRef.current;
    if (event.shiftKey) {
      group = group.includes(id)
        ? group.filter((item) => item !== id)
        : [...group, id];
      setSelected(group);
      if (!group.includes(id)) return;
    } else if (!group.includes(id)) {
      group = [id];
      setSelected(group);
    }
    if (
      (event.target as HTMLElement).closest(
        "input, button, textarea, select, a",
      )
    )
      return;
    const starts = group
      .map((item) => [item, posRef.current[item]] as const)
      .filter((entry): entry is readonly [string, Point] => Boolean(entry[1]));
    if (!starts.length) return;
    const sx = event.clientX;
    const sy = event.clientY;
    const additive = event.shiftKey;
    dragged.current = false;
    const move = (next: PointerEvent) => {
      if (
        !dragged.current &&
        Math.abs(next.clientX - sx) + Math.abs(next.clientY - sy) < 4
      )
        return;
      dragged.current = true;
      dragging.current = true;
      const z = view.current.z;
      const dx = (next.clientX - sx) / z;
      const dy = (next.clientY - sy) / z;
      setPos((old) => {
        const out = { ...old };
        for (const [item, point] of starts) {
          out[item] = { x: point.x + dx, y: point.y + dy };
        }
        return out;
      });
    };
    const up = () => {
      // A plain click inside a group narrows it to that node.
      if (!dragged.current && !additive && group.length > 1) setSelected([id]);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dragging.current) {
        dragging.current = false;
        window.setTimeout(commitHistory, 80);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /**
   * Bring nodes into view: "fit" frames them all; "reveal" only moves the view when they are off screen;
   * "center" always goes to them, at a zoom where their floating tools fit too.
   */
  function focus(ids: string[], mode: "fit" | "reveal" | "center") {
    const frame = viewport.current;
    if (!frame) return;
    if (!ids.length) ids = nodeIds(flows);
    const W = frame.clientWidth;
    const H = frame.clientHeight;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      const point = pos[id];
      const size = sizes[id];
      if (!point || !size) continue;
      x0 = Math.min(x0, point.x);
      y0 = Math.min(y0, point.y);
      x1 = Math.max(x1, point.x + size.w);
      y1 = Math.max(y1, point.y + size.h);
    }
    if (!Number.isFinite(x0)) {
      view.current = { x: 0, y: 0, z: 1 };
      applyView(true);
      return;
    }
    const pad = { l: 24, r: 24, t: W < 760 ? 190 : 130, b: 96 };
    if (mode === "center") {
      // Room for the toolbar above the image and the prompt below it.
      pad.t = W < 760 ? 210 : 170;
      pad.b = 110;
    }
    const bw = x1 - x0;
    const bh = y1 - y0;
    const fit = clamp(
      Math.min((W - pad.l - pad.r) / bw, (H - pad.t - pad.b) / bh),
      MIN_ZOOM,
      1,
    );
    const v = view.current;
    let z = fit;
    if (mode === "reveal") {
      const inside =
        x0 * v.z + v.x >= pad.l / 2 &&
        y0 * v.z + v.y >= pad.t / 2 &&
        x1 * v.z + v.x <= W - pad.r / 2 &&
        y1 * v.z + v.y <= H - pad.b / 2;
      if (inside) return;
      z = Math.min(v.z, fit);
    }
    view.current = {
      z,
      x: pad.l + (W - pad.l - pad.r - bw * z) / 2 - x0 * z,
      y: pad.t + (H - pad.t - pad.b - bh * z) / 2 - y0 * z,
    };
    applyView(true);
  }

  // Frame everything once after the saved board is back, and go to a newly added image or block.
  useEffect(() => {
    const all = nodeIds(flows);
    const measured = (ids: string[]) => ids.every((id) => sizes[id] && pos[id]);
    const go = reveal.current;
    if (!loaded) {
      // A visitor who is not signed in has no saved board to wait for, but can still add an image.
      if (go && measured(go.ids)) {
        reveal.current = null;
        focus(go.ids, go.mode);
      }
      return;
    }
    if (go && measured(go.ids)) {
      fitted.current = true;
      reveal.current = null;
      focus(go.ids, go.mode);
    } else if (!fitted.current && all.length && measured(all)) {
      fitted.current = true;
      focus(all, "fit");
    } else if (refit.current) {
      refit.current = false;
      focus(all, "fit");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, flows, sizes, pos]);

  // ---- node sizes: every node reports its box so the lines can reach its edges -----------------

  const measureSizes = useCallback(() => {
    setSizes((old) => {
      let changed = false;
      const next = { ...old };
      for (const [id, element] of nodes.current) {
        const w = element.offsetWidth;
        const h = element.offsetHeight;
        if (!old[id] || old[id].w !== w || old[id].h !== h) {
          next[id] = { w, h };
          changed = true;
        }
      }
      return changed ? next : old;
    });
  }, []);

  const reg = (id: string) => {
    let callback = refs.current.get(id);
    if (!callback) {
      callback = (element) => {
        const previous = nodes.current.get(id);
        if (previous && previous !== element)
          observer.current?.unobserve(previous);
        if (!element) {
          nodes.current.delete(id);
          return;
        }
        nodes.current.set(id, element);
        if (!observer.current && typeof ResizeObserver !== "undefined") {
          observer.current = new ResizeObserver(() => measureSizes());
        }
        observer.current?.observe(element);
      };
      refs.current.set(id, callback);
    }
    return callback;
  };

  useEffect(() => () => observer.current?.disconnect(), []);

  const edges = useMemo(() => {
    const list: Edge[] = [];
    for (const flow of flows) {
      for (const run of flow.runs) {
        const from = `img-${flow.id}`;
        const to = `out-${run.id}`;
        const a = pos[from];
        const b = pos[to];
        const sa = sizes[from];
        const sb = sizes[to];
        if (!a || !b || !sa || !sb) continue;
        const x1 = Math.round(a.x + sa.w);
        const y1 = Math.round(a.y + sa.h / 2);
        const x2 = Math.round(b.x);
        const y2 = Math.round(b.y + Math.min(sb.h, 340) / 2);
        const pull = Math.max(40, Math.abs(x2 - x1) / 2);
        list.push({
          key: `${from}>${to}`,
          d: `M${x1} ${y1}C${x1 + pull} ${y1} ${x2 - pull} ${y2} ${x2} ${y2}`,
          x1,
          y1,
          x2,
          y2,
        });
      }
    }
    return list;
  }, [flows, pos, sizes]);

  // ---- board changes ---------------------------------------------------------------------------

  const patchFlow = useCallback((flowId: string, patch: Partial<Flow>) => {
    setFlows((old) =>
      old.map((flow) => (flow.id === flowId ? { ...flow, ...patch } : flow)),
    );
  }, []);

  const patchRun = useCallback(
    (flowId: string, runId: string, patch: Partial<Run>) => {
      setFlows((old) =>
        old.map((flow) =>
          flow.id === flowId
            ? {
                ...flow,
                runs: flow.runs.map((run) =>
                  run.id === runId ? { ...run, ...patch } : run,
                ),
              }
            : flow,
        ),
      );
    },
    [],
  );

  const addFlow = useCallback((next: File | null | undefined, at?: Point) => {
    if (!next) return;
    const problem = fileProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const id = uid();
    const picture = URL.createObjectURL(next);
    const job = prepare(next);
    prepared.current.set(id, job);
    const flow: Flow = { id, picture, thumb: null, hint: "", runs: [] };
    // New rows go below everything already on the board, in line with its left edge.
    let left = Infinity;
    let bottom = -Infinity;
    for (const [key, point] of Object.entries(posRef.current)) {
      left = Math.min(left, point.x);
      bottom = Math.max(bottom, point.y + (sizesRef.current[key]?.h ?? 300));
    }
    const origin =
      at ??
      (Number.isFinite(left) ? { x: left, y: bottom + 80 } : { x: 0, y: 0 });
    reveal.current = { ids: [`img-${id}`], mode: "center" };
    setPos((old) => ({ ...old, ...placeFlow(flow, origin) }));
    setFlows((old) => [flow, ...old]);
    setSelected([]);
    job
      .then((ready) =>
        setFlows((old) =>
          old.map((item) =>
            item.id === id
              ? {
                  ...item,
                  thumb: ready.thumb,
                  photo: ready.photo,
                  dims: `${ready.sourceWidth} × ${ready.sourceHeight}`,
                }
              : item,
          ),
        ),
      )
      .catch((failure) => {
        prepared.current.delete(id);
        URL.revokeObjectURL(picture);
        setFlows((old) => old.filter((item) => item.id !== id));
        setError(
          failure instanceof Error && failure.message
            ? failure.message
            : "That image could not be read.",
        );
      });
  }, []);

  /** Swap the screenshot of a row, e.g. to rebuild again after a reload. */
  const replaceShot = useCallback(
    (id: string, next: File | null | undefined) => {
      if (!next) return;
      const problem = fileProblem(next);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      const picture = URL.createObjectURL(next);
      const job = prepare(next);
      prepared.current.set(id, job);
      setFlows((old) =>
        old.map((item) =>
          item.id === id
            ? {
                ...item,
                picture,
                thumb: null,
                photo: undefined,
                dims: undefined,
              }
            : item,
        ),
      );
      job
        .then((ready) =>
          setFlows((old) =>
            old.map((item) =>
              item.id === id
                ? {
                    ...item,
                    thumb: ready.thumb,
                    photo: ready.photo,
                    dims: `${ready.sourceWidth} × ${ready.sourceHeight}`,
                  }
                : item,
            ),
          ),
        )
        .catch((failure) => {
          prepared.current.delete(id);
          setError(
            failure instanceof Error && failure.message
              ? failure.message
              : "That image could not be read.",
          );
        });
    },
    [],
  );

  // A screenshot pasted from the clipboard works anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith("image/"),
      );
      const pasted = item?.getAsFile();
      if (pasted) {
        event.preventDefault();
        addFlow(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFlow]);

  /**
   * One model call for a block. "build" is a new block from the screenshot; "refine" compares the block with
   * the screenshot; "edit" applies what was typed under the block (no screenshot needed).
   */
  async function generate(
    flow: Flow,
    run: Run,
    mode: "build" | "refine" | "edit",
  ) {
    if (run.working) return;
    patchRun(flow.id, run.id, {
      working: true,
      refining: mode !== "build",
      error: null,
    });
    try {
      const job = prepared.current.get(flow.id);
      if (!job && mode !== "edit")
        throw new Error("Add the screenshot again to rebuild it.");
      const shot = job ? await job : null;
      const model = flow.model ?? defaultModel;
      let html: string | undefined;
      let render: string | undefined;
      if (mode !== "build" && run.result) {
        html = run.result.html;
        if (mode === "refine") {
          // How the block looks now, drawn at its real size, so the model can compare the two.
          const kit = kitIn(document.getElementById(`block-${run.result.id}`));
          if (kit) {
            render = await renderBlockPng(
              html,
              kit.offsetWidth,
              kit.offsetHeight,
            ).catch(() => undefined);
            // Too big to send along: the refine still works from the screenshot and the HTML.
            if (render && render.length > 1_500_000) render = undefined;
          }
        }
      }
      // Never wait forever: if nothing has come back after this long, say so instead of spinning.
      let giveUp: number | undefined;
      const out = await Promise.race([
        mimicGenerate({
          data: {
            image: shot?.image,
            mime: shot?.mime,
            hint: flow.hint,
            width: shot?.width,
            height: shot?.height,
            model,
            html,
            render,
            instruction: mode === "edit" ? run.instruction : undefined,
          },
        }),
        new Promise<never>((_, reject) => {
          giveUp = window.setTimeout(
            () =>
              reject(
                new Error(
                  "That took too long. Try a simpler crop, or a faster model like Sonnet.",
                ),
              ),
            240_000,
          );
        }),
      ]).finally(() => window.clearTimeout(giveUp));
      const next = sanitizeBlockHtml(out.html);
      if (!next) throw new Error("The result could not be drawn. Try again.");
      const id = `mimic-${uid()}`;
      registerGenerated(id, next);
      patchRun(flow.id, run.id, {
        working: false,
        refining: false,
        instruction: mode === "edit" ? "" : run.instruction,
        result: { id, name: out.name, html: next, note: out.note, model },
      });
      setStatus((old) =>
        old ? { ...old, used: out.used, limit: out.limit } : old,
      );
    } catch (failure) {
      patchRun(flow.id, run.id, {
        working: false,
        refining: false,
        error:
          failure instanceof Error && failure.message
            ? failure.message
            : "Something went wrong. Try again.",
      });
      void mimicStatus()
        .then(setStatus)
        .catch(() => {});
    }
  }

  /** A new block next to the existing ones, filled from the screenshot with the image node's input. */
  function build(flow: Flow) {
    if (flow.runs.some((run) => run.working) || flow.runs.length >= MAX_RUNS)
      return;
    // generate() marks it as working itself; starting it as working made generate() return at once.
    const run: Run = blankRun();
    const image = pos[`img-${flow.id}`] ?? { x: 0, y: 0 };
    const last = flow.runs[flow.runs.length - 1];
    const lastSpot = last ? pos[`out-${last.id}`] : undefined;
    reveal.current = { ids: [`out-${run.id}`], mode: "reveal" };
    setPos((old) => ({
      ...old,
      [`out-${run.id}`]: lastSpot
        ? { x: lastSpot.x, y: lastSpot.y + ROW }
        : { x: image.x + IMG_W + GAP_X, y: image.y },
    }));
    setFlows((old) =>
      old.map((item) =>
        item.id === flow.id ? { ...item, runs: [...item.runs, run] } : item,
      ),
    );
    void generate({ ...flow, runs: [...flow.runs, run] }, run, "build");
  }

  function chooseModel(flowId: string, model: string) {
    if (!isMimicModel(model)) return;
    patchFlow(flowId, { model });
    setDefaultModel(model);
    try {
      localStorage.setItem("block-supply-mimic-model", model);
    } catch {
      /* storage can be blocked */
    }
  }

  /** Remove whole rows (image node) or single blocks (block node). */
  function removeNodes(ids: string[]) {
    const gone = new Set(ids);
    // The picture and its shrunk copy stay in memory so that undo can bring the row back whole.
    setFlows((old) =>
      old.flatMap((flow) =>
        gone.has(`img-${flow.id}`)
          ? []
          : [
              {
                ...flow,
                runs: flow.runs.filter((run) => !gone.has(`out-${run.id}`)),
              },
            ],
      ),
    );
    setSelected([]);
  }

  function nudge(ids: string[], dx: number, dy: number) {
    setPos((old) => {
      const out = { ...old };
      for (const id of ids) {
        if (out[id]) out[id] = { x: out[id].x + dx, y: out[id].y + dy };
      }
      return out;
    });
  }

  /** Put every row back in its default place, stacked from the top, and frame them. */
  function tidy() {
    let top = 0;
    let next: Record<string, Point> = {};
    for (const flow of flows) {
      next = { ...next, ...placeFlow(flow, { x: 0, y: top }) };
      top += Math.max(1, flow.runs.length) * ROW;
    }
    refit.current = true;
    setPos(next);
  }

  api.current = {
    zoomBy,
    zoomTo,
    focus: (ids, mode) => focus(ids, mode),
    remove: removeNodes,
    nudge,
    history: stepHistory,
  };

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    // The row lands where the file was dropped.
    const rect = event.currentTarget.getBoundingClientRect();
    const v = view.current;
    const at = {
      x: (event.clientX - rect.left - v.x) / v.z - IMG_W / 2,
      y: (event.clientY - rect.top - v.y) / v.z - 80,
    };
    addFlow(event.dataTransfer.files[0], at);
  }

  const left =
    status && !status.pass ? Math.max(0, status.limit - status.used) : null;
  const ready = signedIn && status?.configured !== false;
  const open =
    flows.flatMap((flow) => flow.runs).find((run) => run.result?.id === openId)
      ?.result ?? null;
  const at = (id: string) => ({ left: pos[id]?.x ?? 0, top: pos[id]?.y ?? 0 });

  return (
    <section className="mimic-tool">
      <div
        ref={viewport}
        className="mimic-viewport"
        data-over={over ? "true" : "false"}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setOver(false);
        }}
        onDrop={onDrop}
      >
        <div ref={world} className="mimic-world">
          <svg className="mimic-edges" width="1" height="1" aria-hidden="true">
            {edges.map((edge) => (
              <g key={edge.key}>
                <path d={edge.d} />
                <circle cx={edge.x1} cy={edge.y1} r="4.5" />
                <circle cx={edge.x2} cy={edge.y2} r="4.5" />
              </g>
            ))}
          </svg>

          {flows.map((flow) => {
            const model = flow.model ?? defaultModel;
            const free = providerOf(model) === "openrouter";
            const busyFlow = flow.runs.some((run) => run.working);
            const out = left === 0 && !free;
            const noShot = !prepared.current.has(flow.id);
            const showTools = selected.includes(`img-${flow.id}`) || busyFlow;
            const canBuild =
              ready &&
              !busyFlow &&
              !out &&
              !noShot &&
              flow.runs.length < MAX_RUNS;
            // Why Clone is off, said out loud under the toolbar instead of only in a tooltip.
            const buildTitle =
              flow.runs.length >= MAX_RUNS
                ? `You can keep ${MAX_RUNS} versions. Remove one to clone again.`
                : noShot
                  ? "The screenshot was not kept. Press Replace and add it again."
                  : out
                    ? "No Claude runs left today. Pick a free model to keep going."
                    : undefined;
            return (
              <Fragment key={flow.id}>
                <div
                  className="mimic-item mimic-source"
                  data-selected={
                    selected.includes(`img-${flow.id}`) ? "true" : "false"
                  }
                  ref={reg(`img-${flow.id}`)}
                  style={{ ...at(`img-${flow.id}`), width: IMG_W }}
                  onPointerDown={(event) => startDrag(event, `img-${flow.id}`)}
                >
                  <p className="mimic-label">
                    <ImageIcon /> Image
                  </p>
                  <div className="mimic-pic">
                    {flow.picture ? (
                      <img
                        src={flow.picture}
                        alt="The screenshot you added"
                        draggable={false}
                      />
                    ) : (
                      <span className="mimic-nopic">Screenshot not kept</span>
                    )}
                    {flow.dims ? (
                      <span className="mimic-badge">{flow.dims}</span>
                    ) : null}
                    {showTools ? (
                      <button
                        type="button"
                        className="mimic-trash"
                        aria-label="Remove image"
                        title="Remove"
                        onClick={() => removeNodes([`img-${flow.id}`])}
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                    {showTools ? (
                      <button
                        type="button"
                        className="mimic-replace"
                        onClick={() => {
                          replaceTarget.current = flow.id;
                          replaceInput.current?.click();
                        }}
                      >
                        <ReplaceIcon /> Replace
                      </button>
                    ) : null}
                  </div>
                  {flow.photo ? (
                    <p className="mimic-warn" role="status">
                      This looks like a photo, not a screenshot of one
                      component. Mimic may not find anything to rebuild.
                    </p>
                  ) : null}
                  {showTools ? (
                    <>
                      <div
                        className="mimic-float mimic-toolbar"
                        role="toolbar"
                        aria-label="Image actions"
                      >
                        {signedIn ? (
                          <button
                            type="button"
                            className="mimic-run"
                            data-busy={busyFlow ? "true" : "false"}
                            disabled={!canBuild}
                            title={buildTitle}
                            onClick={() => build(flow)}
                          >
                            <PlayIcon />
                            {busyFlow
                              ? "Cloning…"
                              : flow.runs.length
                                ? "Clone again"
                                : flow.photo
                                  ? "Clone anyway"
                                  : "Clone"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mimic-run"
                            onClick={onLogin}
                          >
                            Log in to use Mimic
                          </button>
                        )}
                        <ModelMenu
                          value={model}
                          onChange={(id) => chooseModel(flow.id, id)}
                          unavailable={(item) =>
                            Boolean(status) &&
                            !status?.mock &&
                            status?.providers?.[item.provider] === false
                          }
                        />
                      </div>
                      <form
                        className="mimic-float mimic-prompt"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!flow.hint.trim()) return;
                          if (!signedIn) onLogin();
                          else if (canBuild) build(flow);
                        }}
                      >
                        <PromptField
                          value={flow.hint}
                          onChange={(hint) => patchFlow(flow.id, { hint })}
                        />
                        <button
                          type="submit"
                          aria-label="Clone with these notes"
                          disabled={
                            !flow.hint.trim() || (signedIn && !canBuild)
                          }
                          title={
                            flow.hint.trim() ? buildTitle : "Type a note first"
                          }
                        >
                          <SendIcon />
                        </button>
                      </form>
                      {signedIn && !busyFlow && !canBuild && buildTitle ? (
                        <p className="mimic-why" role="status">
                          {buildTitle}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {flow.runs.map((run) => {
                  const result = run.result;
                  const cantRun = run.working || !ready || out;
                  return (
                    <div
                      key={run.id}
                      className="mimic-item mimic-out"
                      data-selected={
                        selected.includes(`out-${run.id}`) ? "true" : "false"
                      }
                      data-working={run.working ? "true" : "false"}
                      ref={reg(`out-${run.id}`)}
                      style={{
                        ...at(`out-${run.id}`),
                        width: result ? blockWidth(result.html) : 320,
                      }}
                      onPointerDown={(event) =>
                        startDrag(event, `out-${run.id}`)
                      }
                    >
                      {result ? (
                        <>
                          <article
                            id={`block-${result.id}`}
                            className="card"
                            style={{ ["--h" as string]: "240px" }}
                            onClick={() => {
                              if (!dragged.current) setOpenId(result.id);
                            }}
                          >
                            <div className="stage">
                              <Preview id={result.id} />
                            </div>
                            <span className="cname">{result.name}</span>
                            <button
                              type="button"
                              className="mimic-x"
                              aria-label={`Remove ${result.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                removeNodes([`out-${run.id}`]);
                              }}
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              className="copy"
                              data-on={copied === result.id ? "true" : "false"}
                              aria-label={`Copy ${result.name} to Figma`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onCopy(
                                  asBlock(result),
                                  kitIn(event.currentTarget.closest("article")),
                                );
                              }}
                            >
                              <FigmaMark />
                              {busy === result.id
                                ? "Copying"
                                : copied === result.id
                                  ? "Copied"
                                  : "Copy"}
                            </button>
                          </article>
                          <div className="mimic-node mimic-edit">
                            {result.model ? (
                              <p className="mimic-by">
                                Made with{" "}
                                {MIMIC_MODELS.find(
                                  (item) => item.id === result.model,
                                )?.label ?? result.model}
                                {providerOf(result.model) === "openrouter"
                                  ? " · Free"
                                  : ""}
                              </p>
                            ) : null}
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (run.instruction?.trim() && !cantRun)
                                  void generate(flow, run, "edit");
                              }}
                            >
                              <input
                                className="mimic-hint"
                                value={run.instruction ?? ""}
                                maxLength={300}
                                placeholder="Ask for a change, e.g. make the button blue"
                                aria-label="Ask for a change"
                                disabled={!signedIn}
                                onChange={(event) =>
                                  patchRun(flow.id, run.id, {
                                    instruction: event.target.value,
                                  })
                                }
                              />
                              <button
                                type="submit"
                                className="mimic-apply"
                                disabled={cantRun || !run.instruction?.trim()}
                              >
                                {run.refining && run.working
                                  ? "Working…"
                                  : "Apply"}
                              </button>
                            </form>
                            <div className="mimic-actions">
                              <button
                                type="button"
                                className="mimic-link"
                                onClick={() => setOpenId(result.id)}
                              >
                                Tune in editor
                              </button>
                              <button
                                type="button"
                                className="mimic-link"
                                disabled={!signedIn || cantRun || noShot}
                                title="Compare this block with the screenshot and fix the differences"
                                onClick={() =>
                                  void generate(flow, run, "refine")
                                }
                              >
                                Refine to match
                              </button>
                              <CodeMenu
                                source={result.html}
                                name={result.name}
                                variant="pill"
                                onNotify={onNotify}
                              />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div
                          className="mimic-node mimic-empty"
                          data-working={run.working ? "true" : "false"}
                        >
                          {run.working ? (
                            <Working
                              onCancel={() => removeNodes([`out-${run.id}`])}
                            />
                          ) : (
                            <>
                              <span>
                                {run.error ?? "Your block appears here"}
                              </span>
                              <button
                                type="button"
                                className="mimic-link"
                                onClick={() => removeNodes([`out-${run.id}`])}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
        </div>
        {marquee ? (
          <div
            className="mimic-marquee"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        ) : null}
      </div>

      {flows.length === 0 ? (
        <div className="mimic-blank">
          <h1 className="mimic-title">Mimic</h1>
          <p className="mimic-sub">
            Add a screenshot of one component. Mimic rebuilds it as an editable
            block you can tune and paste into Figma as auto layout.
          </p>
          <p className="mimic-tip">
            Drag the background or scroll to move. Pinch, or hold ⌘ and scroll,
            to zoom. Shift-drag to select.
          </p>
          <Example />
        </div>
      ) : null}

      <div className="mimic-hud">
        <div className="mimic-bar">
          {signedIn && status && status.configured !== false && !status.pass ? (
            <div className="mimic-quota" aria-live="polite">
              <div className="mimic-quota-row">
                <span>Claude runs</span>
                <span>
                  {left === 0
                    ? status.resetsAt
                      ? `Resets at ${new Date(status.resetsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                      : "None left today"
                    : `${left} of ${status.limit} left`}
                </span>
              </div>
              <div
                className="mimic-quota-track"
                role="progressbar"
                aria-label="Claude runs used today"
                aria-valuemin={0}
                aria-valuemax={status.limit}
                aria-valuenow={Math.min(status.used, status.limit)}
              >
                <i
                  style={{
                    width: `${Math.min(100, (status.used / Math.max(1, status.limit)) * 100)}%`,
                  }}
                />
              </div>
              {status.providers?.openrouter ? (
                <div className="mimic-quota-row mimic-quota-free">
                  <span>Free models</span>
                  <span>No daily limit</span>
                </div>
              ) : null}
              {status.mock ? (
                <div className="mimic-quota-row mimic-quota-free">
                  <span>Mock mode</span>
                  <span>No model is called</span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mimic-meta mimic-status" aria-live="polite">
              {!signedIn
                ? "Free with an account."
                : status?.configured === false
                  ? "Mimic is not set up on this server: add ANTHROPIC_API_KEY."
                  : status?.pass
                    ? `Free pass: no daily limit${status.mock ? " · mock mode, no model is called" : ""}`
                    : ""}
            </p>
          )}
        </div>
        {error ? (
          <p className="mimic-error mimic-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div
        className="mimic-tools"
        role="toolbar"
        aria-label="Canvas tools"
        data-over={over ? "true" : "false"}
      >
        <button
          type="button"
          data-tip="Add a screenshot · or drop / paste ⌘ V"
          aria-label="Add a screenshot"
          onClick={() => input.current?.click()}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 4v12M4 10h12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            addFlow(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <input
          ref={replaceInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            if (replaceTarget.current)
              replaceShot(replaceTarget.current, event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <i aria-hidden="true" />
        <button
          type="button"
          data-tip="Fit everything"
          aria-label="Fit everything"
          disabled={flows.length === 0}
          onClick={() => focus(nodeIds(flows), "fit")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3.5 7V4.5a1 1 0 0 1 1-1H7M13 3.5h2.5a1 1 0 0 1 1 1V7M16.5 13v2.5a1 1 0 0 1-1 1H13M7 16.5H4.5a1 1 0 0 1-1-1V13"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x="7"
              y="7.5"
              width="6"
              height="5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
        <button
          type="button"
          data-tip="Tidy: put every row back in place"
          aria-label="Tidy"
          disabled={flows.length === 0}
          onClick={tidy}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3.5"
              y="3.5"
              width="5.5"
              height="5.5"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <rect
              x="11"
              y="3.5"
              width="5.5"
              height="5.5"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <rect
              x="3.5"
              y="11"
              width="5.5"
              height="5.5"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <rect
              x="11"
              y="11"
              width="5.5"
              height="5.5"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </div>

      <div className="mimic-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.25)}
        >
          −
        </button>
        <span aria-live="off">{zoom}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
      </div>

      {open ? (
        <Editor
          key={open.id}
          block={asBlock(open)}
          saved={false}
          busy={busy === open.id}
          copied={copied === open.id}
          onClose={() => setOpenId(null)}
          onSave={() => {}}
          onCopy={(kit) => onCopy(asBlock(open), kit)}
          onShare={() => {}}
        />
      ) : null}
    </section>
  );
}
