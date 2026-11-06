/* Role Radar: built from src/progress.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarProgress = (() => {
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

  // src/progress.ts
  var progress_exports = {};
  __export(progress_exports, {
    GATE_TARGET: () => GATE_TARGET,
    RESPONSE_AFTER_DAYS: () => RESPONSE_AFTER_DAYS,
    STAGES: () => STAGES,
    benchmarks: () => benchmarks,
    businessDaysSince: () => businessDaysSince,
    coverageLine: () => coverageLine,
    dashboard: () => dashboard,
    dayKey: () => dayKey,
    dayStart: () => dayStart,
    emailWindow: () => emailWindow,
    homeStats: () => homeStats,
    periodReport: () => periodReport,
    reached: () => reached,
    scanStale: () => scanStale,
    skippedBy: () => skippedBy,
    snapshot: () => snapshot,
    toMs: () => toMs,
    topNew: () => topNew,
    velocity: () => velocity,
    weekStart: () => weekStart
  });
  var STAGES = ["applied", "screen", "interviewing", "offer"];
  var RESPONSE_AFTER_DAYS = 14;
  var DAY = 864e5;
  var st = (j) => j && j.status || "new";
  var lc = (s) => String(s == null ? "" : s).toLowerCase().trim();
  function partsIn(ms, tz) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, s: +o.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
  }
  function zoned(y, m, d, h, tz) {
    const want = Date.UTC(y, m - 1, d, h);
    let t = want;
    for (let i = 0; i < 2; i++) {
      const p = partsIn(t, tz);
      t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    }
    return t;
  }
  function toMs(v, tz) {
    if (v == null || v === "") return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    const dOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dOnly) return zoned(+dOnly[1], +dOnly[2], +dOnly[3], 12, tz);
    return Date.parse(s);
  }
  function dayKey(v, tz) {
    const ms = toMs(v, tz);
    if (isNaN(ms)) return "";
    const p = partsIn(ms, tz);
    return p.y + "-" + String(p.m).padStart(2, "0") + "-" + String(p.d).padStart(2, "0");
  }
  var addDays = (key, n) => {
    const d = /* @__PURE__ */ new Date(key + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  var keyParts = (key) => key.split("-").map(Number);
  function dayStart(now, tz, hour = 0) {
    const p = partsIn(toMs(now, tz), tz);
    return zoned(p.y, p.m, p.d, hour, tz);
  }
  function weekStart(now, tz) {
    const p = partsIn(toMs(now, tz), tz);
    const [y, m, d] = keyParts(addDays(dayKey(now, tz), -((p.wd + 6) % 7)));
    return zoned(y, m, d, 0, tz);
  }
  function emailWindow(now, tz = "America/New_York", hour = 7) {
    const nowMs = toMs(now, tz);
    let to = dayStart(nowMs, tz, hour);
    if (to > nowMs) {
      const [y2, m2, d2] = keyParts(addDays(dayKey(nowMs, tz), -1));
      to = zoned(y2, m2, d2, hour, tz);
    }
    const [y, m, d] = keyParts(addDays(dayKey(to, tz), -1));
    return { from: zoned(y, m, d, hour, tz), to };
  }
  function businessDaysSince(last, now, tz = "America/New_York") {
    const from = dayKey(last, tz), to = dayKey(now, tz);
    if (!from || !to) return null;
    let n = 0;
    for (let k = addDays(from, 1), i = 0; k <= to && i < 400; k = addDays(k, 1), i++) {
      const wd = (/* @__PURE__ */ new Date(k + "T12:00:00Z")).getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  }
  function scanStale(lastRun, now, tz = "America/New_York") {
    const n = businessDaysSince(lastRun, now, tz);
    return n !== null && n >= 2;
  }
  var inRange = (v, from, to, tz) => {
    const t = toMs(v, tz);
    return !isNaN(t) && t >= from && t < to;
  };
  var sentAt = (j) => j.appliedAt || "";
  var startedAt = (j) => st(j) === "applying" ? j.statusAt || "" : "";
  var skipAt = (j) => st(j) === "skipped" ? j.skippedAt || j.statusAt || "" : "";
  var skippedBy = (j) => lc(j && j.skippedBy) === "rule" ? "rule" : "owner";
  var ruledAt = (j) => skippedBy(j) === "owner" ? skipAt(j) : "";
  var removedAt = (j) => skippedBy(j) === "rule" ? skipAt(j) : "";
  var followUps = (j) => Array.isArray(j.followUpsSent) ? j.followUpsSent.filter(Boolean) : [];
  function reached(j) {
    let best = -1;
    const bump = (s) => {
      const i = STAGES.indexOf(s);
      if (i > best) best = i;
    };
    bump(st(j));
    if (Array.isArray(j.statusHistory)) j.statusHistory.forEach((h) => h && bump(h.status));
    if (best < 0 && j.appliedAt) best = 0;
    return best < 0 ? "" : STAGES[best];
  }
  var reachedAtLeast = (j, stage) => STAGES.indexOf(reached(j)) >= STAGES.indexOf(stage);
  var item = (j, at) => ({ id: j._id || "", company: j.company || "", title: j.title || "", at: at || "" });
  var byAt = (tz) => (a, b) => (toMs(a.at, tz) || 0) - (toMs(b.at, tz) || 0);
  var list = (jobs) => Array.isArray(jobs) ? jobs : Object.entries(jobs || {}).map(([k, v]) => ({ _id: k, ...v }));
  function periodReport(jobs, { from, to, tz = "America/New_York", now } = {}) {
    const js = list(jobs);
    const f = toMs(from, tz), t = toMs(to, tz), n = now == null ? t : toMs(now, tz);
    const sent = js.filter((j) => inRange(sentAt(j), f, t, tz)).map((j) => item(j, sentAt(j))).sort(byAt(tz));
    const started = js.filter((j) => st(j) === "applying" && inRange(startedAt(j), f, t, tz)).map((j) => item(j, startedAt(j))).sort(byAt(tz));
    const ruledOut = js.filter((j) => inRange(ruledAt(j), f, t, tz)).map((j) => item(j, ruledAt(j))).sort(byAt(tz));
    const removedByRules = js.filter((j) => inRange(removedAt(j), f, t, tz)).map((j) => ({ ...item(j, removedAt(j)), reason: j.skipReason || "" })).sort(byAt(tz));
    const w = weekStart(n, tz);
    const weekToDate = {
      from: new Date(w).toISOString(),
      to: new Date(n).toISOString(),
      sent: js.filter((j) => inRange(sentAt(j), w, n, tz)).length,
      ruledOut: js.filter((j) => inRange(ruledAt(j), w, n, tz)).length,
      removedByRules: js.filter((j) => inRange(removedAt(j), w, n, tz)).length
    };
    return {
      period: { from: new Date(f).toISOString(), to: new Date(t).toISOString(), tz },
      sent,
      started,
      ruledOut,
      removedByRules,
      counts: { sent: sent.length, started: started.length, ruledOut: ruledOut.length, removedByRules: removedByRules.length },
      weekToDate,
      snapshot: snapshot(js, tz)
    };
  }
  function snapshot(jobs, tz) {
    const js = list(jobs);
    const pick = (ss) => js.filter((j) => ss.includes(st(j))).map((j) => ({ ...item(j, j.statusAt), status: st(j) })).sort(byAt(tz));
    const startedNotSent = pick(["applying"]), sentNoResponse = pick(["applied"]), interviewsOffers = pick(["screen", "interviewing", "offer"]);
    const newUnreviewed = js.filter((j) => st(j) === "new").length;
    return {
      startedNotSent,
      sentNoResponse,
      interviewsOffers,
      counts: { startedNotSent: startedNotSent.length, sentNoResponse: sentNoResponse.length, interviewsOffers: interviewsOffers.length, newUnreviewed }
    };
  }
  function benchmarks(jobs, spec) {
    const like = spec && spec.dream_roles && Array.isArray(spec.dream_roles.like) ? spec.dream_roles.like : [];
    const cos = new Set(like.map((a) => lc(a && a.company)).filter(Boolean));
    return list(jobs).filter((j) => cos.has(lc(j.company))).map((j) => ({ ...item(j, j.statusAt), status: st(j) }));
  }
  function topNew(jobs, n = 4, scoreOf = (j) => j.score) {
    const scored = list(jobs).filter((j) => st(j) === "new").map((j) => ({ ...item(j, j.firstSeen), score: Number(scoreOf(j)) })).filter((x) => !isNaN(x.score)).sort((a, b) => b.score - a.score);
    if (scored.length <= n) return scored;
    const cut = scored[n - 1].score;
    return scored.filter((x) => x.score >= cut);
  }
  function dashboard(jobs, { now = Date.now(), tz, bar = 3 } = {}) {
    const js = list(jobs);
    const n = toMs(now, tz), d0 = dayStart(n, tz), w0 = weekStart(n, tz), todayKey = dayKey(n, tz);
    const [ey, em, ed] = keyParts(addDays(todayKey, 1));
    const dayEnd = zoned(ey, em, ed, 0, tz);
    const applied = js.filter((j) => inRange(sentAt(j), d0, dayEnd, tz)).length;
    const fups = js.reduce((k, j) => k + followUps(j).filter((v) => inRange(v, d0, dayEnd, tz)).length, 0);
    const weekKeys = Array.from({ length: 7 }, (_, i) => addDays(dayKey(w0, tz), i));
    const days = weekKeys.map((key) => ({ day: key, applied: js.filter((j) => dayKey(sentAt(j), tz) === key).length, future: key > todayKey }));
    const funnel = STAGES.map((s) => ({ stage: s, count: js.filter((j) => reachedAtLeast(j, s)).length }));
    const eligible = js.filter((j) => {
      const t = toMs(sentAt(j), tz);
      return !isNaN(t) && n - t >= RESPONSE_AFTER_DAYS * DAY;
    });
    const heard = eligible.filter((j) => reachedAtLeast(j, "screen")).length;
    const due = js.filter((j) => st(j) === "applied" && !!j.followUpDue && j.followUpDue <= todayKey).map((j) => ({ ...item(j, j.followUpDue), due: j.followUpDue })).sort((a, b) => a.due.localeCompare(b.due));
    const monthKey = todayKey.slice(0, 7), mix = /* @__PURE__ */ new Map();
    js.filter((j) => dayKey(sentAt(j), tz).slice(0, 7) === monthKey).forEach((j) => {
      const s = j.sector || "Other";
      mix.set(s, (mix.get(s) || 0) + 1);
    });
    return {
      today: { applied, followUps: fups, total: applied + fups, bar, met: applied + fups >= bar },
      week: { applied: js.filter((j) => inRange(sentAt(j), w0, dayEnd, tz)).length, ruledOut: js.filter((j) => inRange(ruledAt(j), w0, dayEnd, tz)).length, removedByRules: js.filter((j) => inRange(removedAt(j), w0, dayEnd, tz)).length, days },
      funnel,
      response: { heard, eligible: eligible.length, pct: eligible.length ? Math.round(heard / eligible.length * 100) : null, afterDays: RESPONSE_AFTER_DAYS },
      followUpsDue: due,
      sectorMix: [...mix.entries()].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector))
    };
  }
  function homeStats(jobs, { now = Date.now(), tz = "America/New_York" } = {}) {
    const h = { todo: 0, inProgress: 0, done: 0, doneThisWeek: 0, stages: { applied: 0, screen: 0, interviewing: 0, offer: 0 }, closed: 0, newToReview: 0 };
    const n = toMs(now, tz), w0 = weekStart(n, tz), w1 = weekStart(n + 7 * DAY, tz);
    for (const j of list(jobs)) {
      const s = st(j), done = reached(j) !== "";
      if (s === "saved") h.todo++;
      else if (s === "applying") h.inProgress++;
      else if (STAGES.includes(s)) h.stages[s]++;
      else if ((s === "rejected" || s === "closed") && done) h.closed++;
      else if (s === "new" || s === "viewed") h.newToReview++;
      if (done) {
        h.done++;
        if (inRange(sentAt(j), w0, w1, tz)) h.doneThisWeek++;
      }
    }
    return h;
  }
  function coverageLine(coverage, companies) {
    if (!coverage || typeof coverage !== "object") return null;
    const cv = coverage;
    const num2 = (v) => Number(v) || 0;
    const total = num2(cv.attempted);
    let failing;
    if (companies && typeof companies === "object") {
      const cos = Array.isArray(companies) ? companies : Object.values(companies);
      failing = cos.filter((c) => c && c.status !== "vetoed" && num2(c.failStreak) > 0).length;
    } else failing = num2(cv.failed) || (Array.isArray(cv.failedList) ? cv.failedList.length : 0);
    return { text: failing ? `${total - failing} of ${total} boards OK \xB7 ${failing} failing` : `${total} boards read \xB7 all OK`, failing };
  }
  var GATE_TARGET = 5;
  var median = (xs) => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y), m = a.length >> 1;
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2 * 10) / 10;
  };
  var num = (v) => typeof v === "number" && isFinite(v) ? v : null;
  function velocity(jobs, { now = Date.now(), tz, days = 14 } = {}) {
    const js = list(jobs), todayKey = dayKey(toMs(now, tz), tz);
    const keys = Array.from({ length: days }, (_, i) => addDays(todayKey, i - days + 1));
    const perDay = keys.map((day) => ({ day, applied: js.filter((j) => dayKey(sentAt(j), tz) === day).length }));
    const applied = perDay.reduce((k, x) => k + x.applied, 0);
    const rows = js.filter((j) => j.effort && typeof j.effort === "object").map((j) => {
      const e = j.effort, a = toMs(e.startedAt, tz), b = toMs(e.readyAt, tz);
      const hours = !isNaN(a) && !isNaN(b) && b >= a ? Math.round((b - a) / 36e5 * 10) / 10 : null;
      return { id: j._id || "", company: j.company || "", hours, gateRuns: num(e.gateRuns), tokensK: num(e.tokensK), ready: isNaN(b) ? 0 : b };
    }).filter((r) => r.hours !== null || r.gateRuns !== null || r.tokensK !== null);
    const col = (k) => median(rows.map((r) => r[k]).filter((v) => v !== null));
    return {
      perDay,
      avgPerDay: Math.round(applied / days * 10) / 10,
      sampled: rows.length,
      medianHours: col("hours"),
      medianGateRuns: col("gateRuns"),
      medianTokensK: col("tokensK"),
      gateTarget: GATE_TARGET,
      recent: [...rows].sort((a, b) => b.ready - a.ready).slice(0, 6).map(({ ready, ...r }) => r)
    };
  }
  return __toCommonJS(progress_exports);
})();
globalThis.RoleRadarProgress = RoleRadarProgress;
