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

function draw(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const size = 12;
  context.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  context.textBaseline = "top";
  const charWidth = context.measureText("0").width || 7.2;
  const lineHeight = 21;
  const random = seeded(7);
  // Where the heading is: kept clear.
  const heart = Math.min(height * 0.55, 400);
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
      const fade = smooth(0.5, 1.0, Math.hypot(nx * 1.1, ny)) * (0.5 + 0.5 * smooth(30, 110, y));
      const strength = random();
      // Most words are faint; a few stand out.
      const alpha = fade * (0.05 + 0.15 * strength * strength + (strength > 0.94 ? 0.16 : 0));
      if (alpha > 0.015) {
        context.fillStyle = `rgba(23, 24, 26, ${alpha.toFixed(3)})`;
        context.fillText(word, x, y);
      }
      x += (word.length + 2 + Math.floor(random() * 4)) * charWidth;
    }
  }
}

export function HeroField() {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = box.current;
    const target = canvas.current;
    if (!element || !target) return;
    let last = 0;
    const paint = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height || width === last) return;
      last = width;
      draw(target, width, height);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="hero-field" ref={box} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
