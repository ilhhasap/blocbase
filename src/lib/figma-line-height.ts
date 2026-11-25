import { compileSchema, decodeBinarySchema } from "@/lib/kiwi/shim";
import { lowerLineHeights } from "@/lib/line-height-percent";

/**
 * The Figma converter writes every text layer's line height in pixels. Designers expect a percentage of the font
 * size (150% rather than 21px for 14px text), and a percentage follows the text when its size is changed. This
 * opens the clipboard payload the converter produced, turns each text layer's line height into a percent of its
 * font size, and closes it again. On any failure the payload is returned as it was.
 */

const PAYLOAD = /data-buffer="<!--\(figma\)([\s\S]*?)\(\/figma\)-->"/;

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

async function run(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

export async function percentLineHeights(html: string): Promise<string> {
  try {
    const found = PAYLOAD.exec(html);
    if (!found) return html;
    const bytes = fromBase64(found[1]!);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // "fig-kiwi", a version, then length-prefixed chunks: the schema first, the scene second.
    const chunks: Uint8Array[] = [];
    for (let at = 12; at < bytes.length; ) {
      const length = view.getUint32(at, true);
      chunks.push(bytes.slice(at + 4, at + 4 + length));
      at += 4 + length;
    }
    if (chunks.length < 2) return html;
    const schema = decodeBinarySchema(await run(chunks[0]!, new DecompressionStream("deflate-raw")));
    const codec = compileSchema(schema) as unknown as {
      decodeMessage(bytes: Uint8Array): Parameters<typeof lowerLineHeights>[0];
      encodeMessage(message: unknown): Uint8Array;
    };
    const message = codec.decodeMessage(await run(chunks[1]!, new DecompressionStream("deflate-raw")));
    if (!lowerLineHeights(message)) return html;
    chunks[1] = await run(codec.encodeMessage(message), new CompressionStream("deflate-raw"));
    const size = 12 + chunks.reduce((sum, chunk) => sum + 4 + chunk.length, 0);
    const out = new Uint8Array(size);
    out.set(bytes.subarray(0, 12), 0);
    const outView = new DataView(out.buffer);
    let at = 12;
    for (const chunk of chunks) {
      outView.setUint32(at, chunk.length, true);
      out.set(chunk, at + 4);
      at += 4 + chunk.length;
    }
    return html.replace(PAYLOAD, () => `data-buffer="<!--(figma)${toBase64(out)}(/figma)-->"`);
  } catch {
    return html;
  }
}
