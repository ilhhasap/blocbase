/**
 * Gives every side of a border the colour of a side that really has one, in an inline style string.
 * Edited as text on purpose: going through `element.style` would collapse the four longhands into
 * shorthands (`border-width: 0 0 1px`) that the Figma converter reads as no border at all.
 */
export function evenBorderColors(style: string): string {
  const sides = ["top", "right", "bottom", "left"] as const;
  const parts = style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const get = (name: string) => {
    const found = parts.find((part) => part.startsWith(`${name}:`));
    return found?.slice(name.length + 1).trim() ?? "";
  };
  const real = sides.find(
    (side) =>
      parseFloat(get(`border-${side}-width`)) > 0 &&
      get(`border-${side}-style`) !== "none",
  );
  const color = real && get(`border-${real}-color`);
  if (!color) return style;
  return parts
    .map((part) => {
      const side = sides.find((name) => part.startsWith(`border-${name}-color:`));
      return side ? `border-${side}-color: ${color}` : part;
    })
    .join("; ");
}
