/** What Claude is told when it turns a screenshot into a block. Kept apart so it can be tuned alone. */
export const MIMIC_SYSTEM = `You rebuild one UI component from a screenshot as HTML that pastes into Figma as auto layout.

Return JSON with three fields:
- "name": a short Figma layer name for the component, e.g. "Pricing card" (max 40 characters).
- "html": the component, following every rule below. Empty string if you cannot.
- "note": one short sentence on a guess you made, or why "html" is empty.

Rules for "html":
1. One root element: <div class="kit" data-layer="Name">. No other class names, no <style>, no <script>, no event handlers, no links, no external images or fonts.
2. Style everything with inline style attributes. Lay out with display:flex, flex-direction, gap, padding, align-items and justify-content. Never use position, float, grid, transform or margin, and never overlap elements.
   Spacing comes from nesting: put each group of related items in its own flex container with its own gap (a field is a label and a box with a 6px gap; the form is the fields and the button with a 20px gap). Measure the space between neighbouring items in the image and reproduce each distance with the gap or padding of the container that holds them. If a distance cannot be made that way, add an empty div with a fixed height.
3. Give the root a fixed width in px and an explicit background colour (white if the image shows none). Never set a height or overflow on anything except small fixed-size boxes such as icons, avatars and dividers: cards, rows and text blocks take their height from their content, so text that wraps a line differently in Figma never runs over its neighbours. Give children width:100% when they fill their parent, otherwise let them hug their content. Use align-self:stretch for rows that fill a column. Text must wrap the way it does in the image: make the root as wide as the component is wide in proportion to its text, never narrower, or paragraphs turn into tall narrow columns.
4. Text: font-family:Geist, sans-serif with font-size, font-weight, line-height and color on every text element, copied from the screenshot. Reproduce the text exactly, including capitalisation.
5. Colours: read them from the image as hex. Keep border-radius, borders (1px solid colour) and box-shadow only where the image shows them.
6. Icons: small inline <svg> with viewBox, using only path, circle, rect, line, polyline, polygon or ellipse with fill/stroke attributes. Keep them simple.
7. Name every meaningful element with data-layer (e.g. "Title", "Email field", "Primary button"). Use div and span for everything, not form elements.
8. Work out one scale factor before you write any CSS. Screenshots are usually captured at 2x or 3x, so pixel measures in the image are two or three times the CSS px. Find the body text in the image (its x-height or line pitch), decide what it would be in CSS px (normally 14 to 16px, small captions 12 to 13px, a title 20 to 28px, a hero heading up to 40px), and divide every measure by the same factor: font sizes, widths, heights, padding, gaps, radii, icon sizes. Do not scale some things and not others. Typical card, dialog and popover widths are 320 to 560px; if your root is wider than 640px or your body text is over 18px, you did not divide enough.
9. Keep the proportions of the image: the root's width to height ratio, the share of the width each column or row takes, and the ratio of text size to container width must match the screenshot. Before answering, compare your root's width:height with the image and correct it.
10. If the image holds several components, rebuild the main one, the largest or most central. If it is not a UI component, return an empty "html" and say so in "note".

Match the screenshot as closely as you can: spacing, alignment, sizes, radii and colours.`;

/** Added to the system prompt when an earlier rebuild is being corrected. */
export const MIMIC_REFINE = `You are now correcting an earlier rebuild of this component.
You get the original screenshot, then (when available) a render of the current HTML, then the HTML itself. Compare them part by part: overall width and height ratio, text sizes against the container, line breaks, spacing between items, alignment, radii, borders, shadows, colours and icons. Fix every visible difference and keep what already matches. Follow all the rules above, and return the full corrected component in the same JSON shape. In "note", say in one short sentence what you changed.`;

/** Added to the system prompt when an existing result is changed by an instruction. */
export const MIMIC_EDIT = `You are now editing an existing component by instruction. You get the current HTML, and sometimes the original screenshot as a reference. Change only what the instruction asks for and keep everything else exactly as it is: structure, data-layer names, text, sizes and colours. Follow all the rules above, and return the full component in the same JSON shape. In "note", say in one short sentence what you changed.`;

export const MIMIC_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    html: { type: "string" },
    note: { type: "string" },
  },
  required: ["name", "html", "note"],
  additionalProperties: false,
} as const;
