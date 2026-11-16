/**
 * Turns the HTML of a Mimic block into code a developer can paste: plain HTML, or a React component.
 * The input is what `sanitizeBlockHtml` produced, so it is small and well formed: a tree of div,
 * span and text tags and a few SVG shapes, all styled inline. No DOM is needed, so it also runs in tests.
 */

type Node = {
  tag: string;
  attrs: [string, string][];
  children: (Node | string)[];
};

const SELF_CLOSING = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);
const VOID = new Set(["input", "img", "br", "hr"]);

const decode = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const TOKEN =
  /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
const ATTR = /([^\s=>/]+)(?:="([^"]*)")?/g;

/** The element tree of a block's HTML, or null when there is no element in it. */
function parse(html: string): Node | null {
  const root: Node = { tag: "#root", attrs: [], children: [] };
  const stack: Node[] = [root];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(html); match; match = TOKEN.exec(html)) {
    const top = stack[stack.length - 1]!;
    if (match[3] !== undefined) {
      const text = decode(match[3]).replace(/\s+/g, " ");
      if (text.trim()) top.children.push(text.trim());
      continue;
    }
    const tag = match[1]!.toLowerCase();
    if (match[0].startsWith("</")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: [string, string][] = [];
    ATTR.lastIndex = 0;
    for (
      let attr = ATTR.exec(match[2] ?? "");
      attr;
      attr = ATTR.exec(match[2] ?? "")
    ) {
      attrs.push([attr[1]!, decode(attr[2] ?? "")]);
    }
    const node: Node = { tag, attrs, children: [] };
    top.children.push(node);
    if (!match[0].endsWith("/>") && !VOID.has(tag)) stack.push(node);
  }
  const first = root.children.find(
    (child): child is Node => typeof child !== "string",
  );
  return first ?? null;
}

/** `rgb(255, 255, 255)` back to `#ffffff`; colours with an alpha stay as they are. */
const hexColors = (value: string) =>
  value.replace(
    /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/g,
    (_, r: string, g: string, b: string) =>
      `#${[r, g, b].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`,
  );

/** Style declarations as [property, value], without what only the canvas needs. */
/** The font-family the outermost element sets, which everything inside inherits. */
function rootFont(tree: Node): string | null {
  const style = tree.attrs.find(([name]) => name === "style")?.[1] ?? "";
  return (
    declarations(style, true, null).find(
      ([prop]) => prop === "font-family",
    )?.[1] ?? null
  );
}

function declarations(
  style: string,
  root: boolean,
  font: string | null,
  width: string | null = null,
  extra: [string, string] | null = null,
): [string, string][] {
  const out: [string, string][] = [];
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (!prop || !value) continue;
    if (prop === "min-width" && /^0(px)?$/.test(value)) continue;
    if (prop === "box-sizing" && value === "border-box") continue;
    if (root && prop === "flex-shrink" && value === "0") continue;
    if ((prop === "gap" || prop === "padding") && /^0(px)?$/.test(value))
      continue;
    if (prop === "flex-direction" && value === "row") continue;
    if (!root && prop === "font-family" && value === font) continue;
    if (prop === "--ax-gap") continue;
    if (root && prop === "width" && value === "100%") {
      // A block that filled its card keeps the size it was shown at, so it does not stretch in a wide page.
      if (width) out.push(["width", width]);
      continue;
    }
    out.push([prop, hexColors(value)]);
  }
  if (extra) out.push(extra);
  return out;
}

/** The width in px the page measured for the block (`data-w` on its outermost element). */
const measuredWidth = (tree: Node) => {
  const value = tree.attrs.find(([name]) => name === "data-w")?.[1];
  return value && /^\d+(\.\d+)?$/.test(value) ? `${value}px` : null;
};

/** Children after the first get a negative margin when the parent overlaps them (a negative gap), since CSS gap cannot. */
function overlap(node: Node): Map<Node | string, [string, string]> {
  const out = new Map<Node | string, [string, string]>();
  const style = node.attrs.find(([name]) => name === "style")?.[1] ?? "";
  const gap = /--ax-gap:\s*(-\d+(?:\.\d+)?)px/.exec(style)?.[1];
  if (!gap) return out;
  const row = !/flex-direction:\s*column/.test(style);
  node.children.slice(1).forEach((child) => out.set(child, [row ? "margin-left" : "margin-top", `${gap}px`]));
  return out;
}

const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The outermost layer keeps its name as a comment-free attribute list; names inside are dropped. */
const SKIP_ATTR = new Set(["class"]);
const skipAttr = (name: string) =>
  SKIP_ATTR.has(name) || name.startsWith("data-");

const NUMERIC_ATTRS = new Set(["tabindex", "maxlength"]);

const JSX_NAMES: Record<string, string> = {
  tabindex: "tabIndex",
  contenteditable: "contentEditable",
  readonly: "readOnly",
  for: "htmlFor",
  maxlength: "maxLength",
};

/** An HTML attribute name as JSX spells it: aria-* stays, the rest is camelCase. */
const jsxAttr = (name: string) =>
  JSX_NAMES[name] ?? (name.startsWith("aria-") ? name : camel(name));

