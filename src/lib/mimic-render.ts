/**
 * Draws a generated block to a PNG in the browser, so a second pass can compare it with the screenshot.
 * The HTML goes into an SVG foreignObject with Geist embedded, so text wraps as it does on the page.
 */

let fonts: Promise<string> | null = null;

const skipFace = /(latin-ext|cyrillic|vietnamese|greek)/;

function toBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function faceRules(
  list: CSSRuleList,
  base: string,
  out: Array<Promise<string>>,
) {
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSImportRule && rule.styleSheet) {
      let nested: CSSRuleList | null = null;
      try {
        nested = rule.styleSheet.cssRules;
      } catch {
        /* cross-origin sheet */
      }
      if (nested) await faceRules(nested, rule.styleSheet.href ?? base, out);
    } else if (
      rule instanceof CSSFontFaceRule &&
      /geist/i.test(rule.style.getPropertyValue("font-family"))
    ) {
      const found = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(
        rule.style.getPropertyValue("src"),
      );
      if (!found || skipFace.test(found[1])) continue;
      const weight = rule.style.getPropertyValue("font-weight") || "400";
      const url = new URL(found[1], base).href;
      out.push(
        fetch(url)
          .then((response) => response.arrayBuffer())
          .then(
            (buffer) =>
              `@font-face{font-family:Geist;font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${toBase64(buffer)}) format("woff2")}`,
          )
          .catch(() => ""),
      );
    }
  }
}

function geistCss() {
  fonts ??= (async () => {
    const out: Array<Promise<string>> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      await faceRules(list, sheet.href ?? location.href, out);
    }
    return (await Promise.all(out)).join("");
  })();
  return fonts;
}

/** PNG (base64, no prefix) of the block at its real size, or throws when the browser will not draw it. */
export async function renderBlockPng(
  html: string,
  width: number,
  height: number,
): Promise<string> {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const root = holder.firstElementChild;
  if (!root) throw new Error("Nothing to draw.");
  const xml = new XMLSerializer().serializeToString(root);
  const css = await geistCss();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;width:${w}px;height:${h}px;font-family:Geist,sans-serif;background:#f4f4f3"><style>${css}</style>${xml}</div>` +
    `</foreignObject></svg>`;
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The block could not be drawn."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const scale = Math.min(2, 1400 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the block.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/png");
  return url.slice(url.indexOf(",") + 1);
}
