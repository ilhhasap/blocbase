/**
 * Facts read from a screenshot with plain code, handed to the model next to the picture: the colours that
 * are really in it. The model decides the layout; it no longer has to guess a hex value.
 * (OCR was tried too: the model already reads the text right, and it cost seconds and a download.)
 */

export type Swatch = { hex: string; share: number };

type Pixels = { data: ArrayLike<number>; width: number; height: number };

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;

/**
 * The main colours of an image, most common first. Pixels are grouped in steps of 8 per channel and each group
 * is reported as its average, so antialiasing noise folds into the colour it belongs to.
 */
export function dominantColors(
  image: Pixels,
  count = 8,
  minShare = 0.004,
): Swatch[] {
  const step = Math.max(1, Math.floor(Math.max(image.width, image.height) / 400));
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  // Saturated pixels (a checked box, a badge, a button) are also grouped coarsely: their antialiased
  // edges spread them over many fine bins, none of which would show up alone.
  const accents = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const i = (y * image.width + x) * 4;
      if ((image.data[i + 3] ?? 255) < 128) continue;
      const r = image.data[i]!;
      const g = image.data[i + 1]!;
      const b = image.data[i + 2]!;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
      total++;
      const hi = Math.max(r, g, b);
      if (hi > 90 && (hi - Math.min(r, g, b)) / hi > 0.5) {
        const wide = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        const accent = accents.get(wide) ?? { n: 0, r: 0, g: 0, b: 0 };
        accent.n++;
        accent.r += r;
        accent.g += g;
        accent.b += b;
        accents.set(wide, accent);
      }
    }
  }
  const out: Swatch[] = [];
  // Big areas first, then the small saturated ones that carry the accent colour.
  const order = [
    ...[...bins.values()]
      .sort((a, b) => b.n - a.n)
      .filter((bin) => bin.n / total >= minShare),
    ...[...accents.values()]
      .sort((a, b) => b.n - a.n)
      .filter((bin) => bin.n / total >= 0.0002)
      .slice(0, 3),
  ];
  for (const bin of order) {
    if (out.length >= count) break;
    const color = hex(
      Math.round(bin.r / bin.n),
      Math.round(bin.g / bin.n),
      Math.round(bin.b / bin.n),
    );
    // A shade within a few steps of one already listed is the same colour for a designer.
    const near = out.some((swatch) => distance(swatch.hex, color) < 10);
    if (near) {
      const kept = out.find((swatch) => distance(swatch.hex, color) < 10)!;
      kept.share += bin.n / total;
    } else out.push({ hex: color, share: bin.n / total });
  }
  return out;
}

function distance(a: string, b: string) {
  const parse = (value: string) =>
    [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.hypot(r1! - r2!, g1! - g2!, b1! - b2!);
}

/** The facts as a block of text for the prompt; empty when there are none. */
export function describeFacts(colors: Swatch[]): string {
  if (!colors.length) return "";
  return `Colours measured in the image (hex, share of the area): ${colors
    .map((swatch) => `${swatch.hex} ${swatch.share >= 0.01 ? Math.round(swatch.share * 100) : "<1"}%`)
    .join(", ")}. Use exactly these values for backgrounds, text, borders and accents.`;
}
