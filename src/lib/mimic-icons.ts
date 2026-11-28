/**
 * Real icons and logos for Remake. The model only names a Lucide icon (`<svg data-icon="search" ...>`) or a
 * brand (`<svg data-logo="openai" ...>`), and the real drawing is put in here before the HTML is cleaned,
 * so they are exact instead of guessed.
 * Plain string work, so the browser, the tests and the eval script share it.
 */

export type IconNode = Array<[string, Record<string, string | number>]>;
export type IconLoader = (name: string) => Promise<IconNode | null>;
export type Logo = { viewBox: string; body: string; color: string; colored?: string; coloredViewBox?: string };
export type LogoLoader = (name: string) => Promise<Logo | null>;

const NAMED_SVG = /<svg\b([^>]*?\sdata-(icon|logo)\s*=\s*"([^"]*)"[^>]*?)(?:\/>|>([\s\S]*?)<\/svg>)/gi;
const SHAPES = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);

const attr = (attrs: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1];

const safe = (value: string) => value.replace(/[<>"&]/g, "");

const number = (value: string | undefined, fallback: number, max: number) => {
  const parsed = parseFloat(value ?? "");
  return parsed > 0 ? Math.min(parsed, max) : fallback;
};

/** Drawn when the name is not a Lucide icon, so the spot never disappears without a trace. */
const UNKNOWN: IconNode = [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 4 }]];

function draw(attrs: string, name: string, nodes: IconNode) {
  const size = number(attr(attrs, "width"), 16, 400);
  const height = number(attr(attrs, "height"), size, 400);
  const color = safe(attr(attrs, "color") ?? attr(attrs, "stroke") ?? "#17181a");
  const stroke = number(attr(attrs, "stroke-width"), 2, 4);
  const style = attr(attrs, "style");
  const shapes = nodes
    .filter(([tag]) => SHAPES.has(tag))
    .map(([tag, props]) => {
      const list = Object.entries(props)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${safe(String(value))}"`)
        .join(" ");
      // Some Lucide shapes are solid dots; they say so with their own fill.
      return `<${tag} ${list.replace('fill="currentColor"', `fill="${color}"`)}></${tag}>`;
    })
    .join("");
  return (
    `<svg data-layer="Icon ${safe(name)}" viewBox="0 0 24 24" width="${size}" height="${height}"` +
    ` fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"` +
    `${style ? ` style="${style}"` : ""}>${shapes}</svg>`
  );
}

/** A brand's mark. Without a colour it wears the brand's own colours; with one it is drawn in that colour. */
function drawLogo(attrs: string, name: string, logo: Logo) {
  const size = number(attr(attrs, "width"), 20, 400);
  const height = number(attr(attrs, "height"), size, 400);
  const asked = attr(attrs, "color");
  const style = attr(attrs, "style");
  const color = safe(asked ?? logo.color);
  const own = !asked && logo.colored;
  // Each shape carries its fill, so nothing depends on inheriting it on the way into Figma.
  const body = (own ? logo.colored! : logo.body)
    .replaceAll("currentColor", color)
    .replace(/<(path|circle|ellipse|rect|polygon)(?![^>]*\sfill=)/g, `<$1 fill="${color}"`);
  return (
    `<svg data-layer="Logo ${safe(name)}" viewBox="${own ? (logo.coloredViewBox ?? logo.viewBox) : logo.viewBox}"` +
    ` width="${size}" height="${height}"${style ? ` style="${style}"` : ""}>${body}</svg>`
  );
}

/** `html` with every `data-icon` and `data-logo` svg replaced by the real drawing. */
export async function expandIcons(html: string, load: IconLoader, loadLogo?: LogoLoader): Promise<string> {
  const found = [...html.matchAll(NAMED_SVG)];
  if (!found.length) return html;
  let out = "";
  let at = 0;
  for (const match of found) {
    const [whole, attrs = "", kind = "", raw = "", inner = ""] = match;
    const name = raw.trim().toLowerCase().replace(/^lucide[:-]/, "");
    const valid = /^[a-z0-9-]+$/.test(name);
    let piece: string | null = null;
    if (kind.toLowerCase() === "logo") {
      const logo = valid && loadLogo ? await loadLogo(name).catch(() => null) : null;
      if (logo) piece = drawLogo(attrs, name, logo);
    } else {
      const nodes = valid ? await load(name).catch(() => null) : null;
      if (nodes) piece = draw(attrs, name, nodes);
    }
    // An unknown name keeps whatever the model drew inside, if anything.
    piece ??= inner.trim() ? whole : draw(attrs, name, UNKNOWN);
    out += html.slice(at, match.index) + piece;
    at = match.index + whole.length;
  }
  return out + html.slice(at);
}
