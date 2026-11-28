/** The brands in mimic-logos.ts (a test keeps the two in step). */
export const LOGO_NAMES = [
  "openai", "claude", "anthropic", "gemini", "mistral", "perplexity", "grok", "xai", "copilot", "midjourney",
  "deepseek", "huggingface", "cursor", "ollama", "qwen", "nvidia", "google", "apple", "microsoft", "meta",
  "aws", "github", "gitlab", "vercel", "figma", "framer", "notion", "linear", "discord", "zoom", "telegram",
  "whatsapp", "messenger", "instagram", "facebook", "x", "tiktok", "youtube", "reddit", "pinterest",
  "snapchat", "threads", "dribbble", "behance", "spotify", "netflix", "twitch", "stripe", "paypal", "visa",
  "mastercard", "applepay", "googlepay", "shopify", "dropbox", "googledrive", "gmail", "googlecalendar",
  "trello", "asana", "jira", "airtable", "supabase", "firebase", "docker", "react", "tailwindcss",
];

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
4. Text: font-family:Geist, sans-serif with font-size, font-weight, line-height and color on every text element, copied from the screenshot. Write line-height as a percentage of the font size (for example 140%): bigger text has a tighter line height (about 150% for small text, 120% for headings, 100% for hero text), and never below 80%. Reproduce the text exactly, including capitalisation.
5. Colours: read them from the image as hex. Keep border-radius, borders (1px solid colour) and box-shadow only where the image shows them.
6. Icons: for an ordinary interface icon (search, arrows, check, close, bell, user, heart and the like) do not draw it. Name the closest Lucide icon in an empty svg: <svg data-icon="arrow-right" width="16" height="16" color="#17181a"></svg>. Use Lucide's kebab-case names, the size and colour from the image, and add stroke-width="1.5" for thin icons. The app puts the real drawing in. Leave an icon that is already drawn in HTML you are correcting as it is, unless it is the wrong icon.
   Brand logos: when a mark is one of these brands, do not draw it, name it: <svg data-logo="openai" width="20" height="20"></svg>. Leave color out to get the brand's own colours; add color only when the image shows the mark in one different colour (for example white on a dark button). A logo with its name beside it is the data-logo svg plus a text element. The names: ${LOGO_NAMES.join(", ")}. ChatGPT is "openai".
   Other logos, brand marks and illustrations: never leave one out. Draw them as below and keep their place and size.
   Drawings: small inline <svg> with viewBox, using only path, circle, rect, line, polyline, polygon or ellipse with fill/stroke attributes (stroke-dasharray, stroke-dashoffset and transform are allowed). Keep every drawing cheap: at most about a dozen shapes. Repeated marks such as tick rings, dials, dots, bars or grids are ONE element with stroke-dasharray (for example a circle with stroke-dasharray="2 6" and a wide stroke), never one element per mark. Approximate an illustration, logo or photo with a few flat shapes in its main colours. Keep drawings cheap, but never save space on text or rows: the size limits apply to drawings only.
7. Name every meaningful element with data-layer (e.g. "Title", "Email field", "Primary button"). Use div and span for everything, not form elements.
8. Work out one scale factor before you write any CSS. Screenshots are usually captured at 2x or 3x, so pixel measures in the image are two or three times the CSS px. Find the body text in the image (its x-height or line pitch), decide what it would be in CSS px (normally 14 to 16px, small captions 12 to 13px, a title 20 to 28px, a hero heading up to 40px), and divide every measure by the same factor: font sizes, widths, heights, padding, gaps, radii, icon sizes. Do not scale some things and not others. Typical card, dialog and popover widths are 320 to 560px; if your root is wider than 640px or your body text is over 18px, you did not divide enough.
9. Keep the proportions of the image: the root's width to height ratio, the share of the width each column or row takes, and the ratio of text size to container width must match the screenshot. Before answering, compare your root's width:height with the image and correct it.
10. Write out every element in full. A list, table or tree with twelve rows is twelve complete row elements, each with its own text, checkbox, arrow and count. Never use placeholders, templates, shorthand, loops or tokens such as ROWS, ROW_1, {{item}} or "...", never leave a container empty that shows content in the image, and never write a row as one string of codes. Everything you return is pasted as it is.
11. If the image holds several components, rebuild the main one, the largest or most central. If it is not a UI component, return an empty "html" and say so in "note".

Match the screenshot as closely as you can: spacing, alignment, sizes, radii and colours.`;

/** Added to the system prompt when an earlier rebuild is being corrected. */
export const MIMIC_REFINE = `You are now correcting an earlier rebuild of this component.
You get the original screenshot, then (when available) a render of the current HTML, then the HTML itself. Compare them part by part: overall width and height ratio, text sizes against the container, line breaks, spacing between items, alignment, radii, borders, shadows, colours and icons. Fix every visible difference and keep what already matches. Follow all the rules above, and return the full corrected component in the same JSON shape. In "note", say in one short sentence what you changed.`;

/** Added to the system prompt when an existing result is changed by an instruction. */
export const MIMIC_EDIT = `You are now editing an existing component by instruction. You get the current HTML, and sometimes the original screenshot as a reference. Change only what the instruction asks for and keep everything else exactly as it is: structure, data-layer names, text, sizes and colours. Follow all the rules above, and return the full component in the same JSON shape. In "note", say in one short sentence what you changed.`;

/** True when the model left a template or shorthand token where real content belongs (e.g. "ROWS", "ROW_D_Spot_110"). */
export function hasPlaceholders(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, " ");
  return /\bROWS?\b|\bROW_[A-Za-z0-9]|\{\{|\}\}|\$\{|\[\[|\.\.\.\s*$/m.test(text);
}

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
