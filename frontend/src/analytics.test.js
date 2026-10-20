import test from "node:test";
import assert from "node:assert/strict";
import { summarize, groups, trend, dateKey, money } from "./analytics.js";
const fixture = [
  {
    ts: new Date(2026, 0, 1, 12).getTime() / 1000,
    model: "a",
    key: "k",
    input: 100,
    cache: 60,
    output: 20,
    reasoning: 5,
    failed: false,
  },
  {
    ts: new Date(2026, 0, 1, 13).getTime() / 1000,
    model: "a",
    key: "k",
    input: 0,
    cache: 0,
    output: 0,
    reasoning: 0,
    failed: true,
  },
];
test("tokens are not double counted and zero-token failures are included", () => {
  const s = summarize(fixture);
  assert.equal(s.input + s.output, 120);
  assert.equal(s.n, 2);
  assert.equal(s.fail, 1);
});
test("grouping and trend use same total", () => {
  assert.equal(groups(fixture, "model")[0].n, 2);
  const b = trend(fixture, "day")[0];
  assert.equal(b.cache + b.net + b.output, 120);
});
test("local date does not use UTC slicing", () =>
  assert.equal(dateKey(new Date(2026, 0, 1)), "2026-01-01"));
test("fees and missing price coverage follow the same filters and grouping", () => {
  const events = [
    { ...fixture[0], cost: 1.77, price_basis: "historical_estimate" },
    { ...fixture[1], cost: 0 },
    { ...fixture[0], model: "unpriced", cost: null },
  ];
  const total = summarize(events);
  assert.equal(total.cost, 1.77);
  assert.equal(total.priced, 2);
  assert.equal(total.unpriced, 1);
  assert.equal(total.historical, 1);
  const known = summarize(events.filter((e) => e.model === "a"));
  assert.equal(known.unpriced, 0);
  assert.equal(groups(events, "model").find((g) => g.name === "unpriced").priced, 0);
  assert.equal(trend(events, "day")[0].cost, total.cost);
  assert.equal(trend(events, "day")[0].unpriced, 1);
});
test("unpriced trend buckets remain gaps and free buckets remain zero", () => {
  const buckets = trend([{ ...fixture[0], cost: null }, { ...fixture[1], cost: 0 }], "hour");
  assert.equal(buckets[0].cost, null);
  assert.equal(buckets[1].cost, 0);
  assert.equal(money(null), "未定价");
  assert.equal(money(0), "$0.00");
  assert.equal(money(0.0000001), "< $0.000001");
});
