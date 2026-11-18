import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/scoring.ts";

// PAYLBL-1..5: the pay shown on a card is one tidy label, whatever shape the scan stored; nothing when pay is unknown.
// Example strings are made up in the shapes the scan writes.

test("PAYLBL-1: a stored range reads as $LOW–$HIGH in thousands", () => {
  assert.equal(S.payLabel("$151,000 - $189,000"), "$151K–$189K");
  assert.equal(S.payLabel("$151K – $189K + equity"), "$151K–$189K");
  assert.equal(S.payLabel("USD 180000-270000"), "$180K–$270K");
  assert.equal(S.payLabel({ min: 160000, max: 200000 }), "$160K–$200K");
});

test("PAYLBL-2: odd thousands keep one decimal, round numbers drop it", () => {
  assert.equal(S.payLabel("$182.6K – $241.5K"), "$182.6K–$241.5K");
  assert.equal(S.payLabel("$207,485 - $244,100"), "$207.5K–$244.1K");
});

test("PAYLBL-3: unknown pay gives null, so the card shows nothing", () => {
  assert.equal(S.payLabel(""), null);
  assert.equal(S.payLabel(null), null);
  assert.equal(S.payLabel(undefined), null);
  assert.equal(S.payLabel("Not posted"), null);
  assert.equal(S.payLabel("Not posted (other roles at this company $160K–$235K)"), null);
  assert.equal(S.payLabel("401(k) match"), null);
});

test("PAYLBL-4: a single figure keeps its meaning", () => {
  assert.equal(S.payLabel("From $180K base"), "$180K+");
  assert.equal(S.payLabel("$200K"), "$200K");
});

test("PAYLBL-5: several location ranges show the full span and say it varies", () => {
  assert.equal(S.payLabel("Zone A $190K-$304K · Zone B $165K-$264K · Zone C $150K-$220K"), "$150K–$304K (varies)");
  assert.equal(S.payLabel("$204K – $264K (most states); $230K – $290K (CA, WA)"), "$204K–$290K (varies)");
});

// PAYLBL-6: on the page, every card with pay shows one `.pay` label in its meta line; a card without pay shows no "$" there.
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { openDemo } from "../scripts/browser.mjs";
let browser: Browser;
test("PAYLBL-6: cards show a tidy pay label, and nothing when pay is unknown", async () => {
  browser = await chromium.launch();
  try {
    const { page, errors } = await openDemo(browser, { width: 1280, height: 800 });
    const cards = await page.$$eval("#view article.job", (els) => els.map((el) => ({ pay: el.querySelector(".meta .pay")?.textContent ?? null, meta: el.querySelector(".meta")?.textContent ?? "" })));
    assert.ok(cards.length > 0);
    assert.ok(cards.some((c) => c.pay), "some demo card has pay");
    for (const c of cards) {
      if (c.pay) assert.match(c.pay, /^\$[\d.]+K(–\$[\d.]+K)?\+?( \(varies\))?$/);
      else assert.ok(!/\$/.test(c.meta), `no pay label but meta has $: ${c.meta}`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  } finally { await browser.close(); }
});
