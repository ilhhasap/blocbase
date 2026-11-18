/**
 * Line height as a percentage of the font size, the way a type scale works: the bigger the text, the tighter
 * its lines. The model's own measure is kept (it matches the screenshot) but held inside that band, and never
 * below 80%.
 */
export const MIN_LINE_PERCENT = 80;

/** The loosest line height allowed for a font size, in percent. */
export function maxLinePercent(size: number): number {
  if (size <= 14) return 170;
  if (size <= 18) return 155;
  if (size <= 24) return 140;
  if (size <= 32) return 125;
  if (size <= 48) return 110;
  return 100;
}

/**
 * `lineHeight` as the model wrote it ("20px", "1.4", "140%", "normal") for text of `size` px, as a whole percent
 * inside the band. Without a usable value it falls back to the band's own middle.
 */
export function linePercent(size: number, lineHeight: string | null): number {
  const max = maxLinePercent(size);
  let percent: number | null = null;
  const value = lineHeight?.trim().toLowerCase() ?? "";
  const number = parseFloat(value);
  if (Number.isFinite(number) && size > 0) {
    if (value.endsWith("px")) percent = (number / size) * 100;
    else if (value.endsWith("%")) percent = number;
    else if (/^[\d.]+$/.test(value)) percent = number * 100;
  }
  if (percent === null) percent = Math.round((MIN_LINE_PERCENT + max) / 2);
  return Math.round(Math.min(max, Math.max(MIN_LINE_PERCENT, percent)));
}
