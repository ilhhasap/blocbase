import { useEffect, useRef } from "react";

/**
 * The background of the library hero: a field of tiny monospace text made of the words of auto layout
 * (row, col, gap 12, pad 16, hug, fill, w 320...), dense at the edges and clear in the middle where the heading
 * sits. Drawn once to a canvas (and again when the width changes); nothing moves.
 */
const WORDS = [
  "row", "col", "gap", "pad", "hug", "fill", "fixed", "wrap", "start", "center", "end", "between",
  "w", "h", "r", "x", "y", "min", "max", "auto", "clip", "stretch", "space", "align", "frame", "block",
];
const NUMBERS = ["0", "2", "4", "6", "8", "10", "12", "16", "20", "24", "32", "40", "48", "64", "120", "240", "320", "999"];
const MARKS = ["{", "}", "[", "]", "/", "—", "·", "+", "=", ">", "#"];

/** A small repeatable random source, so the field looks the same on every load and every resize. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

type Glyph = { text: string; x: number; y: number; alpha: number; open: number };

const FONT = `12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;

/** Every word of the field with where it sits and how bright it is. Deterministic, so a resize keeps the same picture. */
function layout(context: CanvasRenderingContext2D, width: number, height: number): Glyph[] {
  context.font = FONT;
  const charWidth = context.measureText("0").width || 7.2;
  const lineHeight = 21;
  const random = seeded(7);
  // Where the heading is: kept clear.
  const heart = Math.min(height * 0.55, 400);
  const glyphs: Glyph[] = [];
  for (let y = 4; y < height; y += lineHeight) {
    let x = Math.floor(random() * 3) * charWidth;
    while (x < width) {
      const roll = random();
      const word =
        roll < 0.34
          ? WORDS[Math.floor(random() * WORDS.length)]!
          : roll < 0.84
            ? NUMBERS[Math.floor(random() * NUMBERS.length)]!
            : MARKS[Math.floor(random() * MARKS.length)]!;
      const middle = x + (word.length * charWidth) / 2;
      const nx = (middle - width / 2) / (width / 2);
      const ny = (y - heart) / (heart * 0.9);
      const open = smooth(0.5, 1.0, Math.hypot(nx * 1.1, ny));
      const fade = open * (0.5 + 0.5 * smooth(30, 110, y));
      const strength = random();
      // Most words are faint; a few stand out.
      const alpha = fade * (0.05 + 0.15 * strength * strength + (strength > 0.94 ? 0.16 : 0));
      glyphs.push({ text: word, x, y, alpha, open });
      x += (word.length + 2 + Math.floor(random() * 4)) * charWidth;
    }
  }
  return glyphs;
}

function setup(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = FONT;
  context.textBaseline = "top";
  return context;
}

/** How far a pointer lights the words around it, and for how long the light lingers. */
const REACH = 140;
const LINGER = 420;
const TRAIL = 1000;

export function HeroField() {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = box.current;
    const baseCanvas = base.current;
    const glowCanvas = glow.current;
    if (!element || !baseCanvas || !glowCanvas) return;
    let glyphs: Glyph[] = [];
    let size = { width: 0, height: 0 };
    let last = 0;
    let frame = 0;
    const points: Array<{ x: number; y: number; at: number }> = [];

    const paint = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height || width === last) return;
      last = width;
      size = { width, height };
      const context = setup(baseCanvas, width, height);
      setup(glowCanvas, width, height);
      if (!context) return;
      glyphs = layout(context, width, height);
      for (const glyph of glyphs) {
        if (glyph.alpha <= 0.015) continue;
        context.fillStyle = `rgba(23, 24, 26, ${glyph.alpha.toFixed(3)})`;
        context.fillText(glyph.text, glyph.x, glyph.y);
      }
    };

    // The words near the pointer, and near where it just was, light up and then fade back.
    const light = () => {
      frame = 0;
      const now = performance.now();
      while (points.length && now - points[0]!.at > TRAIL) points.shift();
      const context = glowCanvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, size.width, size.height);
      if (!points.length) return;
      context.font = FONT;
      context.textBaseline = "top";
      for (const glyph of glyphs) {
        let boost = 0;
        for (const point of points) {
          const dx = glyph.x + 12 - point.x;
          const dy = glyph.y + 8 - point.y;
          if (Math.abs(dx) > REACH || Math.abs(dy) > REACH) continue;
          const distance = Math.hypot(dx, dy);
          if (distance >= REACH) continue;
          const near = 1 - distance / REACH;
          boost = Math.max(boost, near * near * Math.exp(-(now - point.at) / LINGER));
        }
        if (boost < 0.03) continue;
        // Behind the heading the light is dimmer, so the heading stays easy to read.
        const alpha = boost * (0.12 + 0.4 * glyph.open) + glyph.alpha * boost;
        context.fillStyle = `rgba(23, 24, 26, ${Math.min(0.6, alpha).toFixed(3)})`;
        context.fillText(glyph.text, glyph.x, glyph.y);
      }
      frame = requestAnimationFrame(light);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < -REACH || y < -REACH || x > rect.width + REACH || y > rect.height + REACH) return;
      const previous = points[points.length - 1];
      if (previous && Math.hypot(previous.x - x, previous.y - y) < 8) {
        previous.at = performance.now();
      } else {
        points.push({ x, y, at: performance.now() });
        if (points.length > 28) points.shift();
      }
      if (!frame) frame = requestAnimationFrame(light);
    };

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm) window.addEventListener("pointermove", move, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="hero-field" ref={box} aria-hidden="true">
      <canvas ref={base} />
      <canvas ref={glow} />
    </div>
  );
}
