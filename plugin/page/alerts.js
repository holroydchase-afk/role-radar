/* Role Radar: built from src/alerts.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarAlerts = (() => {
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

  // src/alerts.ts
  var alerts_exports = {};
  __export(alerts_exports, {
    CHANNELS: () => CHANNELS,
    DEFAULT_RULES: () => DEFAULT_RULES,
    EVENTS: () => EVENTS,
    LEVELS: () => LEVELS,
    clock: () => clock,
    describe: () => describe,
    evaluate: () => evaluate,
    inQuietHours: () => inQuietHours,
    matches: () => matches,
    normalize: () => normalize
  });
  var EVENTS = ["recruiter_email", "status_change", "new_role", "follow_up_due"];
  var LEVELS = ["loud", "quiet", "off"];
  var CHANNELS = ["push", "thread", "email"];
  var DEFAULT_RULES = [
    { id: "recruiter_email", when: "recruiter_email", level: "loud", remind_after_hours: [4] },
    { id: "interview", when: "status_change", to: ["screen", "interviewing", "offer"], level: "loud" },
    { id: "rejection", when: "status_change", to: ["rejected"], level: "quiet" },
    { id: "strong_match", when: "new_role", min_score: 80, level: "loud" },
    { id: "follow_up", when: "follow_up_due", level: "quiet" }
  ];
  var DEFAULTS = { channels: ["push", "thread"], quiet_hours: null, rules: DEFAULT_RULES };
  var arr = (a) => Array.isArray(a) ? a : a == null || a === "" ? [] : [a];
  var lc = (s) => String(s == null ? "" : s).toLowerCase().trim();
  function minutesOf(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? "" : hhmm).trim());
    if (!m) return null;
    const h = Number(m[1]), mm = Number(m[2]);
    return h > 23 || mm > 59 ? null : h * 60 + mm;
  }
  function normalize(spec) {
    const s = spec;
    const a = spec && typeof spec === "object" && s.alerts && typeof s.alerts === "object" ? s.alerts : {};
    const channels = arr(a.channels).map(lc).filter((c) => CHANNELS.includes(c));
    let quiet = null;
    if (a.quiet_hours && typeof a.quiet_hours === "object") {
      const q = a.quiet_hours;
      const start = minutesOf(q.start), end = minutesOf(q.end);
      if (start !== null && end !== null && start !== end)
        quiet = { start, end, tz: q.tz ? String(q.tz) : "", loud_breaks_through: q.loud_breaks_through === true };
    }
    const source = Array.isArray(a.rules) ? a.rules : DEFAULT_RULES;
    const rules = source.map((r, i) => [r, i]).filter(([r]) => r && typeof r === "object" && EVENTS.includes(lc(r.when))).map(([r, i]) => {
      const level = LEVELS.includes(lc(r.level)) ? lc(r.level) : "loud";
      const rule = { id: r.id ? String(r.id) : lc(r.when) + "-" + (i + 1), when: lc(r.when), level };
      const to = arr(r.to).map(lc).filter(Boolean);
      if (to.length) rule.to = to;
      const min = Number(r.min_score);
      if (r.min_score != null && r.min_score !== "" && Number.isFinite(min)) rule.min_score = min;
      const remind = arr(r.remind_after_hours).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
      if (remind.length) rule.remind_after_hours = remind;
      return rule;
    });
    return { channels: channels.length ? channels : DEFAULTS.channels.slice(), quiet_hours: quiet, rules };
  }
  function matches(rule, ev) {
    if (!ev || lc(ev.type) !== rule.when) return false;
    if (rule.to && !rule.to.includes(lc(ev.to))) return false;
    if (rule.min_score != null && !(Number(ev.score) >= rule.min_score)) return false;
    return true;
  }
  function clockMinutes(date, tz) {
    if (tz) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
        const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
        if (Number.isFinite(get("hour"))) return get("hour") * 60 + get("minute");
      } catch (_) {
      }
    }
    return date.getHours() * 60 + date.getMinutes();
  }
  function inQuietHours(date, quiet) {
    if (!quiet) return false;
    const m = clockMinutes(date, quiet.tz);
    return quiet.start < quiet.end ? m >= quiet.start && m < quiet.end : m >= quiet.start || m < quiet.end;
  }
  function evaluate(events, spec, now) {
    const cfg = normalize(spec);
    const at = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const quietNow = inQuietHours(at, cfg.quiet_hours);
    const out = [];
    arr(events).forEach((ev) => {
      const rule = cfg.rules.find((r) => matches(r, ev));
      if (!rule || rule.level === "off") return;
      const loud = rule.level === "loud";
      const held = quietNow && !(loud && cfg.quiet_hours.loud_breaks_through);
      out.push({ event: ev, rule, level: rule.level, channels: loud ? cfg.channels.slice() : ["summary"], held });
    });
    return out;
  }
  var STATUS_WORDS = { screen: "a screen", interviewing: "interviews", offer: "an offer", rejected: "a rejection", applied: "applied" };
  function describe(rule) {
    let what;
    if (rule.when === "recruiter_email") what = "A recruiter or hiring manager emails or replies";
    else if (rule.when === "status_change") what = "A role moves to " + (rule.to ? rule.to.map((s) => STATUS_WORDS[s] || s).join(" or ") : "any new status");
    else if (rule.when === "new_role") what = "The scan finds a role" + (rule.min_score != null ? " scoring " + rule.min_score + "+" : "");
    else what = "A follow-up date arrives";
    const how = rule.level === "loud" ? "alert right away" : rule.level === "quiet" ? "add to the summary" : "do nothing";
    const remind = rule.remind_after_hours ? ", remind after " + rule.remind_after_hours.join(" and ") + "h without a reply" : "";
    return what + ": " + how + remind + ".";
  }
  var clock = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  return __toCommonJS(alerts_exports);
})();
globalThis.RoleRadarAlerts = RoleRadarAlerts;
