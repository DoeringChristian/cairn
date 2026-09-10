import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTemplateCards, type SeqMap, type SeriesEntry } from "./template-match.ts";
import { normalizeTemplateCards, templateCardOf, templateKey } from "./template-cards.ts";
import type { ComparisonTemplateCard } from "./template-cards.ts";
import type { ComparisonCard } from "./types.ts";

function seqMapOf(entries: SeriesEntry[]): SeqMap {
  const map: SeqMap = new Map();
  for (const e of entries) {
    const arr = map.get(e.name);
    if (arr) arr.push(e);
    else map.set(e.name, [e]);
  }
  return map;
}

function templateOf(cards: ComparisonTemplateCard[]): { cards: ComparisonTemplateCard[] } {
  return { cards };
}

const s = (runId: string, name: string, context_hash = ""): SeriesEntry => ({
  runId,
  name,
  context_hash,
});

test("templateCardOf records every key a card displays", () => {
  const card: ComparisonCard = {
    id: "c1",
    type: "scalar",
    series: [s("r1", "loss"), s("r2", "loss"), s("r1", "val_loss")],
  };
  assert.deepEqual(templateCardOf(card).keys, ["loss::", "val_loss::"]);
});

test("templateCardOf leaves multi-run cards keyless", () => {
  const card: ComparisonCard = { id: "c1", type: "parallel", series: [s("r1", "Parallel Coordinates")] };
  assert.deepEqual(templateCardOf(card).keys, []);
});

test("a multi-metric card restores as an overlay across every run", () => {
  const tmpl = templateOf([{ type: "scalar", keys: ["loss::", "val_loss::"] }]);
  const matched = matchTemplateCards(
    tmpl,
    ["r1", "r2"],
    seqMapOf([s("r1", "loss"), s("r2", "loss"), s("r1", "val_loss"), s("r2", "val_loss")]),
  );
  assert.equal(matched.length, 1);
  assert.deepEqual(
    matched[0]!.series.map((e) => `${e.runId}/${e.name}`),
    ["r1/loss", "r2/loss", "r1/val_loss", "r2/val_loss"],
  );
});

test("a card matches when only some of its keys resolve", () => {
  const tmpl = templateOf([{ type: "scalar", keys: ["loss::", "gone::"] }]);
  const matched = matchTemplateCards(tmpl, ["r1"], seqMapOf([s("r1", "loss")]));
  assert.equal(matched.length, 1);
  assert.equal(matched[0]!.series.length, 1);
});

test("a card whose keys all vanish is dropped", () => {
  const tmpl = templateOf([{ type: "scalar", keys: ["gone::", "system.cpu::"] }]);
  assert.deepEqual(matchTemplateCards(tmpl, ["r1"], seqMapOf([s("r1", "loss")])), []);
});

test("a key with a context prefers that context; without one, first per run", () => {
  const seqMap = seqMapOf([
    s("r1", "loss", "train"),
    s("r1", "loss", "val"),
    s("r2", "loss", "train"),
    s("r2", "loss", "val"),
  ]);

  const pinned = matchTemplateCards(
    templateOf([{ type: "scalar", keys: [templateKey("loss", "val")] }]),
    ["r1", "r2"],
    seqMap,
  );
  assert.deepEqual(
    pinned[0]!.series.map((e) => `${e.runId}/${e.context_hash}`),
    ["r1/val", "r2/val"],
  );

  const loose = matchTemplateCards(
    templateOf([{ type: "scalar", keys: ["loss::"] }]),
    ["r1", "r2"],
    seqMap,
  );
  assert.deepEqual(
    loose[0]!.series.map((e) => `${e.runId}/${e.context_hash}`),
    ["r1/train", "r2/train"],
  );
});

test("a context that no run has falls back to any context", () => {
  const matched = matchTemplateCards(
    templateOf([{ type: "scalar", keys: [templateKey("loss", "stale-hash")] }]),
    ["r1"],
    seqMapOf([s("r1", "loss", "train")]),
  );
  assert.equal(matched[0]!.series.length, 1);
  assert.equal(matched[0]!.series[0]!.context_hash, "train");
});

test("multi-run cards match on type alone, once per run", () => {
  const matched = matchTemplateCards(
    templateOf([{ type: "parallel", keys: [] }]),
    ["r1", "r2"],
    seqMapOf([]),
  );
  assert.deepEqual(
    matched[0]!.series.map((e) => e.runId),
    ["r1", "r2"],
  );
  assert.deepEqual(matchTemplateCards(templateOf([{ type: "parallel", keys: [] }]), [], seqMapOf([])), []);
});

test("pre-keys templates normalize to keys on load", () => {
  const legacy = [
    { type: "scalar", metricName: "loss", contextHash: "train", settings: { logY: true } },
    { type: "image", metricName: "preview" },
    // Multi-run cards used to carry their UI label as metricName.
    { type: "parallel", metricName: "Parallel Coordinates" },
    { type: "", metricName: "junk" },
  ];
  assert.deepEqual(normalizeTemplateCards(legacy), [
    { type: "scalar", keys: ["loss::train"], settings: { logY: true } },
    { type: "image", keys: ["preview::"], settings: undefined },
    { type: "parallel", keys: [], settings: undefined },
  ]);
});

test("a normalized legacy card still matches", () => {
  const cards = normalizeTemplateCards([{ type: "scalar", metricName: "loss" }]);
  const matched = matchTemplateCards(templateOf(cards), ["r1"], seqMapOf([s("r1", "loss", "train")]));
  assert.equal(matched.length, 1);
  assert.equal(matched[0]!.series[0]!.name, "loss");
});