function printHtml(
  node: Node,
  depth: number,
  root: boolean,
  font: string | null,
  width: string | null,
  extra: [string, string] | null = null,
): string[] {
  const pad = "  ".repeat(depth);
  const attrs = node.attrs
    .filter(([name]) => !skipAttr(name))
    .map(([name, value]) => {
      if (name === "style") {
        const css = declarations(value, root, font, width, extra)
          .map(([prop, val]) => `${prop}: ${val}`)
          .join("; ");
        return css ? `style="${escapeAttr(css)}"` : "";
      }
      return `${name}="${escapeAttr(value)}"`;
    })
    .filter(Boolean);
  if (extra && !node.attrs.some(([name]) => name === "style"))
    attrs.push(`style="${extra[0]}: ${extra[1]}"`);
  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (SELF_CLOSING.has(node.tag) && !node.children.length)
    return [`${pad}${open} />`];
  if (!node.children.length) return [`${pad}${open}></${node.tag}>`];
  if (node.children.every((child) => typeof child === "string")) {
    return [
      `${pad}${open}>${escapeText(node.children.join(" "))}</${node.tag}>`,
    ];
  }
  const lines = [`${pad}${open}>`];
  const pull = overlap(node);
  for (const child of node.children) {
    if (typeof child === "string") lines.push(`${pad}  ${escapeText(child)}`);
    else lines.push(...printHtml(child, depth + 1, false, font, null, pull.get(child) ?? null));
  }
  lines.push(`${pad}</${node.tag}>`);
  return lines;
}

/** A style value as a JS literal: plain numbers stay numbers, everything else is a string. */
const jsValue = (value: string) =>
  /^-?\d+(\.\d+)?$/.test(value) ? value : JSON.stringify(value);

const jsxText = (text: string) =>
  text.replace(/[{}<>]/g, (char) => `{${JSON.stringify(char)}}`);

function printJsx(
  node: Node,
  depth: number,
  root: boolean,
  font: string | null,
  width: string | null,
  extra: [string, string] | null = null,
): string[] {
  const pad = "  ".repeat(depth);
  const attrs: string[][] = [];
  for (const [name, value] of node.attrs) {
    if (skipAttr(name)) continue;
    if (name === "style") {
      const decls = declarations(value, root, font, width, extra);
      if (!decls.length) continue;
      if (decls.length <= 2) {
        attrs.push([
          `style={{ ${decls.map(([prop, val]) => `${camel(prop)}: ${jsValue(val)}`).join(", ")} }}`,
        ]);
      } else {
        attrs.push([
          "style={{",
          ...decls.map(([prop, val]) => `  ${camel(prop)}: ${jsValue(val)},`),
          "}}",
        ]);
      }
    } else {
      attrs.push([
        NUMERIC_ATTRS.has(name) && /^-?\d+$/.test(value)
          ? `${jsxAttr(name)}={${value}}`
          : `${jsxAttr(name)}=${JSON.stringify(value)}`,
      ]);
    }
  }
  if (extra && !node.attrs.some(([name]) => name === "style"))
    attrs.push([`style={{ ${camel(extra[0])}: ${jsValue(extra[1])} }}`]);
  const multiline = attrs.some((attr) => attr.length > 1) || attrs.length > 3;
  const hollow = !node.children.length;
  const end = hollow ? "/>" : ">";
  const head: string[] = [];
  if (!attrs.length) head.push(`${pad}<${node.tag}${end}`);
  else if (!multiline)
    head.push(
      `${pad}<${node.tag} ${attrs.map((attr) => attr[0]).join(" ")}${end}`,
    );
  else {
    head.push(`${pad}<${node.tag}`);
    for (const attr of attrs)
      for (const line of attr) head.push(`${pad}  ${line}`);
    head.push(`${pad}${end}`);
  }
  if (hollow) return head;
  if (node.children.every((child) => typeof child === "string") && !multiline) {
    return [`${head[0]}${jsxText(node.children.join(" "))}</${node.tag}>`];
  }
  const lines = [...head];
  const pull = overlap(node);
  for (const child of node.children) {
    if (typeof child === "string") lines.push(`${pad}  ${jsxText(child)}`);
    else lines.push(...printJsx(child, depth + 1, false, font, null, pull.get(child) ?? null));
  }
  lines.push(`${pad}</${node.tag}>`);
  return lines;
}

/** The block as readable HTML with inline styles; null when there is nothing to print. */
export function blockToHtml(html: string): string | null {
  const tree = parse(html);
  if (!tree) return null;
  return (
    [
      "<!-- Uses the Geist font. Assumes * { box-sizing: border-box } -->",
      ...printHtml(tree, 0, true, rootFont(tree), measuredWidth(tree)),
    ].join("\n") + "\n"
  );
}

/** A valid component name from a layer name: "Install Chrome modal" becomes InstallChromeModal. */
export function componentName(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
  return /^[A-Za-z]/.test(joined) ? joined : `Block${joined}`;
}

/** The block as a React component with inline styles; null when there is nothing to print. */
export function blockToReact(html: string, name: string): string | null {
  const tree = parse(html);
  if (!tree) return null;
  const body = printJsx(tree, 2, true, rootFont(tree), measuredWidth(tree));
  return [
    "// Uses the Geist font. Assumes * { box-sizing: border-box } in your CSS",
    `export function ${componentName(name)}() {`,
    "  return (",
    ...body,
    "  );",
    "}",
    "",
  ].join("\n");
}
