/* Role Radar scoring: the rules in criteria.yaml, as code.
 * One source of truth for the page (score breakdowns, digest preview) and the tests.
 * The weekday scan follows the same rules in its prompt; tests/scoring.test.ts pins them down.
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
 * scoreSplit groups the same parts as Fit (fit + comp + dream), Values (sector + values) and Culture (culture + stage).
 *
 * ES module. scripts/build.mjs bundles it to build/scoring.js, a classic script that sets window.RoleRadarScoring. */

/** One value or a list of them, as YAML allows. */
export type Many<T> = T | T[] | null | undefined;
type Num = number | string | null | undefined;

export interface Sector { id: string; label?: string; weight?: Num; examples?: Many<string>; keywords?: Many<string> }
export interface DreamAnchor { company?: string; title?: string; check?: string | null }
export interface CultureCheck { id: string; short?: string; points?: number }
export interface StoredFit { rating?: string; reason?: string }

/** criteria.yaml, as loaded. Every block is optional; junk is tolerated, never trusted. */
export interface Criteria {
  sectors?: Many<Sector>;
  default_sector_weight?: Num;
  role?: { title_include?: Many<string>; title_exclude?: Many<string> };
  work?: { hybrid_ok_near?: Many<string> };
  comp?: { base_floor_usd?: number; priority_sector_floor_usd?: number; stretch_target_usd?: number };
  hard_exclude?: { companies?: Many<string>; business_models?: Many<string> };
  culture?: { good_signals?: Many<string>; red_flags?: Many<string>; hard_red_flags?: Many<string>; red_flag_effect?: string };
  values_penalty?: Many<string>;
  dream_roles?: { like?: Many<DreamAnchor>; in_sectors?: Many<string>; role_keywords?: Many<string>; bonus?: Num };
  company_stage?: { startup_penalty?: Num };
  values_fit?: { by_weight?: Record<string, string> };
  culture_fit?: { checks?: Many<CultureCheck>; bands?: { great?: number; good?: number; maybe?: number } };
  scoring?: { min_score_to_add?: Num; digest_max_items?: Num; per_sector_cap?: Record<string, Num> };
  [key: string]: unknown;
}

/** A role as the scan and the page store it. Only the fields scoring reads. */
export interface Job {
  _id?: string;
  title?: string;
  company?: string;
  team?: string;
  industry?: string;
  sector?: string;
  businessModel?: string;
  location?: string;
  postingText?: string;
  comp?: unknown;
  fit?: string;
  companyStage?: string;
  cultureSignals?: { good?: Many<string>; red?: Many<string> } | null;
  /** culture_fit check ids, or {id: note}. */
  cultureChecks?: unknown;
  valuesFit?: StoredFit | null;
  cultureFit?: StoredFit | null;
  [key: string]: unknown;
}

export interface CompRange { min: number; max: number }
export interface Match { ok: boolean; reasons: string[] }
export interface Culture { points: number; good: string[]; red: string[] }
export interface Dream { why: string; check: string | null }
export interface Parts { sector: number; fit: number; culture: number; comp: number; values: number; dream: number; stage: number }
export interface ScoreResult { score: number; raw: number; parts: Parts; sector: Sector; culture: Culture; valuesHit: string | null; dream: Dream | null }
export interface Fit { rating: string; reason: string; source: "stored" | "computed" }
export interface CultureHit extends CultureCheck { note: string }
export interface CultureFit extends Fit { points: number; hits: CultureHit[] }
export interface DigestItem { job: Job; match: Match; result: ScoreResult }
export interface Digest { items: DigestItem[]; extras: Record<string, number>; considered: number; passed: number }

export const FIT_POINTS = { strong: 35, maybe: 20, stretch: 5 };
const SECTOR_POINTS_PER_WEIGHT = 15;
const CULTURE_GOOD = 10, CULTURE_RED = -10, CULTURE_FLOOR = -20;
const COMP_BONUS = 10, VALUES_PENALTY = -15, DREAM_BONUS = 15;

