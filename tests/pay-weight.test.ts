import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/scoring.ts";

// PAY-1..6: comp.pay_weight turns pay into its own weighted part of the score:
// a hard floor (base_floor_usd) gates the role, and the target (stretch_target_usd) earns the most points.
// Example numbers only; a candidate's real numbers live in their private criteria.
const spec = {
  comp: {
    base_floor_usd: 140000,
    stretch_target_usd: 205000,
    pay_weight: { target_points: 20, mid_usd: 175000, mid_points: 10, unknown_points: 5 },
  },
};
const job = (comp: unknown) => ({ company: "Acme", title: "Senior Product Manager", location: "Remote, US", fit: "maybe", comp });

test("PAY-1: a range that reaches the target earns the target points", () => {
  assert.equal(S.scoreJob(job({ min: 160000, max: 205000 }), spec).parts.comp, 20);
  assert.equal(S.scoreJob(job("$195K-$240K"), spec).parts.comp, 20);
});

test("PAY-2: a range between the middle band and the target earns the middle points", () => {
  assert.equal(S.scoreJob(job({ min: 150000, max: 175000 }), spec).parts.comp, 10);
  assert.equal(S.scoreJob(job({ min: 150000, max: 204999 }), spec).parts.comp, 10);
  assert.equal(S.scoreJob(job({ min: 130000, max: 174999 }), spec).parts.comp, 0);
});

test("PAY-3: no stated pay earns the unknown points, judged from the level", () => {
  assert.equal(S.scoreJob(job(""), spec).parts.comp, 5);
  assert.equal(S.scoreJob(job("Competitive"), spec).parts.comp, 5);
});

test("PAY-4: the hard floor gates the role; above it the role is kept", () => {
  assert.ok(!S.matchJob(job({ min: 120000, max: 139999 }), spec).ok);
  assert.ok(S.matchJob(job({ min: 130000, max: 140000 }), spec).ok);
  assert.ok(S.matchJob(job(""), spec).ok, "missing pay is kept");
});

test("PAY-5: without pay_weight the old +10 stretch bonus still applies", () => {
  const old = { comp: { base_floor_usd: 150000, stretch_target_usd: 185000 } };
  assert.equal(S.scoreJob(job({ min: 150000, max: 185000 }), old).parts.comp, 10);
  assert.equal(S.scoreJob(job(""), old).parts.comp, 0);
});

test("PAY-6: explain shows the pay points as comp", () => {
  const r = S.scoreJob({ ...job("$208K"), fit: "strong" }, spec);
  assert.match(S.explain(r), /\+ 20 comp$/);
});
