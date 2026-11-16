import assert from "node:assert/strict";
import { test } from "node:test";
import { blockToHtml, blockToReact, componentName } from "./block-code.ts";

const SAMPLE =
  '<div class="kit" data-layer="Pricing card" style="display: flex; flex-direction: column; gap: 8px; width: 240px; background-color: #ffffff; flex-shrink: 0">' +
  '<span data-layer="Title" style="font-size: 14px; min-width: 0">Pro &amp; more</span>' +
  '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1L5 5" stroke="#000" stroke-width="2"></path></svg>' +
  '<div style="display: flex"></div></div>';

test("html keeps styles, drops canvas-only noise and layer names", () => {
  const out = blockToHtml(SAMPLE)!;
  assert.match(out, /^<!-- Uses the Geist font/);
  assert.ok(!out.includes("data-layer"));
  assert.ok(!out.includes('class="kit"'));
  assert.ok(!out.includes("flex-shrink"));
  assert.ok(!out.includes("min-width"));
  assert.ok(
    out.includes('<span style="font-size: 14px">Pro &amp; more</span>'),
  );
  assert.ok(
    out.includes('<path d="M1 1L5 5" stroke="#000" stroke-width="2" />'),
  );
});

test("react turns styles into objects and svg attributes into camelCase", () => {
  const out = blockToReact(SAMPLE, "Pricing card")!;
  assert.ok(out.includes("export function PricingCard() {"));
  assert.ok(out.includes('flexDirection: "column",'));
  assert.ok(out.includes('backgroundColor: "#ffffff",'));
  assert.ok(out.includes('strokeWidth="2"'));
  assert.ok(out.includes('viewBox="0 0 16 16"'));
  assert.ok(out.includes("Pro & more"));
  assert.ok(!out.includes("data-layer"));
  assert.ok(!out.includes("class="));
});

test("react escapes braces and angle brackets in text", () => {
  const out = blockToReact(
    '<div class="kit"><span>a {b} &lt;c&gt;</span></div>',
    "x",
  )!;
  assert.ok(out.includes('a {"{"}b{"}"} {"<"}c{">"}'));
});

test("component names are valid identifiers", () => {
  assert.equal(componentName("Install Chrome modal"), "InstallChromeModal");
  assert.equal(componentName("3d card"), "Block3dCard");
  assert.equal(componentName("???"), "Block");
});

test("nothing to print returns null", () => {
  assert.equal(blockToHtml("just text"), null);
  assert.equal(blockToReact("", "x"), null);
});

test("colours go back to hex, numbers stay numbers, box-sizing is dropped", () => {
  const html =
    '<div class="kit" style="background-color: rgb(255, 255, 255); box-sizing: border-box; font-weight: 500; color: rgba(0, 0, 0, 0.5)"><span>x</span></div>';
  const react = blockToReact(html, "x")!;
  assert.ok(react.includes('backgroundColor: "#ffffff"'));
  assert.ok(react.includes("fontWeight: 500,"));
  assert.ok(react.includes('color: "rgba(0, 0, 0, 0.5)"'));
  assert.ok(!react.includes("boxSizing"));
  const out = blockToHtml(html)!;
  assert.ok(out.includes("background-color: #ffffff"));
  assert.ok(!out.split("\n").slice(1).join("\n").includes("box-sizing"));
});

test("live blocks: data attributes are dropped, aria and void tags survive", () => {
  const html =
    '<div class="kit" data-layer="Field" data-gap="8" role="group"><input placeholder="Email" tabindex="0"><svg aria-hidden="true" viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"></circle></svg></div>';
  const react = blockToReact(html, "Field")!;
  assert.ok(!react.includes("data-"));
  assert.ok(react.includes('role="group"'));
  assert.ok(react.includes('placeholder="Email"'));
  assert.ok(react.includes("tabIndex={0}"));
  assert.ok(react.includes('aria-hidden="true"'));
  assert.ok(react.includes("<input"));
  assert.ok(!react.includes("</input>"));
  assert.ok(react.includes('viewBox="0 0 4 4"'));
  const out = blockToHtml(html)!;
  assert.ok(!out.includes("data-"));
  assert.ok(out.includes("<input"));
});

test("inherited font and zero defaults are not repeated", () => {
  const html =
    '<div class="kit" style="font-family: Geist; display: flex; flex-direction: row; gap: 0px; padding: 0px"><span style="font-family: Geist; font-size: 14px">x</span><span style="font-family: Mono">y</span></div>';
  const out = blockToHtml(html)!;
  assert.equal(out.match(/font-family/g)?.length, 2);
  assert.ok(!out.includes("gap"));
  assert.ok(!out.includes("padding"));
  assert.ok(!out.includes("flex-direction"));
});

test("a block that filled its card keeps its measured width", () => {
  const html =
    '<div class="kit" data-w="320" style="display: flex; width: 100%"><span>x</span></div>';
  assert.ok(blockToHtml(html)!.includes("width: 320px"));
  assert.ok(blockToReact(html, "x")!.includes('width: "320px"'));
  const bare = '<div class="kit" style="display: flex; width: 100%"><span>x</span></div>';
  assert.ok(!blockToHtml(bare)!.includes("width"));
});

test("a negative gap becomes a negative margin on later children", () => {
  const html =
    '<div class="kit" style="display: flex; gap: 0px; --ax-gap: -11px"><div style="width: 4px"></div><div style="width: 22px"></div></div>';
  const out = blockToHtml(html)!;
  assert.ok(!out.includes("--ax-gap"));
  assert.ok(out.includes("margin-left: -11px"));
  assert.ok(blockToReact(html, "x")!.includes('marginLeft: "-11px"'));
});