const lc = (s: unknown): string => String(s == null ? "" : s).toLowerCase();
const arr = <T>(a: Many<T> | ""): T[] => (Array.isArray(a) ? a : a == null || a === "" ? [] : [a as T]);
const has = (hay: unknown, needle: unknown): boolean => {
  const n = lc(needle).trim();
  if (!n) return false;
  // Whole-word-ish match so "PV" doesn't hit "provider".
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])").test(lc(hay));
};
const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** "$170K–$205K", "$160,000 - $180,000", "170k" → {min, max} in dollars, or null. */
export function parseComp(comp: unknown): CompRange | null {
  if (comp && typeof comp === "object") {
    const o = comp as { min?: unknown; max?: unknown };
    // null, "" and 0 mean "not stated", not $0.
    const num = (v: unknown): number => (v == null || v === "" ? NaN : Number(v) > 0 ? Number(v) : NaN);
    const min = num(o.min), max = num(o.max);
    if (isFinite(min) || isFinite(max)) return { min: isFinite(min) ? min : max, max: isFinite(max) ? max : min };
    return null;
  }
  const nums: number[] = [];
  // A 401(k) is a retirement plan, not a $401K salary.
  String(comp == null ? "" : comp).replace(/\b401\s*\(?k\)?/gi, " ").replace(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kKmM]?)/g, (_: string, n: string, unit: string) => {
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
export function sectorFor(job: Job, spec: Criteria | null | undefined): Sector {
  const sectors = arr(spec && spec.sectors);
  const fallback: Sector = { id: "default", label: "Other", weight: Number((spec && spec.default_sector_weight) ?? 1) };
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

function cultureOf(job: Job, spec: Criteria | null | undefined): Culture {
  const c = (spec && spec.culture) || {};
  let good: string[], red: string[];
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
function dreamOf(job: Job, spec: Criteria | null | undefined, sector: Sector): Dream | null {
  const d = (spec && spec.dream_roles) || {};
  const like = arr(d.like).filter((a) => a && lc(a.company).trim());
  const anchor = like.find((a) => lc(job.company).trim() === lc(a.company).trim());
  if (anchor) return { why: "like " + anchor.company + (anchor.title ? " " + anchor.title : ""), check: anchor.check || null };
  const inSector = arr(d.in_sectors).some((id) => lc(id) === lc(sector && sector.id));
  const kw = inSector && arr(d.role_keywords).find((k) => has([job.title, job.team].join(" "), k));
  return kw ? { why: kw + " role in " + (sector.label || sector.id), check: null } : null;
}

function valuesHit(job: Job, spec: Criteria | null | undefined): string | null {
  const hay = [job.businessModel, job.industry, job.company].join(" ");
  return arr(spec && spec.values_penalty).find((v) => has(hay, v)) || null;
}

/** Hard gates. Returns {ok, reasons}. A failing job is never added, whatever it would score. */
export function matchJob(job: Job, spec?: Criteria | null): Match {
  spec = spec || {};
  const reasons: string[] = [];
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
export function scoreJob(job: Job, spec?: Criteria | null): ScoreResult {
  spec = spec || {};
  const sector = sectorFor(job, spec);
  const weight = Math.max(0, Math.min(3, Number(sector.weight) || 0));
  const fitKey = lc(job.fit);
  const culture = cultureOf(job, spec);
  const range = parseComp(job.comp);
  const target = spec.comp && spec.comp.stretch_target_usd;
  const values = valuesHit(job, spec);
  const dream = dreamOf(job, spec, sector);
  const parts: Parts = {
    sector: weight * SECTOR_POINTS_PER_WEIGHT,
    fit: (FIT_POINTS as Record<string, number | undefined>)[fitKey] || 0,
    culture: culture.points,
    comp: range && target && range.max >= target ? COMP_BONUS : 0,
    values: values ? VALUES_PENALTY : 0,
    // A dream match means dream_roles is there: dreamOf found an anchor or keyword in it.
    dream: dream ? Number(spec.dream_roles!.bonus ?? DREAM_BONUS) || 0 : 0,
    stage: lc(job.companyStage) === "startup" ? Number(spec.company_stage && spec.company_stage.startup_penalty) || 0 : 0,
  };
  const raw = parts.sector + parts.fit + parts.culture + parts.comp + parts.values + parts.dream + parts.stage;
  return { score: clamp(raw), raw, parts, sector, culture, valuesHit: values, dream };
}

const VALUES_BY_WEIGHT: Record<number, string> = { 3: "great", 2: "good", 1: "neutral", 0: "no" };
const RATINGS = ["great", "good", "neutral", "maybe", "no", "unrated"];
const rating = (r: unknown): string | null => (RATINGS.includes(lc(r)) ? lc(r) : null);

/** Values badge: does the business match what the candidate cares about?
 *  A stored job.valuesFit {rating, reason} wins; otherwise hard excludes and values_penalty say "no",
 *  and the sector weight picks the rest (values_fit.by_weight). */
export function valuesFitOf(job: Job, spec?: Criteria | null): Fit {
  spec = spec || {};
  const stored = job.valuesFit && rating(job.valuesFit.rating);
  if (stored) return { rating: stored, reason: job.valuesFit!.reason || "", source: "stored" };
  const gate = matchJob(job, spec).reasons.find((r) => /hard_exclude|business model/.test(r));
  if (gate) return { rating: "no", reason: gate, source: "computed" };
  const hit = valuesHit(job, spec);
  if (hit) return { rating: "no", reason: "on values_penalty: " + hit, source: "computed" };
  const sector = sectorFor(job, spec);
  const w = Math.max(0, Math.min(3, Number(sector.weight) || 0));
  const map: Record<number, string> = { ...VALUES_BY_WEIGHT, ...((spec.values_fit && spec.values_fit.by_weight) || {}) };
  return { rating: rating(map[w]) || VALUES_BY_WEIGHT[w], reason: sector.label + " (weight " + w + ")", source: "computed" };
}

/** Which culture_fit checks apply: job.cultureChecks (ids, or {id: note}), else a rough read of cultureSignals. */
function cultureHits(job: Job, spec: Criteria): CultureHit[] {
  const checks = arr(spec && spec.culture_fit && spec.culture_fit.checks);
  const byId: Record<string, CultureCheck | undefined> = Object.fromEntries(checks.map((c) => [c.id, c]));
  type Given = { id: string; note?: unknown };
  const raw = job.cultureChecks;
  let given: Given[];
  if (raw && !Array.isArray(raw) && typeof raw === "object") given = Object.entries(raw).map(([id, note]) => ({ id, note }));
  else given = arr(raw as Many<string | Given>).map((x) => (typeof x === "string" ? { id: x } : x));
  if (!given.length) {
    const c = cultureOf(job, spec);
    if (c.red.length && byId.fast_paced) given.push({ id: "fast_paced", note: c.red.join(", ") });
    if (c.good.length && byId.family_benefits) given.push({ id: "family_benefits", note: c.good.join(", ") });
  }
  return given.filter((g) => byId[g.id]).map((g) => ({ ...byId[g.id]!, note: (g.note || "") as string }));
}

/** Culture badge: sum the culture_fit checks that apply and band the total.
 *  A stored job.cultureFit {rating, reason} wins (intake research); no checks at all → "unrated". */
export function cultureFitOf(job: Job, spec?: Criteria | null): CultureFit {
  spec = spec || {};
  const hits = cultureHits(job, spec);
  const points = hits.reduce((n, h) => n + (Number(h.points) || 0), 0);
  const stored = job.cultureFit && rating(job.cultureFit.rating);
  if (stored) return { rating: stored, reason: job.cultureFit!.reason || "", points, hits, source: "stored" };
  if (!hits.length) return { rating: "unrated", reason: "Not checked yet.", points: 0, hits, source: "computed" };
  const b = { great: 6, good: 3, maybe: -3, ...((spec.culture_fit && spec.culture_fit.bands) || {}) };
  const r = points >= b.great ? "great" : points >= b.good ? "good" : points >= b.maybe ? "maybe" : "no";
  const plus = hits.filter((h) => h.points! > 0).map((h) => h.short || h.id);
  const minus = hits.filter((h) => h.points! < 0).map((h) => h.short || h.id);
  const reason = [plus.join(", "), minus.length ? "but " + minus.join(", ") : ""].filter(Boolean).join("; ");
  return { rating: r, reason: reason.charAt(0).toUpperCase() + reason.slice(1) + ".", points, hits, source: "computed" };
}

/** "45 sector + 35 experience + 10 comp" — the parts that moved the score.
 *  "fit" is stored as strong/maybe/stretch but shown as experience strong/partial/stretch,
 *  so it doesn't read as the overall verdict next to the score. */
export function explain(result: { parts: Parts }): string {
  const p = result.parts, out: string[] = [];
  const add = (n: number, label: string) => { if (n) out.push((out.length ? (n < 0 ? "− " : "+ ") : n < 0 ? "−" : "") + Math.abs(n) + " " + label); };
  add(p.sector, "sector"); add(p.fit, "experience"); add(p.culture, "culture signals"); add(p.comp, "comp"); add(p.values, "values"); add(p.dream, "dream role"); add(p.stage, "startup");
  return out.join(" ") || "0";
}

/** The morning digest: matching jobs at or above min_score_to_add, best first,
 *  at most digest_max_items, with per_sector_cap limits. Capped extras are counted, not dropped. */
export function buildDigest(jobs: Many<Job>, spec?: Criteria | null): Digest {
  spec = spec || {};
  const sc = spec.scoring || {};
  const min = Number(sc.min_score_to_add ?? 0);
  const max = Number(sc.digest_max_items ?? Infinity);
  const caps = sc.per_sector_cap || {};
  const scored = arr(jobs)
    .map((job) => ({ job, match: matchJob(job, spec), result: scoreJob(job, spec) }))
    .filter((x) => x.match.ok && x.result.score >= min)
    .sort((a, b) => b.result.score - a.result.score || String(a.job.company).localeCompare(String(b.job.company)));
  const items: DigestItem[] = [], extras: Record<string, number> = {}, perSector: Record<string, number> = {};
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

/** The score grouped the way the page shows it. The groups sum to result.raw; total is the clamped score. */
export interface ScoreSplit {
  fit: number; values: number; culture: number; total: number;
  max: { fit: number; values: number; culture: number };
  /** The raw total was above 100 or below 0, so total was clamped. */
  capped: boolean;
  /** False when there was no culture data at all (no stored cultureSignals, nothing found in postingText). */
  cultureRated: boolean;
}

/** Splits a scoreJob result into Fit (experience + comp + dream), Values (sector + values penalty)
 *  and Culture (culture signals + startup stage). Re-groups the same parts; adds and re-scales nothing. */
export function scoreSplit(result: ScoreResult, job?: Job | null): ScoreSplit {
  const p = result.parts;
  return {
    fit: p.fit + p.comp + p.dream,
    values: p.sector + p.values,
    culture: p.culture + p.stage,
    total: result.score,
    max: { fit: FIT_POINTS.strong + COMP_BONUS + DREAM_BONUS, values: 3 * SECTOR_POINTS_PER_WEIGHT, culture: CULTURE_GOOD },
    capped: result.raw > 100 || result.raw < 0,
    cultureRated: !!(job && job.cultureSignals) || result.culture.good.length + result.culture.red.length > 0,
  };
}

// ---- Workplace: where the work happens, from the scan's workplace id or the location text (RR-FA, docs/settings.md). ----
type WorkplaceId = "remote_us" | "remote_metro" | "remote_non_us" | "hybrid" | "onsite" | "unknown";
export interface Workplace { id: WorkplaceId; city?: string; label: string }
/** The ids the scan writes on job.workplace (from 2026-11-01), in the order the Work filter lists them. */
const WORKPLACE_IDS: readonly WorkplaceId[] = ["remote_us", "remote_metro", "remote_non_us", "hybrid", "onsite"];
const WP_LABEL: Record<WorkplaceId, string> = { remote_us: "Remote (US)", remote_metro: "Remote near a city", remote_non_us: "Remote outside US", hybrid: "Hybrid", onsite: "On-site", unknown: "" };
const US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
const US_STATE_NAMES = /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington state|west virginia|wisconsin|wyoming)$/;
/** Big US metros a "remote" posting is often tied to, for locations that name only the city. */
const METROS = ["san francisco", "bay area", "new york", "nyc", "seattle", "boston", "chicago", "austin", "denver", "los angeles", "atlanta", "washington, dc", "miami", "dallas", "houston", "philadelphia", "portland", "salt lake city", "san jose", "palo alto", "mountain view", "oakland", "san diego", "minneapolis", "phoenix", "raleigh", "nashville", "pittsburgh", "detroit", "boulder"];
const NON_US = /\b(canada|toronto|vancouver|montreal|uk|united kingdom|england|london|ireland|dublin|india|bengaluru|bangalore|europe|emea|apac|latam|germany|berlin|france|paris|spain|netherlands|amsterdam|poland|portugal|israel|australia|sydney|singapore|japan|mexico|brazil|argentina|colombia|philippines|south africa)\b/;
const US = /\b(us|usa|u\.s\.?a?|united states|north america|nationwide)\b/;
const HYBRID = /\bhybrid\b/;
const ONSITE = /\b(on-?site|onsite|in[- ]office|in the office|office[- ]based)\b/;
const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/;
const titleCase = (s: string): string => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** A place name that is the country or a state, not a city. */
const notCity = (s: string): boolean => {
  const t = s.trim().toLowerCase().replace(/[.)]+$/, "");
  return !t || US.test(t) && t.replace(US, "").trim() === "" || US_STATES.includes(t.toUpperCase()) || US_STATE_NAMES.test(t) || REMOTE.test(t) || NON_US.test(t) || /\d/.test(t);
};
/** The city a "remote" location is tied to: "San Francisco, CA (Remote)", "Remote - New York", "within 50 miles of Chicago". */
function remoteCity(loc: string): string | undefined {
  const pick = (s: string | undefined): string | undefined => {
    const first = String(s || "").split(/[,;|/]/)[0].trim();
    return first && !notCity(first) && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(first) ? titleCase(first) : undefined;
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
  return metro ? titleCase(metro.replace(/,.*$/, "")).replace(/^Nyc$/, "New York") : undefined;
}
const wpOut = (id: WorkplaceId, city?: string): Workplace => (id === "remote_metro" && city ? { id, city, label: "Remote near " + city } : { id, label: WP_LABEL[id] });

/** Where a role is worked. A known job.workplace from the scan wins (job.workplaceCity names the city for remote_metro);
 *  otherwise the location text decides. Hybrid and on-site words beat "remote"; "site-to-site" is not on-site. */
export function workplaceOf(job: Job | null | undefined): Workplace {
  const j = job || {};
  const w = j.workplace;
  if (typeof w === "string" && (WORKPLACE_IDS as readonly string[]).includes(w)) {
    const city = typeof j.workplaceCity === "string" && j.workplaceCity.trim() ? j.workplaceCity.trim() : undefined;
    return wpOut(w as WorkplaceId, city);
  }
  const raw = typeof j.location === "string" ? j.location.trim() : "";
  if (!raw) return wpOut("unknown");
  const loc = raw.toLowerCase().replace(/site-to-site/g, "site to site").replace(/\s+/g, " ");
  if (HYBRID.test(loc)) return wpOut("hybrid");
  if (ONSITE.test(loc)) return wpOut("onsite");
  if (!REMOTE.test(loc)) return wpOut("unknown");
  if (NON_US.test(loc) && !US.test(loc)) return wpOut("remote_non_us");
  // A US-wide part ("Remote, US; New York, NY") keeps it US-wide.
  // Naming the country ("Remote, US (HQ in Boston)") keeps it US-wide unless a distance limit is stated.
  const limit = /\b(?:within|in)\s+(?:a\s+)?\d{1,3}\s*(?:-|\s)?(?:mi|miles?|km)\b/.test(loc);
  const usWide = (US.test(loc) && !limit) || raw.split(/;|\|/).some((part) => REMOTE.test(part.toLowerCase()) && !remoteCity(part.trim()));
  const city = usWide ? undefined : remoteCity(raw);
  return city ? wpOut("remote_metro", city) : wpOut("remote_us");
}
