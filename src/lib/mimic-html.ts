/**
 * The model's HTML is rebuilt element by element from an allow-list before it is drawn, so nothing it
 * writes can run code, load anything or reach outside its own box.
 */
import { linePercent } from "@/lib/mimic-type";

const HTML_TAGS = new Set([
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "b",
  "strong",
  "i",
  "em",
  "small",
  "label",
  "ul",
  "ol",
  "li",
]);
const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);
const SVG_NS = "http://www.w3.org/2000/svg";

const ATTRS = new Set([
  "style",
  "data-layer",
  "viewBox",
  "width",
  "height",
  "d",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "transform",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "opacity",
]);

const BAD_VALUE =
  /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding|\\/i;
const BAD_PROPS = new Set([
  "position",
  "float",
  "z-index",
  "pointer-events",
  "content",
  "transform",
  "inset",
  "top",
  "left",
  "right",
  "bottom",
  "animation",
  "transition",
]);
const MAX_NODES = 1500;

/** Keep only declarations that cannot load or place anything outside the block. */
function cleanStyle(style: string) {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (
      !/^[a-z-]+$/.test(prop) ||
      BAD_PROPS.has(prop) ||
      prop.startsWith("-") ||
      BAD_VALUE.test(value)
    )
      continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

function rebuild(source: Element, count: { n: number }): Element | null {
  const name = source.localName;
  const svg = source.namespaceURI === SVG_NS;
  if (!(svg ? SVG_TAGS.has(name) : HTML_TAGS.has(name))) return null;
  if (++count.n > MAX_NODES) return null;
  const out = svg
    ? document.createElementNS(SVG_NS, name)
    : document.createElement(name);
  for (const attr of Array.from(source.attributes)) {
    if (!ATTRS.has(attr.name)) continue;
    const value =
      attr.name === "style"
        ? cleanStyle(attr.value)
        : attr.value.slice(0, 2000);
    if (attr.name !== "style" && BAD_VALUE.test(value)) continue;
    if (value) out.setAttribute(attr.name, value);
  }
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE)
      out.appendChild(document.createTextNode(child.textContent ?? ""));
    else if (child instanceof Element) {
      const clean = rebuild(child, count);
      if (clean) out.appendChild(clean);
    }
  }
  return out;
}

/**
 * Make the block grow with its content instead of clipping or overlapping it. A fixed height on a card
 * (or `overflow`) lets text that comes out a little taller in Figma run over what is below, so heights
 * become minimums, overflow and max-height go, and every box may shrink below its text so it wraps.
 */
function loosen(root: Element) {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    if (!(el instanceof HTMLElement)) continue;
    const style = el.style;
    const height = style.getPropertyValue("height");
    if (
      height &&
      !height.includes("%") &&
      !style.getPropertyValue("min-height")
    ) {
      style.setProperty("min-height", height);
    }
    if (height && !height.includes("%")) style.removeProperty("height");
    style.removeProperty("max-height");
    style.removeProperty("text-overflow");
    if (el !== root) {
      style.removeProperty("overflow");
      style.removeProperty("overflow-x");
      style.removeProperty("overflow-y");
    }
    style.setProperty("box-sizing", "border-box");
    if (el.localName !== "svg" && !style.getPropertyValue("min-width"))
      style.setProperty("min-width", "0");
  }
}

/** Text keeps its size; its line height becomes a percentage of that size, tighter for bigger text, at least 80%. */
function lineHeights(root: Element) {
  const sizeOf = (el: Element): number => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const value = node instanceof HTMLElement ? node.style.getPropertyValue("font-size") : "";
      if (value.endsWith("px") && parseFloat(value) > 0) return parseFloat(value);
    }
    return 16;
  };
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (!(el instanceof HTMLElement)) continue;
    const line = el.style.getPropertyValue("line-height");
    const hasText = Array.from(el.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    if (!line && !hasText) continue;
    if (!line && !el.style.getPropertyValue("font-size")) continue;
    el.style.setProperty("line-height", `${linePercent(sizeOf(el), line || null)}%`);
  }
}

/** Clean HTML for one block, always a single `div.kit` root; null when nothing usable is left. */
export function sanitizeBlockHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(
    `<body>${html}</body>`,
    "text/html",
  );
  const count = { n: 0 };
  const parts = Array.from(doc.body.children)
    .map((element) => rebuild(element, count))
    .filter((element): element is Element => element !== null);
  if (!parts.length) return null;
  let root: Element;
  if (parts.length === 1 && parts[0]?.localName === "div") root = parts[0];
  else {
    root = document.createElement("div");
    root.setAttribute(
      "style",
      "display: flex; flex-direction: column; gap: 8px",
    );
    for (const part of parts) root.appendChild(part);
  }
  root.setAttribute("class", "kit");
  loosen(root);
  lineHeights(root);
  // A component with no fill at all would paste into Figma as a see-through frame; give it a white one.
  if (root instanceof HTMLElement) {
    const fill = `${root.style.getPropertyValue("background")} ${root.style.getPropertyValue("background-color")}`;
    if (
      !/#|rgb|hsl|gradient|[a-z]{4,}/i.test(
        fill.replace(/transparent|none|initial|inherit|(rgba|hsla)\([^)]*(,|\/)\s*0(\.0+)?%?\s*\)/gi, ""),
      )
    )
      root.style.setProperty("background-color", "#ffffff");
  }
  // The root keeps its drawn width; the card scales it down to fit instead of squeezing its text.
  const style = (root.getAttribute("style") ?? "").trim().replace(/;$/, "");
  root.setAttribute("style", `${style}${style ? "; " : ""}flex-shrink: 0`);
  return root.outerHTML;
}
