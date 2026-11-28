import assert from "node:assert/strict";
import { test } from "node:test";
import { expandIcons } from "./mimic-icons.ts";
import { loadLogo, loadLucide } from "./mimic-lucide.ts";
import { LOGO_NAMES } from "./mimic-prompt.ts";

test("puts the real Lucide drawing where the model named an icon", async () => {
  const out = await expandIcons(
    '<div><svg data-icon="search" width="20" height="20" color="#ff0000"></svg><span>Find</span></div>',
    loadLucide,
  );
  assert.match(out, /data-layer="Icon search"/);
  assert.match(out, /width="20" height="20"/);
  assert.match(out, /stroke="#ff0000"/);
  assert.match(out, /<circle cx="11" cy="11" r="8">/);
  assert.doesNotMatch(out, /data-icon|key=/);
  assert.match(out, /<span>Find<\/span><\/div>$/);
});

test("handles self-closing tags and several icons", async () => {
  const out = await expandIcons('<svg data-icon="x"/><p></p><svg data-icon="check"></svg>', loadLucide);
  assert.equal(out.match(/<svg /g)?.length, 2);
  assert.match(out, /Icon x.*<p><\/p>.*Icon check/s);
});

test("keeps a visible spot for an unknown name, or the model's own drawing", async () => {
  assert.match(await expandIcons('<svg data-icon="no-such-icon"></svg>', loadLucide), /<rect x="4"/);
  const own = '<svg data-icon="openai" viewBox="0 0 24 24"><path d="M1 1"></path></svg>';
  assert.equal(await expandIcons(own, loadLucide), own);
});

test("leaves other drawings alone and does not let attributes break out", async () => {
  const plain = '<svg viewBox="0 0 1 1"><path d="M0 0"></path></svg>';
  assert.equal(await expandIcons(plain, loadLucide), plain);
  const out = await expandIcons(`<svg data-icon="x" color="red'<script>"></svg>`, loadLucide);
  assert.doesNotMatch(out, /<script/);
});

test("puts a brand's real logo, in its own colours unless one is asked for", async () => {
  const black = await expandIcons('<svg data-logo="openai" width="24" height="24"></svg>', loadLucide, loadLogo);
  assert.match(black, /data-layer="Logo openai"/);
  assert.match(black, /fill="#000000"/);
  const white = await expandIcons('<svg data-logo="google" color="#ffffff"></svg>', loadLucide, loadLogo);
  assert.match(white, /fill="#ffffff"/);
  assert.doesNotMatch(white, /#4285F4|currentColor/i);
  const own = await expandIcons('<svg data-logo="google"></svg>', loadLucide, loadLogo);
  assert.match(own, /#4285F4/i);
  assert.match(await expandIcons('<svg data-logo="constructor"></svg>', loadLucide, loadLogo), /<rect x="4"/);
});

test("every brand the model is told about has a logo", async () => {
  for (const name of LOGO_NAMES) assert.ok(await loadLogo(name), name);
});
