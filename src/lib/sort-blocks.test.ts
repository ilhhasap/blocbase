import assert from "node:assert/strict";
import { test } from "node:test";
import type { Block } from "../data/blocks.ts";
import { sortBlocks } from "./sort-blocks.ts";

const block = (id: string, name: string, badge?: "New"): Block => ({
  id,
  name,
  cat: "Button",
  h: 100,
  ...(badge ? { badge } : {}),
});
const BLOCKS = [
  block("a", "Zed"),
  block("b", "Alpha", "New"),
  block("c", "Mid"),
  block("d", "Beta", "New"),
];
const ids = (list: Block[]) => list.map((item) => item.id);

test("featured keeps the given order", () => {
  assert.deepEqual(ids(sortBlocks(BLOCKS, "featured", null)), [
    "a",
    "b",
    "c",
    "d",
  ]);
});

test("new first puts New badges on top, otherwise in order", () => {
  assert.deepEqual(ids(sortBlocks(BLOCKS, "new", null)), ["b", "d", "a", "c"]);
});

test("name sorts A to Z", () => {
  assert.deepEqual(ids(sortBlocks(BLOCKS, "name", null)), ["b", "d", "c", "a"]);
});

test("popular weighs saves double and falls back to order on ties", () => {
  const counts = {
    c: { copies: 1, recent: 1, saves: 2 },
    d: { copies: 9, recent: 3, saves: 0 },
  };
  assert.deepEqual(ids(sortBlocks(BLOCKS, "popular", counts)), [
    "c",
    "d",
    "a",
    "b",
  ]);
});

test("most copied counts all time", () => {
  const counts = {
    a: { copies: 5, recent: 0, saves: 0 },
    d: { copies: 9, recent: 1, saves: 0 },
  };
  assert.deepEqual(ids(sortBlocks(BLOCKS, "copied", counts)), [
    "d",
    "a",
    "b",
    "c",
  ]);
});

test("counts not loaded yet keeps the featured order", () => {
  assert.deepEqual(ids(sortBlocks(BLOCKS, "popular", null)), [
    "a",
    "b",
    "c",
    "d",
  ]);
  assert.deepEqual(ids(sortBlocks(BLOCKS, "copied", null)), [
    "a",
    "b",
    "c",
    "d",
  ]);
});

test("the input list is not changed", () => {
  const copy = [...BLOCKS];
  sortBlocks(BLOCKS, "name", null);
  assert.deepEqual(BLOCKS, copy);
});
