/* Role Radar progress: the job-search numbers, as code.
 * One source of truth for the Progress tab and the daily family email, which reads the same jobs and calls
 * periodReport() instead of keeping its own rules. tests/progress.test.mjs pins the definitions down.
 *
 *   sent        = appliedAt (submitted to the employer)
 *   started     = status "applying", dated by statusAt (materials in progress, not submitted)
 *   ruled out   = status "skipped" by the owner (skippedBy "owner" or unset), dated by skippedAt, else statusAt:
 *                 the owner reviewed the role and decided not to pursue it (the page's Skip, or an intake No)
 *   removed by rules = status "skipped" with skippedBy "rule": a scan or a criteria cleanup took it out, not the owner
 *   follow-up   = each date in followUpsSent
 *   reached     = the furthest pipeline step a role got to: its current status, plus statusHistory once a role
 *                 has one (a role that went Screen, then Rejected, still counts as reaching Screen)
 *
 * Periods are [from, to): start inclusive, end exclusive. Day and week edges are wall-clock times in a time zone
 * (tz, e.g. "America/New_York"; omitted = the viewer's own zone), so they stay right across DST changes.
 * A date-only value ("2026-10-26") counts as noon that day in tz.
 *
 * Classic script: sets window.RoleRadarProgress in the browser, module.exports in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoleRadarProgress = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STAGES = ["applied", "screen", "interviewing", "offer"];
  const RESPONSE_AFTER_DAYS = 14;
  const DAY = 864e5;

  const st = (j) => (j && j.status) || "new";
  const lc = (s) => String(s == null ? "" : s).toLowerCase().trim();

  // Wall-clock parts of an instant in a zone.
  function partsIn(ms, tz) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, s: +o.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
  }
  // The instant when the wall clock in tz reads y-m-d h:00. Two passes settle the offset on DST days.
  function zoned(y, m, d, h, tz) {
    const want = Date.UTC(y, m - 1, d, h);
    let t = want;
    for (let i = 0; i < 2; i++) {
      const p = partsIn(t, tz);
      t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    }
    return t;
  }
  /** Milliseconds for an ISO timestamp, a date-only string (noon in tz) or a number; NaN when unreadable. */
  function toMs(v, tz) {
    if (v == null || v === "") return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim();
    const dOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dOnly) return zoned(+dOnly[1], +dOnly[2], +dOnly[3], 12, tz);
    return Date.parse(s);
  }
  /** "YYYY-MM-DD" of an instant in tz. */
  function dayKey(v, tz) {
    const ms = toMs(v, tz);
    if (isNaN(ms)) return "";
    const p = partsIn(ms, tz);
    return p.y + "-" + String(p.m).padStart(2, "0") + "-" + String(p.d).padStart(2, "0");
  }
  const addDays = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const keyParts = (key) => key.split("-").map(Number);
  /** Start of the day containing now, in tz, at hour (default midnight). */
  function dayStart(now, tz, hour = 0) {
    const p = partsIn(toMs(now, tz), tz);
    return zoned(p.y, p.m, p.d, hour, tz);
  }
  /** Monday 12:00am of the week containing now, in tz. */
  function weekStart(now, tz) {
    const p = partsIn(toMs(now, tz), tz);
    const [y, m, d] = keyParts(addDays(dayKey(now, tz), -((p.wd + 6) % 7)));
    return zoned(y, m, d, 0, tz);
  }
  /** The last full hour-to-hour window ending at or before now (the family email: 7am to 7am, America/New_York). */
  function emailWindow(now, tz = "America/New_York", hour = 7) {
    const nowMs = toMs(now, tz);
    let to = dayStart(nowMs, tz, hour);
    if (to > nowMs) { const [y, m, d] = keyParts(addDays(dayKey(nowMs, tz), -1)); to = zoned(y, m, d, hour, tz); }
    const [y, m, d] = keyParts(addDays(dayKey(to, tz), -1));
    return { from: zoned(y, m, d, hour, tz), to };
  }

  /** Weekdays (Mon-Fri) after the day of `last` up to and including the day of `now`, in tz; null when unreadable. */
  function businessDaysSince(last, now, tz = "America/New_York") {
    const from = dayKey(last, tz), to = dayKey(now, tz);
    if (!from || !to) return null;
    let n = 0;
    for (let k = addDays(from, 1), i = 0; k <= to && i < 400; k = addDays(k, 1), i++) {
      const wd = new Date(k + "T12:00:00Z").getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  }
  /** The weekday scan is overdue once a whole weekday has gone by without it: 2+ business days since the last run.
   *  Friday's run is still fresh all Monday; Monday's is stale on Wednesday. */
  function scanStale(lastRun, now, tz = "America/New_York") {
    const n = businessDaysSince(lastRun, now, tz);
    return n !== null && n >= 2;
  }

  const inRange = (v, from, to, tz) => { const t = toMs(v, tz); return !isNaN(t) && t >= from && t < to; };
  const sentAt = (j) => j.appliedAt || "";
  const startedAt = (j) => (st(j) === "applying" ? j.statusAt || "" : "");
  const skipAt = (j) => (st(j) === "skipped" ? j.skippedAt || j.statusAt || "" : "");
  /** Who skipped a role: "rule" only when the record says so; older skips without the field were the owner's. */
  const skippedBy = (j) => (lc(j && j.skippedBy) === "rule" ? "rule" : "owner");
  const ruledAt = (j) => (skippedBy(j) === "owner" ? skipAt(j) : "");
  const removedAt = (j) => (skippedBy(j) === "rule" ? skipAt(j) : "");
  const followUps = (j) => (Array.isArray(j.followUpsSent) ? j.followUpsSent.filter(Boolean) : []);

  /** The furthest pipeline step a role reached, "" when it never got to Applied. */
  function reached(j) {
    let best = -1;
    const bump = (s) => { const i = STAGES.indexOf(s); if (i > best) best = i; };
    bump(st(j));
    if (Array.isArray(j.statusHistory)) j.statusHistory.forEach((h) => h && bump(h.status));
    if (best < 0 && j.appliedAt) best = 0;
    return best < 0 ? "" : STAGES[best];
  }
  const reachedAtLeast = (j, stage) => STAGES.indexOf(reached(j)) >= STAGES.indexOf(stage);

  const item = (j, at) => ({ id: j._id || "", company: j.company || "", title: j.title || "", at: at || "" });
  const byAt = (tz) => (a, b) => (toMs(a.at, tz) || 0) - (toMs(b.at, tz) || 0);

  /** The jobs as a list, whether given as an array or an id → doc map. */
  const list = (jobs) => (Array.isArray(jobs) ? jobs : Object.entries(jobs || {}).map(([k, v]) => ({ _id: k, ...v })));

  /**
   * Everything the family email shows for one period. Counts always equal the list lengths, and every key is
   * present even when empty. A role started and sent in the same period is listed only under sent.
   */
  function periodReport(jobs, { from, to, tz = "America/New_York", now } = {}) {
    const js = list(jobs);
    const f = toMs(from, tz), t = toMs(to, tz), n = now == null ? t : toMs(now, tz);
    const sent = js.filter((j) => inRange(sentAt(j), f, t, tz)).map((j) => item(j, sentAt(j))).sort(byAt(tz));
    const started = js.filter((j) => st(j) === "applying" && inRange(startedAt(j), f, t, tz)).map((j) => item(j, startedAt(j))).sort(byAt(tz));
    const ruledOut = js.filter((j) => inRange(ruledAt(j), f, t, tz)).map((j) => item(j, ruledAt(j))).sort(byAt(tz));
    const removedByRules = js.filter((j) => inRange(removedAt(j), f, t, tz)).map((j) => ({ ...item(j, removedAt(j)), reason: j.skipReason || "" })).sort(byAt(tz));
    const w = weekStart(n, tz);
    const weekToDate = {
      from: new Date(w).toISOString(), to: new Date(n).toISOString(),
      sent: js.filter((j) => inRange(sentAt(j), w, n, tz)).length,
      ruledOut: js.filter((j) => inRange(ruledAt(j), w, n, tz)).length,
      removedByRules: js.filter((j) => inRange(removedAt(j), w, n, tz)).length,
    };
    return {
      period: { from: new Date(f).toISOString(), to: new Date(t).toISOString(), tz },
      sent, started, ruledOut, removedByRules,
      counts: { sent: sent.length, started: started.length, ruledOut: ruledOut.length, removedByRules: removedByRules.length },
      weekToDate,
      snapshot: snapshot(js, tz),
    };
  }

  /** Where things stand right now, from current statuses. */
  function snapshot(jobs, tz) {
    const js = list(jobs);
    const pick = (ss) => js.filter((j) => ss.includes(st(j))).map((j) => ({ ...item(j, j.statusAt), status: st(j) })).sort(byAt(tz));
    const startedNotSent = pick(["applying"]), sentNoResponse = pick(["applied"]), interviewsOffers = pick(["screen", "interviewing", "offer"]);
    const newUnreviewed = js.filter((j) => st(j) === "new").length;
    return {
      startedNotSent, sentNoResponse, interviewsOffers,
      counts: { startedNotSent: startedNotSent.length, sentNoResponse: sentNoResponse.length, interviewsOffers: interviewsOffers.length, newUnreviewed },
    };
  }

  /** Roles at the dream_roles anchor companies (criteria.yaml), with their current status and its date. */
  function benchmarks(jobs, spec) {
    const like = (spec && spec.dream_roles && Array.isArray(spec.dream_roles.like)) ? spec.dream_roles.like : [];
    const cos = new Set(like.map((a) => lc(a && a.company)).filter(Boolean));
    return list(jobs).filter((j) => cos.has(lc(j.company))).map((j) => ({ ...item(j, j.statusAt), status: st(j) }));
  }

  /** The n highest-scored roles still in New; roles tied with the nth are kept, never cut. */
  function topNew(jobs, n = 4, scoreOf = (j) => j.score) {
    const scored = list(jobs).filter((j) => st(j) === "new").map((j) => ({ ...item(j, j.firstSeen), score: Number(scoreOf(j)) }))
      .filter((x) => !isNaN(x.score)).sort((a, b) => b.score - a.score);
    if (scored.length <= n) return scored;
    const cut = scored[n - 1].score;
    return scored.filter((x) => x.score >= cut);
  }

  /**
   * The Progress tab. now and tz default to the viewer's clock and zone; bar is the daily goal
   * (applications plus follow-ups).
   */
  function dashboard(jobs, { now = Date.now(), tz, bar = 3 } = {}) {
    const js = list(jobs);
    const n = toMs(now, tz), d0 = dayStart(n, tz), w0 = weekStart(n, tz), todayKey = dayKey(n, tz);
    const dayEnd = zoned(...keyParts(addDays(todayKey, 1)), 0, tz);
    const applied = js.filter((j) => inRange(sentAt(j), d0, dayEnd, tz)).length;
    const fups = js.reduce((k, j) => k + followUps(j).filter((v) => inRange(v, d0, dayEnd, tz)).length, 0);
    const weekKeys = Array.from({ length: 7 }, (_, i) => addDays(dayKey(w0, tz), i));
    const days = weekKeys.map((key) => ({ day: key, applied: js.filter((j) => dayKey(sentAt(j), tz) === key).length, future: key > todayKey }));
    const funnel = STAGES.map((s) => ({ stage: s, count: js.filter((j) => reachedAtLeast(j, s)).length }));
    const eligible = js.filter((j) => { const t = toMs(sentAt(j), tz); return !isNaN(t) && n - t >= RESPONSE_AFTER_DAYS * DAY; });
    const heard = eligible.filter((j) => reachedAtLeast(j, "screen")).length;
    const due = js.filter((j) => st(j) === "applied" && j.followUpDue && j.followUpDue <= todayKey)
      .map((j) => ({ ...item(j, j.followUpDue), due: j.followUpDue })).sort((a, b) => a.due.localeCompare(b.due));
    const monthKey = todayKey.slice(0, 7), mix = new Map();
    js.filter((j) => dayKey(sentAt(j), tz).slice(0, 7) === monthKey).forEach((j) => { const s = j.sector || "Other"; mix.set(s, (mix.get(s) || 0) + 1); });
    return {
      today: { applied, followUps: fups, total: applied + fups, bar, met: applied + fups >= bar },
      week: { applied: js.filter((j) => inRange(sentAt(j), w0, dayEnd, tz)).length, ruledOut: js.filter((j) => inRange(ruledAt(j), w0, dayEnd, tz)).length, removedByRules: js.filter((j) => inRange(removedAt(j), w0, dayEnd, tz)).length, days },
      funnel,
      response: { heard, eligible: eligible.length, pct: eligible.length ? Math.round((heard / eligible.length) * 100) : null, afterDays: RESPONSE_AFTER_DAYS },
      followUpsDue: due,
      sectorMix: [...mix.entries()].map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector)),
    };
  }

  return { STAGES, RESPONSE_AFTER_DAYS, skippedBy, toMs, dayKey, businessDaysSince, scanStale, dayStart, weekStart, emailWindow, reached, periodReport, snapshot, benchmarks, topNew, dashboard };
});
