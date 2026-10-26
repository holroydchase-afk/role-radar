/* Role Radar scoring: the rules in criteria.yaml, as code.
 * One source of truth for the page (score breakdowns, digest preview) and the tests.
 * The weekday scan follows the same rules in its prompt; tests/scoring.test.mjs pins them down.
 *
 *   score = sector (weight × 15) + fit (strong 35 · maybe 20 · stretch 5)
 *         + culture (+10 any good signal, −10 per red flag, floor −20)
 *         + comp (+10 if the range reaches stretch_target_usd)
 *         − values (15 if the business is on values_penalty)
 *         + dream (dream_roles.bonus, default 15, for a role like one of the dream_roles anchors)
 *         + stage (company_stage.startup_penalty, e.g. −20, when job.companyStage is "startup")
 *   clamped to 0–100.
 * With culture.red_flag_effect: skip_hard, a culture.hard_red_flags phrase fails matchJob (never added).
 *
 * Two badges sit beside the score and never change it (criteria.yaml values_fit and culture_fit):
 *   Values  = great · good · neutral · no, from the sector weight, hard excludes and values_penalty
 *   Culture = great · good · maybe · no, from the culture_fit checks that apply; "unrated" until checked
 *
 * Classic script: sets window.RoleRadarScoring in the browser, module.exports in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoleRadarScoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const FIT_POINTS = { strong: 35, maybe: 20, stretch: 5 };
  const SECTOR_POINTS_PER_WEIGHT = 15;
  const CULTURE_GOOD = 10, CULTURE_RED = -10, CULTURE_FLOOR = -20;
  const COMP_BONUS = 10, VALUES_PENALTY = -15, DREAM_BONUS = 15;

  const lc = (s) => String(s == null ? "" : s).toLowerCase();
  const arr = (a) => (Array.isArray(a) ? a : a == null || a === "" ? [] : [a]);
  const has = (hay, needle) => {
    const n = lc(needle).trim();
    if (!n) return false;
    // Whole-word-ish match so "PV" doesn't hit "provider".
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])").test(lc(hay));
  };
  const clamp = (n) => Math.max(0, Math.min(100, n));

  /** "$170K–$205K", "$160,000 - $180,000", "170k" → {min, max} in dollars, or null. */
  function parseComp(comp) {
    if (comp && typeof comp === "object") {
      // null, "" and 0 mean "not stated", not $0.
      const num = (v) => (v == null || v === "" ? NaN : Number(v) > 0 ? Number(v) : NaN);
      const min = num(comp.min), max = num(comp.max);
      if (isFinite(min) || isFinite(max)) return { min: isFinite(min) ? min : max, max: isFinite(max) ? max : min };
      return null;
    }
    const nums = [];
    // A 401(k) is a retirement plan, not a $401K salary.
    String(comp == null ? "" : comp).replace(/\b401\s*\(?k\)?/gi, " ").replace(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]?)/g, (_, n, unit) => {
      let v = Number(n.replace(/,/g, ""));
      if (/k/i.test(unit)) v *= 1e3;
      else if (/m/i.test(unit)) v *= 1e6;
      else if (v < 1000) v *= 1e3; // "170 - 205" in a salary field means thousands
      if (v >= 20000 && v <= 2e6) nums.push(v);
      return _;
    });
    if (!nums.length) return null;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }

  /** Best-matching sector entry for a job: an explicit label/id first, then examples, then keywords. */
  function sectorFor(job, spec) {
    const sectors = arr(spec && spec.sectors);
    const fallback = { id: "default", label: "Other", weight: Number((spec && spec.default_sector_weight) ?? 1) };
    if (job.sector) {
      const s = sectors.find((x) => lc(x.label) === lc(job.sector) || lc(x.id) === lc(job.sector));
      if (s) return s;
    }
    const company = [job.company, job.industry].join(" ");
    const hay = [job.company, job.industry, job.title, job.postingText].join(" ");
    const byWeight = sectors.slice().sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0));
    return byWeight.find((s) => arr(s.examples).some((e) => has(company, e)))
      || byWeight.find((s) => arr(s.keywords).some((k) => has(hay, k)))
      || fallback;
  }

  function cultureOf(job, spec) {
    const c = (spec && spec.culture) || {};
    let good, red;
    if (job.cultureSignals) {
      good = arr(job.cultureSignals.good);
      red = arr(job.cultureSignals.red);
    } else {
      const text = job.postingText || "";
      good = arr(c.good_signals).filter((s) => has(text, s));
      red = arr(c.red_flags).filter((s) => has(text, s));
    }
    const points = (good.length ? CULTURE_GOOD : 0) + Math.max(CULTURE_FLOOR, CULTURE_RED * red.length);
    return { points, good, red };
  }

  /** Dream-role match: an anchor's company, or an anchor-like title (role_keywords) in one of in_sectors. */
  function dreamOf(job, spec, sector) {
    const d = (spec && spec.dream_roles) || {};
    const like = arr(d.like).filter((a) => a && lc(a.company).trim());
    const anchor = like.find((a) => lc(job.company).trim() === lc(a.company).trim());
    if (anchor) return { why: "like " + anchor.company + (anchor.title ? " " + anchor.title : ""), check: anchor.check || null };
    const inSector = arr(d.in_sectors).some((id) => lc(id) === lc(sector && sector.id));
    const kw = inSector && arr(d.role_keywords).find((k) => has([job.title, job.team].join(" "), k));
    return kw ? { why: kw + " role in " + (sector.label || sector.id), check: null } : null;
  }

  function valuesHit(job, spec) {
    const hay = [job.businessModel, job.industry, job.company].join(" ");
    return arr(spec && spec.values_penalty).find((v) => has(hay, v)) || null;
  }

  /** Hard gates. Returns {ok, reasons}. A failing job is never added, whatever it would score. */
  function matchJob(job, spec) {
    spec = spec || {};
    const reasons = [];
    const role = spec.role || {}, work = spec.work || {}, comp = spec.comp || {}, hx = spec.hard_exclude || {};
    const title = job.title || "";
    const inc = arr(role.title_include), exc = arr(role.title_exclude);
    if (inc.length && !inc.some((t) => has(title, t))) reasons.push("title not on the include list");
    const ex = exc.find((t) => has(title, t));
    if (ex) reasons.push("title excluded: " + ex);
    const co = arr(hx.companies).find((c) => lc(c).trim() && lc(job.company).trim() === lc(c).trim());
    if (co) reasons.push("company on hard_exclude: " + co);
    const bm = arr(hx.business_models).find((b) => has([job.businessModel, job.industry].join(" "), b));
    if (bm) reasons.push("business model excluded: " + bm);
    const loc = lc(job.location);
    const near = arr(work.hybrid_ok_near).some((p) => has(loc, String(p).split(",")[0]));
    if (/hybrid|on-?site|in[- ]office/.test(loc) && !near) reasons.push("not remote: " + job.location);
    const c = spec.culture || {};
    if (lc(c.red_flag_effect) === "skip_hard") {
      const hard = arr(c.hard_red_flags).find((f) => cultureOf(job, spec).red.some((r) => lc(r).trim() === lc(f).trim()) || (!job.cultureSignals && has(job.postingText || "", f)));
      if (hard) reasons.push("hard red flag: " + hard);
    }
    const range = parseComp(job.comp);
    if (range && comp.base_floor_usd) {
      const sector = sectorFor(job, spec);
      const floor = Number(sector.weight) >= 3 && comp.priority_sector_floor_usd ? comp.priority_sector_floor_usd : comp.base_floor_usd;
      if (range.max < floor) reasons.push("comp tops out below the floor");
    }
    return { ok: reasons.length === 0, reasons };
  }

  /** Score breakdown for one job. Missing comp or culture data simply adds nothing. */
  function scoreJob(job, spec) {
    spec = spec || {};
    const sector = sectorFor(job, spec);
    const weight = Math.max(0, Math.min(3, Number(sector.weight) || 0));
    const fitKey = lc(job.fit);
    const culture = cultureOf(job, spec);
    const range = parseComp(job.comp);
    const target = spec.comp && spec.comp.stretch_target_usd;
    const values = valuesHit(job, spec);
    const dream = dreamOf(job, spec, sector);
    const parts = {
      sector: weight * SECTOR_POINTS_PER_WEIGHT,
      fit: FIT_POINTS[fitKey] || 0,
      culture: culture.points,
      comp: range && target && range.max >= target ? COMP_BONUS : 0,
      values: values ? VALUES_PENALTY : 0,
      dream: dream ? Number(spec.dream_roles.bonus ?? DREAM_BONUS) || 0 : 0,
      stage: lc(job.companyStage) === "startup" ? Number(spec.company_stage && spec.company_stage.startup_penalty) || 0 : 0,
    };
    const raw = parts.sector + parts.fit + parts.culture + parts.comp + parts.values + parts.dream + parts.stage;
    return { score: clamp(raw), raw, parts, sector, culture, valuesHit: values, dream };
  }

  const VALUES_BY_WEIGHT = { 3: "great", 2: "good", 1: "neutral", 0: "no" };
  const RATINGS = ["great", "good", "neutral", "maybe", "no", "unrated"];
  const rating = (r) => (RATINGS.includes(lc(r)) ? lc(r) : null);

  /** Values badge: does the business match what the candidate cares about?
   *  A stored job.valuesFit {rating, reason} wins; otherwise hard excludes and values_penalty say "no",
   *  and the sector weight picks the rest (values_fit.by_weight). */
  function valuesFitOf(job, spec) {
    spec = spec || {};
    const stored = job.valuesFit && rating(job.valuesFit.rating);
    if (stored) return { rating: stored, reason: job.valuesFit.reason || "", source: "stored" };
    const gate = matchJob(job, spec).reasons.find((r) => /hard_exclude|business model/.test(r));
    if (gate) return { rating: "no", reason: gate, source: "computed" };
    const hit = valuesHit(job, spec);
    if (hit) return { rating: "no", reason: "on values_penalty: " + hit, source: "computed" };
    const sector = sectorFor(job, spec);
    const w = Math.max(0, Math.min(3, Number(sector.weight) || 0));
    const map = { ...VALUES_BY_WEIGHT, ...((spec.values_fit && spec.values_fit.by_weight) || {}) };
    return { rating: rating(map[w]) || VALUES_BY_WEIGHT[w], reason: sector.label + " (weight " + w + ")", source: "computed" };
  }

  /** Which culture_fit checks apply: job.cultureChecks (ids, or {id: note}), else a rough read of cultureSignals. */
  function cultureHits(job, spec) {
    const checks = arr(spec && spec.culture_fit && spec.culture_fit.checks);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    let given = job.cultureChecks;
    if (given && !Array.isArray(given) && typeof given === "object") given = Object.entries(given).map(([id, note]) => ({ id, note }));
    else given = arr(given).map((x) => (typeof x === "string" ? { id: x } : x));
    if (!given.length) {
      const c = cultureOf(job, spec);
      if (c.red.length && byId.fast_paced) given.push({ id: "fast_paced", note: c.red.join(", ") });
      if (c.good.length && byId.family_benefits) given.push({ id: "family_benefits", note: c.good.join(", ") });
    }
    return given.filter((g) => byId[g.id]).map((g) => ({ ...byId[g.id], note: g.note || "" }));
  }

  /** Culture badge: sum the culture_fit checks that apply and band the total.
   *  A stored job.cultureFit {rating, reason} wins (intake research); no checks at all → "unrated". */
  function cultureFitOf(job, spec) {
    spec = spec || {};
    const hits = cultureHits(job, spec);
    const points = hits.reduce((n, h) => n + (Number(h.points) || 0), 0);
    const stored = job.cultureFit && rating(job.cultureFit.rating);
    if (stored) return { rating: stored, reason: job.cultureFit.reason || "", points, hits, source: "stored" };
    if (!hits.length) return { rating: "unrated", reason: "Not checked yet.", points: 0, hits, source: "computed" };
    const b = { great: 6, good: 3, maybe: -3, ...((spec.culture_fit && spec.culture_fit.bands) || {}) };
    const r = points >= b.great ? "great" : points >= b.good ? "good" : points >= b.maybe ? "maybe" : "no";
    const plus = hits.filter((h) => h.points > 0).map((h) => h.short || h.id);
    const minus = hits.filter((h) => h.points < 0).map((h) => h.short || h.id);
    const reason = [plus.join(", "), minus.length ? "but " + minus.join(", ") : ""].filter(Boolean).join("; ");
    return { rating: r, reason: reason.charAt(0).toUpperCase() + reason.slice(1) + ".", points, hits, source: "computed" };
  }

  /** "45 sector + 35 experience + 10 comp" — the parts that moved the score.
   *  "fit" is stored as strong/maybe/stretch but shown as experience strong/partial/stretch,
   *  so it doesn't read as the overall verdict next to the score. */
  function explain(result) {
    const p = result.parts, out = [];
    const add = (n, label) => { if (n) out.push((out.length ? (n < 0 ? "− " : "+ ") : n < 0 ? "−" : "") + Math.abs(n) + " " + label); };
    add(p.sector, "sector"); add(p.fit, "experience"); add(p.culture, "culture signals"); add(p.comp, "comp"); add(p.values, "values"); add(p.dream, "dream role"); add(p.stage, "startup");
    return out.join(" ") || "0";
  }

  /** The morning digest: matching jobs at or above min_score_to_add, best first,
   *  at most digest_max_items, with per_sector_cap limits. Capped extras are counted, not dropped. */
  function buildDigest(jobs, spec) {
    spec = spec || {};
    const sc = spec.scoring || {};
    const min = Number(sc.min_score_to_add ?? 0);
    const max = Number(sc.digest_max_items ?? Infinity);
    const caps = sc.per_sector_cap || {};
    const scored = arr(jobs)
      .map((job) => ({ job, match: matchJob(job, spec), result: scoreJob(job, spec) }))
      .filter((x) => x.match.ok && x.result.score >= min)
      .sort((a, b) => b.result.score - a.result.score || String(a.job.company).localeCompare(String(b.job.company)));
    const items = [], extras = {}, perSector = {};
    for (const x of scored) {
      const id = x.result.sector.id;
      const cap = caps[id];
      if (cap != null && (perSector[id] || 0) >= Number(cap)) { extras[id] = (extras[id] || 0) + 1; continue; }
      if (items.length >= max) { extras._overflow = (extras._overflow || 0) + 1; continue; }
      perSector[id] = (perSector[id] || 0) + 1;
      items.push(x);
    }
    return { items, extras, considered: arr(jobs).length, passed: scored.length };
  }

  return { parseComp, sectorFor, matchJob, scoreJob, explain, buildDigest, valuesFitOf, cultureFitOf, FIT_POINTS };
});
