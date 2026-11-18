/* Role Radar: built from src/scoring.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarScoring = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/scoring.ts
  var scoring_exports = {};
  __export(scoring_exports, {
    FIT_POINTS: () => FIT_POINTS,
    buildDigest: () => buildDigest,
    cultureFitOf: () => cultureFitOf,
    dreamBucketOf: () => dreamBucketOf,
    explain: () => explain,
    matchJob: () => matchJob,
    parseComp: () => parseComp,
    scoreJob: () => scoreJob,
    scoreSplit: () => scoreSplit,
    sectorFor: () => sectorFor,
    valuesFitOf: () => valuesFitOf,
    workplaceOf: () => workplaceOf
  });
  var DREAM_KINDS = ["mission", "health", "ai_lab", "applied_ai"];
  var FIT_POINTS = { strong: 35, maybe: 20, stretch: 5 };
  var SECTOR_POINTS_PER_WEIGHT = 15;
  var CULTURE_GOOD = 10;
  var CULTURE_RED = -10;
  var CULTURE_FLOOR = -20;
  var COMP_BONUS = 10;
  var VALUES_PENALTY = -15;
  var DREAM_BONUS = 15;
  var lc = (s) => String(s == null ? "" : s).toLowerCase();
  var arr = (a) => Array.isArray(a) ? a : a == null || a === "" ? [] : [a];
  var has = (hay, needle) => {
    const n = lc(needle).trim();
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])").test(lc(hay));
  };
  var clamp = (n) => Math.max(0, Math.min(100, n));
  function parseComp(comp) {
    if (comp && typeof comp === "object") {
      const o = comp;
      const num = (v) => v == null || v === "" ? NaN : Number(v) > 0 ? Number(v) : NaN;
      const min = num(o.min), max = num(o.max);
      if (isFinite(min) || isFinite(max)) return { min: isFinite(min) ? min : max, max: isFinite(max) ? max : min };
      return null;
    }
    const nums = [];
    String(comp == null ? "" : comp).replace(/\b401\s*\(?k\)?/gi, " ").replace(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]?)/g, (_, n, unit) => {
      let v = Number(n.replace(/,/g, ""));
      if (/k/i.test(unit)) v *= 1e3;
      else if (/m/i.test(unit)) v *= 1e6;
      else if (v < 1e3) v *= 1e3;
      if (v >= 2e4 && v <= 2e6) nums.push(v);
      return _;
    });
    if (!nums.length) return null;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }
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
    return byWeight.find((s) => arr(s.examples).some((e) => has(company, e))) || byWeight.find((s) => arr(s.keywords).some((k) => has(hay, k))) || fallback;
  }
  function cultureOf(job, spec) {
    const c = spec && spec.culture || {};
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
  function dreamOf(job, spec, sector) {
    const d = spec && spec.dream_roles || {};
    const like = arr(d.like).filter((a) => a && lc(a.company).trim());
    const anchor = like.find((a) => lc(job.company).trim() === lc(a.company).trim());
    if (anchor) return { why: "like " + anchor.company + (anchor.title ? " " + anchor.title : ""), check: anchor.check || null };
    const inSector = arr(d.in_sectors).some((id) => lc(id) === lc(sector && sector.id));
    const kw = inSector && arr(d.role_keywords).find((k) => has([job.title, job.team].join(" "), k));
    return kw ? { why: kw + " role in " + (sector.label || sector.id), check: null } : null;
  }
  function dreamBucketOf(job, spec) {
    const j = job && typeof job === "object" ? job : {};
    const d = spec && typeof spec === "object" ? spec.dream : null;
    const ex = d && typeof d === "object" ? d.exclude : null;
    const terms = ex && typeof ex === "object" && !Array.isArray(ex) ? [...arr(ex.keywords), ...arr(ex.companies)] : arr(ex);
    const text = [j.company, j.title, j.team, j.industry, j.postingText, j.description].map((x) => typeof x === "string" ? x : "").join(" \n ");
    if (terms.some((t) => typeof t === "string" && has(text, t))) return null;
    const p = j.dream;
    if (p && typeof p === "object" && DREAM_KINDS.includes(String(p.kind)) && typeof p.why === "string" && p.why.trim()) {
      return { kind: p.kind, why: p.why };
    }
    if (!d || typeof d !== "object") return null;
    const co = lc(j.company).trim();
    const named = arr(d.companies).find((c) => typeof c === "string" && lc(c).trim() && lc(c).trim() === co);
    if (named) return { kind: "mission", why: named + " is on your dream list" };
    const established = arr(d.established_companies).some((c) => typeof c === "string" && lc(c).trim() && lc(c).trim() === co);
    const title = String(j.title ?? "");
    const all = text;
    for (const r of arr(d.rules)) {
      if (!r || typeof r !== "object" || !DREAM_KINDS.includes(String(r.kind))) continue;
      const hay = r.kind === "applied_ai" && !established ? title : all;
      const kw = arr(r.keywords).find((k) => typeof k === "string" && has(hay, k));
      if (kw) return { kind: r.kind, why: String(r.kind).replace("_", " ") + ": " + kw };
    }
    return null;
  }
  function valuesHit(job, spec) {
    const hay = [job.businessModel, job.industry, job.company].join(" ");
    return arr(spec && spec.values_penalty).find((v) => has(hay, v)) || null;
  }
  function matchJob(job, spec) {
    spec = spec || {};
    const reasons = [];
    const role = spec.role || {}, work = spec.work || {}, comp = spec.comp || {}, hx = spec.hard_exclude || {};
    const title = job.title || "";
    const inc = arr(role.title_include), exc = arr(role.title_exclude);
    if (inc.length && !inc.some((t) => has(title, t))) reasons.push("title not on the include list");
    const ex = exc.find((t) => has(title, t));
    if (ex) reasons.push("title excluded: " + ex);
    const co = arr(hx.companies).find((c2) => lc(c2).trim() && lc(job.company).trim() === lc(c2).trim());
    if (co) reasons.push("company on hard_exclude: " + co);
    const bm = arr(hx.business_models).find((b) => has([job.businessModel, job.industry].join(" "), b));
    if (bm) reasons.push("business model excluded: " + bm);
    const loc = lc(job.location);
    const near = arr(work.hybrid_ok_near).some((p) => has(loc, String(p).split(",")[0]));
    if (/hybrid|on-?site|in[- ]office/.test(loc) && !near) reasons.push("not remote: " + job.location);
    const c = spec.culture || {};
    if (lc(c.red_flag_effect) === "skip_hard") {
      const hard = arr(c.hard_red_flags).find((f) => cultureOf(job, spec).red.some((r) => lc(r).trim() === lc(f).trim()) || !job.cultureSignals && has(job.postingText || "", f));
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
  function compPoints(range, comp) {
    const c = comp || {}, pw = c.pay_weight;
    const n = (v) => Number(v) || 0;
    if (pw && typeof pw === "object") {
      if (!range) return n(pw.unknown_points);
      const target = n(pw.target_usd) || n(c.stretch_target_usd);
      if (target && range.max >= target) return n(pw.target_points);
      if (n(pw.mid_usd) && range.max >= n(pw.mid_usd)) return n(pw.mid_points);
      return 0;
    }
    return range && c.stretch_target_usd && range.max >= c.stretch_target_usd ? COMP_BONUS : 0;
  }
  function scoreJob(job, spec) {
    spec = spec || {};
    const sector = sectorFor(job, spec);
    const weight = Math.max(0, Math.min(3, Number(sector.weight) || 0));
    const fitKey = lc(job.fit);
    const culture = cultureOf(job, spec);
    const range = parseComp(job.comp);
    const values = valuesHit(job, spec);
    const dream = dreamOf(job, spec, sector);
    const parts = {
      sector: weight * SECTOR_POINTS_PER_WEIGHT,
      fit: FIT_POINTS[fitKey] || 0,
      culture: culture.points,
      comp: compPoints(range, spec.comp),
      values: values ? VALUES_PENALTY : 0,
      // A dream match means dream_roles is there: dreamOf found an anchor or keyword in it.
      dream: dream ? Number(spec.dream_roles.bonus ?? DREAM_BONUS) || 0 : 0,
      stage: lc(job.companyStage) === "startup" ? Number(spec.company_stage && spec.company_stage.startup_penalty) || 0 : 0
    };
    const raw = parts.sector + parts.fit + parts.culture + parts.comp + parts.values + parts.dream + parts.stage;
    return { score: clamp(raw), raw, parts, sector, culture, valuesHit: values, dream };
  }
  var VALUES_BY_WEIGHT = { 3: "great", 2: "good", 1: "neutral", 0: "no" };
  var RATINGS = ["great", "good", "neutral", "maybe", "no", "unrated"];
  var rating = (r) => RATINGS.includes(lc(r)) ? lc(r) : null;
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
    const map = { ...VALUES_BY_WEIGHT, ...spec.values_fit && spec.values_fit.by_weight || {} };
    return { rating: rating(map[w]) || VALUES_BY_WEIGHT[w], reason: sector.label + " (weight " + w + ")", source: "computed" };
  }
  function cultureHits(job, spec) {
    const checks = arr(spec && spec.culture_fit && spec.culture_fit.checks);
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    const raw = job.cultureChecks;
    let given;
    if (raw && !Array.isArray(raw) && typeof raw === "object") given = Object.entries(raw).map(([id, note]) => ({ id, note }));
    else given = arr(raw).map((x) => typeof x === "string" ? { id: x } : x);
    if (!given.length) {
      const c = cultureOf(job, spec);
      if (c.red.length && byId.fast_paced) given.push({ id: "fast_paced", note: c.red.join(", ") });
      if (c.good.length && byId.family_benefits) given.push({ id: "family_benefits", note: c.good.join(", ") });
    }
    return given.filter((g) => byId[g.id]).map((g) => ({ ...byId[g.id], note: g.note || "" }));
  }
  function cultureFitOf(job, spec) {
    spec = spec || {};
    const hits = cultureHits(job, spec);
    const points = hits.reduce((n, h) => n + (Number(h.points) || 0), 0);
    const stored = job.cultureFit && rating(job.cultureFit.rating);
    if (stored) return { rating: stored, reason: job.cultureFit.reason || "", points, hits, source: "stored" };
    if (!hits.length) return { rating: "unrated", reason: "Not checked yet.", points: 0, hits, source: "computed" };
    const b = { great: 6, good: 3, maybe: -3, ...spec.culture_fit && spec.culture_fit.bands || {} };
    const r = points >= b.great ? "great" : points >= b.good ? "good" : points >= b.maybe ? "maybe" : "no";
    const plus = hits.filter((h) => h.points > 0).map((h) => h.short || h.id);
    const minus = hits.filter((h) => h.points < 0).map((h) => h.short || h.id);
    const reason = [plus.join(", "), minus.length ? "but " + minus.join(", ") : ""].filter(Boolean).join("; ");
    return { rating: r, reason: reason.charAt(0).toUpperCase() + reason.slice(1) + ".", points, hits, source: "computed" };
  }
  function explain(result) {
    const p = result.parts, out = [];
    const add = (n, label) => {
      if (n) out.push((out.length ? n < 0 ? "\u2212 " : "+ " : n < 0 ? "\u2212" : "") + Math.abs(n) + " " + label);
    };
    add(p.sector, "sector");
    add(p.fit, "experience");
    add(p.culture, "culture signals");
    add(p.comp, "comp");
    add(p.values, "values");
    add(p.dream, "dream role");
    add(p.stage, "startup");
    return out.join(" ") || "0";
  }
  function buildDigest(jobs, spec) {
    spec = spec || {};
    const sc = spec.scoring || {};
    const min = Number(sc.min_score_to_add ?? 0);
    const max = Number(sc.digest_max_items ?? Infinity);
    const caps = sc.per_sector_cap || {};
    const scored = arr(jobs).map((job) => ({ job, match: matchJob(job, spec), result: scoreJob(job, spec) })).filter((x) => x.match.ok && x.result.score >= min).sort((a, b) => b.result.score - a.result.score || String(a.job.company).localeCompare(String(b.job.company)));
    const items = [], extras = {}, perSector = {};
    for (const x of scored) {
      const id = x.result.sector.id;
      const cap = caps[id];
      if (cap != null && (perSector[id] || 0) >= Number(cap)) {
        extras[id] = (extras[id] || 0) + 1;
        continue;
      }
      if (items.length >= max) {
        extras._overflow = (extras._overflow || 0) + 1;
        continue;
      }
      perSector[id] = (perSector[id] || 0) + 1;
      items.push(x);
    }
    return { items, extras, considered: arr(jobs).length, passed: scored.length };
  }
  function scoreSplit(result, job) {
    const p = result.parts;
    return {
      fit: p.fit + p.comp + p.dream,
      values: p.sector + p.values,
      culture: p.culture + p.stage,
      total: result.score,
      max: { fit: FIT_POINTS.strong + COMP_BONUS + DREAM_BONUS, values: 3 * SECTOR_POINTS_PER_WEIGHT, culture: CULTURE_GOOD },
      capped: result.raw > 100 || result.raw < 0,
      cultureRated: !!(job && job.cultureSignals) || result.culture.good.length + result.culture.red.length > 0
    };
  }
  var WORKPLACE_IDS = ["remote_us", "remote_metro", "remote_non_us", "hybrid", "onsite"];
  var WP_LABEL = { remote_us: "Remote (US)", remote_metro: "Remote near a city", remote_non_us: "Remote outside US", hybrid: "Hybrid", onsite: "On-site", unknown: "" };
  var US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
  var US_STATE_NAMES = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming)$/;
  var METROS = ["san francisco", "bay area", "new york", "nyc", "seattle", "boston", "chicago", "austin", "denver", "los angeles", "atlanta", "washington, dc", "miami", "dallas", "houston", "philadelphia", "portland", "salt lake city", "san jose", "palo alto", "mountain view", "oakland", "san diego", "minneapolis", "phoenix", "raleigh", "nashville", "pittsburgh", "detroit", "boulder"];
  var NON_US = /\b(canada|toronto|vancouver|montreal|uk|united kingdom|england|london|ireland|dublin|india|bengaluru|bangalore|europe|emea|apac|latam|germany|berlin|france|paris|spain|netherlands|amsterdam|poland|portugal|israel|australia|sydney|singapore|japan|mexico|brazil|argentina|colombia|philippines|south africa)\b/;
  var US = /\b(us|usa|u\.s\.?a?|united states|north america|nationwide)\b/;
  var HYBRID = /\bhybrid\b/;
  var ONSITE = /\b(on-?site|onsite|in[- ]office|in the office|office[- ]based)\b/;
  var REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/;
  var titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  var notCity = (s) => {
    const t = s.trim().toLowerCase().replace(/[.)]+$/, "");
    return !t || US.test(t) && t.replace(US, "").trim() === "" || US_STATES.includes(t.toUpperCase()) || US_STATE_NAMES.test(t) || REMOTE.test(t) || NON_US.test(t) || /\d/.test(t);
  };
  function remoteCity(loc) {
    const pick = (s) => {
      const first = String(s || "").split(/[,;|/]/)[0].trim();
      return first && !notCity(first) && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(first) ? titleCase(first) : void 0;
    };
    const near = loc.match(/\b(?:within|in)\s+(?:a\s+)?\d{1,3}\s*(?:-|\s)?(?:mi|miles?|km)\b\s*(?:of|from)\s+([^,;()|]+)/i);
    if (near) return pick(near[1]);
    const paren = loc.match(/^(.+?)\s*\(\s*remote\s*\)\s*$/i);
    if (paren) return pick(paren[1]);
    const dash = loc.match(/^remote\s*[-–—:]\s*(.+)$/i);
    if (dash) return pick(dash[1]);
    const cityState = loc.match(/(?:^|[,;(]\s*|remote\s*[-–—,]\s*)([A-Z][A-Za-z .'-]+?),\s*([A-Z]{2})\b/);
    if (cityState && US_STATES.includes(cityState[2])) return pick(cityState[1]);
    const low = loc.toLowerCase(), metro = METROS.find((m) => new RegExp("\\b" + m.replace(/[.,]/g, "\\$&") + "\\b").test(low));
    return metro ? titleCase(metro.replace(/,.*$/, "")).replace(/^Nyc$/, "New York") : void 0;
  }
  var wpOut = (id, city) => id === "remote_metro" && city ? { id, city, label: "Remote near " + city } : { id, label: WP_LABEL[id] };
  function workplaceOf(job) {
    const j = job || {};
    const w = j.workplace;
    if (typeof w === "string" && WORKPLACE_IDS.includes(w)) {
      const city2 = typeof j.workplaceCity === "string" && j.workplaceCity.trim() ? j.workplaceCity.trim() : void 0;
      return wpOut(w, city2);
    }
    const raw = typeof j.location === "string" ? j.location.trim() : "";
    if (!raw) return wpOut("unknown");
    const loc = raw.toLowerCase().replace(/site-to-site/g, "site to site").replace(/\s+/g, " ");
    if (HYBRID.test(loc)) return wpOut("hybrid");
    if (ONSITE.test(loc)) return wpOut("onsite");
    if (!REMOTE.test(loc)) return wpOut("unknown");
    if (NON_US.test(loc) && !US.test(loc)) return wpOut("remote_non_us");
    const limit = /\b(?:within|in)\s+(?:a\s+)?\d{1,3}\s*(?:-|\s)?(?:mi|miles?|km)\b/.test(loc);
    const usWide = US.test(loc) && !limit || raw.split(/;|\|/).some((part) => REMOTE.test(part.toLowerCase()) && !remoteCity(part.trim()));
    const city = usWide ? void 0 : remoteCity(raw);
    return city ? wpOut("remote_metro", city) : wpOut("remote_us");
  }
  return __toCommonJS(scoring_exports);
})();
globalThis.RoleRadarScoring = RoleRadarScoring;
