/* Role Radar: built from src/gmail-import.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarGmail = (() => {
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

  // src/gmail-import.ts
  var gmail_import_exports = {};
  __export(gmail_import_exports, {
    DEFAULT_QUERY: () => DEFAULT_QUERY,
    candidates: () => candidates,
    companyFromEmail: () => companyFromEmail,
    dateOf: () => dateOf,
    isAutomated: () => isAutomated,
    needsFullThread: () => needsFullThread,
    nextStatus: () => nextStatus,
    parseAddress: () => parseAddress,
    recruiterDoc: () => recruiterDoc,
    signalOf: () => signalOf,
    slug: () => slug,
    statusPatch: () => statusPatch,
    statusQuery: () => statusQuery,
    statusUpdates: () => statusUpdates,
    threadsFrom: () => threadsFrom,
    typeFor: () => typeFor
  });
  var DEFAULT_QUERY = '(recruiter OR recruiting OR "talent acquisition" OR "your background" OR "your experience" OR "a role" OR opportunity) newer_than:2y -from:me -category:promotions -category:social -category:forums';
  var FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|icloud|me|mac|aol|proton|protonmail|pm|fastmail|gmx|zoho)\./i;
  var AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer(-daemon)?|jobs?(-noreply)?|careers?|talent-?noreply|team|hello|info|support|news(letter)?|updates?|digest)([+.-]|$)/i;
  var BOARDS = /(^|\.)(linkedin|indeed|ziprecruiter|glassdoor|greenhouse|greenhouse-mail|lever|hire\.lever|ashbyhq|myworkday|workday|smartrecruiters|icims|jobvite|bamboohr|workable|himalayas|wellfound|angel|otta|welcometothejungle|builtin|climatebase|hired|dice|monster|careerbuilder|simplyhired|jobot|calendly)\.[a-z.]+$/i;
  var AGENCY = /(search|talent|staffing|recruit|partners|consult|hire|hiring|executive|placement|personnel)/i;
  var arr = (v) => Array.isArray(v) ? v : [];
  var str = (v) => typeof v === "string" ? v : "";
  function parseAddress(v) {
    if (v && typeof v === "object") {
      const o = v;
      const email = str(o.email || o.emailAddress || o.address).trim().toLowerCase();
      return { name: cleanName(str(o.name || o.displayName)), email };
    }
    const s = str(v).trim();
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
    if (m) return { name: cleanName(m[1]), email: m[2].trim().toLowerCase() };
    return { name: "", email: /@/.test(s) ? s.toLowerCase() : "" };
  }
  function cleanName(n) {
    return str(n).replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+via\s+.*$/i, "").replace(/\s+/g, " ").trim();
  }
  var titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  function nameFromEmail(email) {
    const local = str(email).split("@")[0].replace(/\+.*$/, "");
    if (!/[._-]/.test(local)) return "";
    return titleCase(local.replace(/[._-]+/g, " ").replace(/\d+/g, "").trim());
  }
  function domainOf(email) {
    return str(email).split("@")[1] || "";
  }
  function companyFromEmail(email) {
    const d = domainOf(email).toLowerCase();
    if (!d || FREE_MAIL.test(d)) return "";
    const labels = d.split(".");
    const twoPart = labels.length > 2 && /^(co|com|org|net|ac|gov)$/.test(labels[labels.length - 2]);
    const core = labels[labels.length - (twoPart ? 3 : 2)] || labels[0];
    return titleCase(core.replace(/-/g, " "));
  }
  function isAutomated(addr) {
    const email = str(addr && addr.email);
    if (!email) return true;
    const [local, domain] = email.split("@");
    return AUTOMATED_LOCAL.test(local) || BOARDS.test(domain || "");
  }
  function typeFor(email, company) {
    if (!company) return "referral";
    return AGENCY.test(domainOf(email)) || AGENCY.test(company) ? "agency" : "in-house";
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function dateOf(msg) {
    const o = msg;
    const raw = msg && (o.date ?? o.internalDate ?? o.timestamp);
    if (raw == null || raw === "") return "";
    const d = typeof raw === "number" || /^\d{10,13}$/.test(String(raw)) ? new Date(Number(raw) < 1e12 ? Number(raw) * 1e3 : Number(raw)) : new Date(raw);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function cleanSubject(s) {
    return str(s).replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().slice(0, 90);
  }
  function messagesOf(t) {
    const o = t;
    return arr(t && (o.messages || o.messageList)).filter((m) => !!m && typeof m === "object");
  }
  var isSent = (m) => arr(m && (m.labelIds || m.label_ids)).includes("SENT");
  function threadsFrom(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const o = payload;
      return arr(o.threads || o.items || o.results);
    }
    return [];
  }
  function needsFullThread(t) {
    const o = t;
    const n = Number(t && o.messageCount);
    return n > arr(t && (o.messages || o.messageList)).length;
  }
  var slug = (s) => str(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  function existingIndex(existing) {
    const byEmail = /* @__PURE__ */ new Set(), byKey = /* @__PURE__ */ new Set(), byName = /* @__PURE__ */ new Set();
    for (const r of arr(existing)) {
      if (r.email) byEmail.add(String(r.email).toLowerCase());
      if (r._id) byKey.add(r._id);
      if (r.name) byName.add(cleanName(r.name).toLowerCase());
    }
    return { byEmail, byKey, byName };
  }
  function candidates(threads, { existing = [] } = {}) {
    const idx = existingIndex(existing);
    const people = /* @__PURE__ */ new Map();
    for (const t of arr(threads)) {
      const msgs = messagesOf(t);
      const inbound = msgs.filter((m) => !isSent(m));
      const from = inbound.map((m) => parseAddress(m.sender ?? m.from)).find((a) => !isAutomated(a));
      if (!from) continue;
      const dates = msgs.map(dateOf).filter(Boolean).sort();
      const last = dates[dates.length - 1] || "";
      const subject = cleanSubject((msgs.find((m) => m.subject) || {}).subject);
      const prev = people.get(from.email);
      if (prev) {
        prev.threads += 1;
        if (last > prev.lastContact) Object.assign(prev, { lastContact: last, subject: subject || prev.subject, viewUrl: str(t.viewUrl) || prev.viewUrl });
        if (!prev.name && from.name && !/@/.test(from.name)) prev.name = from.name;
        continue;
      }
      const name = (from.name && !/@/.test(from.name) ? from.name : "") || nameFromEmail(from.email);
      const company = companyFromEmail(from.email);
      people.set(from.email, { name, email: from.email, company, type: typeFor(from.email, company), subject, lastContact: last, threads: 1, viewUrl: str(t.viewUrl) });
    }
    return [...people.values()].map((c) => {
      const key = (slug(c.name) ? slug(c.name + " " + c.company) : "") || slug(c.email.replace(/@.*/, "") + " " + (c.company || domainOf(c.email)));
      const exists = idx.byEmail.has(c.email) || idx.byKey.has(key) || !!c.name && idx.byName.has(c.name.toLowerCase());
      return { ...c, key, exists };
    }).sort((a, b) => b.lastContact.localeCompare(a.lastContact) || a.name.localeCompare(b.name));
  }
  function recruiterDoc(c, now = (/* @__PURE__ */ new Date()).toISOString()) {
    const doc = { name: c.name || c.email, company: c.company, type: c.type, email: c.email, lastContact: c.lastContact, source: "gmail", createdAt: now };
    if (c.subject) doc.lastNote = `Gmail: "${c.subject}"`;
    if (/^https:\/\//.test(c.viewUrl || "")) doc.mailSearch = c.viewUrl;
    return doc;
  }
  var PIPE = ["saved", "applying", "applied", "screen", "interviewing", "offer"];
  var RANK = Object.fromEntries(PIPE.map((s, i) => [s, i]));
  var SIGNALS = [
    ["offer", /\b(pleased|excited|happy|delighted) to (extend|offer)\b|\boffer letter\b|\bverbal offer\b/i],
    ["rejected", /\bunfortunately\b|\bnot (to )?(be )?mov(e|ing) forward\b|\b(decided|chosen) to (pursue|move forward with|proceed with) other\b|\bother candidates\b|\bposition has been filled\b|\bno longer (being )?consider|\bwill not be (moving|proceeding)\b|\bnot (been )?selected\b|\bregret to inform\b/i],
    ["interview", /\binterview(s|ing)?\b|\bphone screen\b|\bschedule (a|some) (time|call|chat)\b|\b(your|share your|send your) availability\b/i],
    ["applied", /\bthanks? (you )?for (applying|your application)\b|\b(received|receiving) your application\b|\bapplication (received|submitted|confirmation|was submitted)\b|\byour application (to|for|at)\b/i]
  ];
  var STATUS_TERMS = '("thank you for applying" OR "thanks for applying" OR "your application" OR "received your application" OR unfortunately OR "other candidates" OR interview OR "offer letter")';
  var SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|company|group|holdings|technologies|technology|labs|hq)\b\.?/g;
  var norm = (s) => str(s).toLowerCase().replace(/&/g, " and ").replace(SUFFIX, " ").replace(/[^a-z0-9]+/g, " ").trim();
  var compact = (s) => norm(s).replace(/ /g, "");
  var GRACE_DAYS = 7;
  function minusDays(day, n) {
    if (!day) return "";
    const d = /* @__PURE__ */ new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }
  var ymd = (s) => {
    const v = str(s);
    return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : dateOf({ date: v });
  };
  function signalOf(text) {
    for (const [sig, re] of SIGNALS) if (re.test(text)) return sig;
    return "";
  }
  function nextStatus(current, signal) {
    const cur = RANK[current];
    if (cur === void 0) return "";
    if (signal === "rejected") return "rejected";
    if (signal === "offer") return current === "offer" ? "" : "offer";
    if (signal === "interview") {
      if (cur < RANK.screen) return "screen";
      return current === "screen" ? "interviewing" : "";
    }
    if (signal === "applied") return cur < RANK.applied ? "applied" : "";
    return "";
  }
  function pipelineJobs(jobs) {
    return arr(jobs).filter((j) => !!(j && j._id && j.company && PIPE.includes(j.status)));
  }
  function statusQuery(jobs, { max = 25 } = {}) {
    const names = [...new Set(pipelineJobs(jobs).map((j) => norm(j.company)).filter(Boolean))].slice(0, max);
    if (!names.length) return "";
    return `${STATUS_TERMS} {${names.map((n) => `"${n}"`).join(" ")}} newer_than:1y -in:sent -category:promotions -category:social`;
  }
  function companyMatcher(jobs) {
    const first = (j) => norm(j.company).split(" ")[0] || "";
    const counts = {};
    jobs.forEach((j) => {
      const f = first(j);
      counts[f] = (counts[f] || 0) + 1;
    });
    return (j, { text, domain }) => {
      const full = norm(j.company);
      if (!full) return false;
      const words = " " + norm(text) + " ";
      if (words.includes(" " + full + " ")) return true;
      const labels = domain.split(".").slice(0, -1).map(compact);
      const dom = labels.join("");
      if (labels.some((_, i) => labels.slice(i).join("") === compact(j.company))) return true;
      const f = first(j);
      const uniqueNames = new Set(jobs.filter((x) => first(x) === f).map((x) => norm(x.company)));
      return f.length >= 5 && uniqueNames.size === 1 && (words.includes(" " + f + " ") || dom === f);
    };
  }
  function pickRole(roles, text) {
    if (roles.length === 1) return roles[0];
    const words = new Set(norm(text).split(" ").filter((w) => w.length > 3));
    const scored = roles.map((j) => ({ j, n: norm(j.title).split(" ").filter((w) => w.length > 3 && !/^(senior|staff|principal|product|manager|lead)$/.test(w) && words.has(w)).length })).sort((a, b) => b.n - a.n);
    return scored[0].n > (scored[1] ? scored[1].n : 0) ? scored[0].j : null;
  }
  function statusUpdates(threads, jobs) {
    const pool = pipelineJobs(jobs);
    const matches = companyMatcher(pool);
    const best = /* @__PURE__ */ new Map();
    for (const t of arr(threads)) {
      for (const m of messagesOf(t)) {
        if (isSent(m)) continue;
        const subject = cleanSubject(m.subject || t.subject);
        const snippet = str(m.snippet || t.snippet).slice(0, 400);
        const signal = signalOf(subject + " \n " + snippet);
        const date = dateOf(m);
        if (!signal || !date) continue;
        const from = parseAddress(m.sender ?? m.from);
        const text = [from.name, subject, snippet].join(" ");
        const roles = pool.filter((j2) => matches(j2, { text, domain: domainOf(from.email) }));
        if (!roles.length) continue;
        const j = pickRole(roles, text);
        if (!j) continue;
        const since = minusDays([j.appliedAt, j.firstSeen, j.statusAt].map(ymd).filter(Boolean).sort()[0], GRACE_DAYS);
        if (since && date < since) continue;
        const prev = best.get(j._id);
        if (prev && prev.date > date) continue;
        best.set(j._id, { j, signal, date, subject, viewUrl: str(m.viewUrl) || str(t.viewUrl) });
      }
    }
    const out = [];
    for (const { j, signal, date, subject, viewUrl } of best.values()) {
      const to = nextStatus(j.status, signal);
      if (!to) continue;
      out.push({ key: j._id, jobId: j._id, company: str(j.company), title: str(j.title), from: j.status, to, signal, date, subject, viewUrl });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.company.localeCompare(b.company));
  }
  function statusPatch(u, job = {}) {
    const p = { status: u.to, statusAt: u.date, statusEmail: { subject: u.subject, date: u.date, signal: u.signal } };
    if (/^https:\/\//.test(u.viewUrl || "")) p.statusEmail.url = u.viewUrl;
    if (u.to === "applied" && !job.appliedAt) p.appliedAt = u.date;
    const pipe = ["saved", "applying", "applied", "screen", "interviewing", "offer"];
    const had = Array.isArray(job.statusHistory) ? job.statusHistory : pipe.includes(job.status) ? [{ status: job.status, at: job.statusAt || "" }] : [];
    p.statusHistory = [...had, { status: u.to, at: u.date }];
    return p;
  }
  return __toCommonJS(gmail_import_exports);
})();
globalThis.RoleRadarGmail = RoleRadarGmail;
