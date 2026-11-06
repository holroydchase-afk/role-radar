/* Role Radar: built from src/skip-feedback.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarSkipFeedback = (() => {
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

  // src/skip-feedback.ts
  var skip_feedback_exports = {};
  __export(skip_feedback_exports, {
    WINDOW_DAYS: () => WINDOW_DAYS,
    analyze: () => analyze,
    applyToYaml: () => applyToYaml,
    ownerSkips: () => ownerSkips
  });

  // src/scoring.ts
  var lc = (s) => String(s == null ? "" : s).toLowerCase();
  var arr = (a) => Array.isArray(a) ? a : a == null || a === "" ? [] : [a];
  var has = (hay, needle) => {
    const n = lc(needle).trim();
    if (!n) return false;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])").test(lc(hay));
  };
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
  var US_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");

  // src/skip-feedback.ts
  var WINDOW_DAYS = 30;
  var DAY = 864e5;
  var PURSUED = ["saved", "applying", "applied", "screen", "interviewing", "offer"];
  var LEVEL_DOMAIN = ["wrong level", "wrong domain"];
  var LOCATION = ["not remote", "location"];
  var TITLE_STOP = new Set("product manager management senior sr staff principal lead pm of and the for to a an in on at with ii iii iv i remote us usa".split(" "));
  var STOP = new Set("a an and are as at be but by for from has have i in is it its of on or our posting role team that the their they this to was were with would you your not no very too so just like says said asks wants need needs looks seems much more less than about into over".split(" "));
  var lc2 = (s) => String(s == null ? "" : s).toLowerCase().trim();
  var arr2 = (a) => Array.isArray(a) ? a : a == null || a === "" ? [] : [a];
  var st = (j) => j && j.status || "new";
  var toMs = (s) => {
    if (!s) return NaN;
    const v = String(s);
    return new Date(v.length === 10 ? v + "T12:00:00" : v).getTime();
  };
  var has2 = (hay, needle) => {
    const n = lc2(needle);
    if (!n) return false;
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + e + "($|[^a-z0-9])").test(lc2(hay));
  };
  var words = (s) => lc2(s).replace(/[^a-z0-9+\- ]+/g, " ").split(/\s+/).filter(Boolean);
  var get = (o, path) => path.reduce((x, k) => x && typeof x === "object" ? x[k] : void 0, o);
  var push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
  function ownerSkips(jobs, { now = Date.now(), days = WINDOW_DAYS } = {}) {
    return arr2(jobs).filter((j) => !!j && st(j) === "skipped" && lc2(j.skippedBy) !== "rule").map((j) => ({ j, at: toMs(j.skippedAt || j.statusAt) })).filter((x) => isFinite(x.at) && x.at <= now && now - x.at <= days * DAY).sort((a, b) => b.at - a.at).map((x) => x.j);
  }
  var evidence = (list) => list.map((j) => ({ id: j._id, company: j.company || "", title: j.title || "", reason: j.skipReason || "", note: j.skipNote || "" }));
  var pursued = (jobs) => arr2(jobs).filter((j) => !!j && (PURSUED.includes(st(j)) || !!j.appliedAt));
  function analyze(jobs, spec, opts = {}) {
    const crit = spec && typeof spec === "object" ? spec : {};
    const dismissed = new Set(arr2(opts.dismissed));
    const skips = ownerSkips(jobs, opts);
    const kept = pursued(jobs);
    const out = [];
    const reasonOf = (j) => lc2(j.skipReason);
    const byCo = /* @__PURE__ */ new Map();
    skips.forEach((j) => {
      const k = lc2(j.company);
      if (k) push(byCo, k, j);
    });
    const excluded = arr2(get(crit, ["hard_exclude", "companies"])).map(lc2);
    for (const [k, list] of byCo) {
      if (list.length < 2 || excluded.includes(k) || kept.some((j) => lc2(j.company) === k)) continue;
      const name = list[0].company.trim();
      out.push({
        id: "company:" + k,
        kind: "company",
        text: `Never show ${name}`,
        why: `You ruled out ${list.length} of its roles.`,
        change: { op: "add", path: ["hard_exclude", "companies"], value: name },
        evidence: evidence(list)
      });
    }
    const ld = skips.filter((j) => LEVEL_DOMAIN.includes(reasonOf(j)));
    const include = arr2(get(crit, ["role", "title_include"])).flatMap(words);
    const exclude = arr2(get(crit, ["role", "title_exclude"]));
    const byWord = /* @__PURE__ */ new Map();
    ld.forEach((j) => new Set(words(j.title)).forEach((w) => {
      if (w.length < 3 || TITLE_STOP.has(w) || include.includes(w) || /^\d+$/.test(w)) return;
      push(byWord, w, j);
    }));
    for (const [w, list] of byWord) {
      if (list.length < 2 || exclude.some((x) => has2(w, x) || has2(x, w)) || kept.some((j) => has2(j.title, w))) continue;
      const shown = (String(list[0].title).match(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i")) || [w])[0];
      out.push({
        id: "title:" + w,
        kind: "title",
        text: `Skip titles with "${shown}"`,
        why: `${list.length} roles you ruled out as ${[...new Set(list.map((j) => j.skipReason))].join(" or ").toLowerCase()} had it in the title.`,
        change: { op: "add", path: ["role", "title_exclude"], value: shown },
        evidence: evidence(list)
      });
    }
    const cult = skips.filter((j) => reasonOf(j) === "culture" && j.skipNote);
    const flags = [...arr2(get(crit, ["culture", "red_flags"])), ...arr2(get(crit, ["culture", "hard_red_flags"]))];
    const grams = /* @__PURE__ */ new Map();
    cult.forEach((j) => {
      const ws = words(j.skipNote), seen = /* @__PURE__ */ new Set();
      ws.forEach((w, i) => {
        if (!STOP.has(w) && w.length >= 4) seen.add(w);
        const b = ws[i + 1];
        if (b && !STOP.has(w) && !STOP.has(b)) seen.add(w + " " + b);
      });
      seen.forEach((g) => push(grams, g, j));
    });
    const phrases = [...grams].filter(([g, list]) => list.length >= 2 && !flags.some((f) => has2(g, f) || has2(f, g))).sort((a, b) => b[1].length - a[1].length || b[0].split(" ").length - a[0].split(" ").length);
    const pickedPhrases = [];
    for (const [g, list] of phrases) {
      if (pickedPhrases.some((p) => p.includes(g) || g.includes(p)) || pickedPhrases.length >= 2) continue;
      pickedPhrases.push(g);
      out.push({
        id: "culture:" + g,
        kind: "culture",
        text: `Treat "${g}" as a culture red flag`,
        why: `It came up in ${list.length} of your Culture skips.`,
        change: { op: "add", path: ["culture", "red_flags"], value: g },
        evidence: evidence(list)
      });
    }
    {
      const bySec = /* @__PURE__ */ new Map();
      skips.filter((j) => reasonOf(j) === "wrong domain").forEach((j) => {
        const s = sectorFor(j, crit);
        if (!s || !s.id || s.id === "default") return;
        (bySec.get(s.id) || bySec.set(s.id, { s, list: [] }).get(s.id)).list.push(j);
      });
      for (const { s, list } of bySec.values()) {
        const w = Number(s.weight) || 0;
        if (list.length < 3 || w < 2 || kept.some((j) => (sectorFor(j, crit) || {}).id === s.id)) continue;
        out.push({
          id: `sector:${s.id}:${w - 1}`,
          kind: "sector",
          text: `Lower ${s.label || s.id} from weight ${w} to ${w - 1}`,
          why: `You ruled out ${list.length} roles there as the wrong domain and pursued none.`,
          change: { op: "set", path: ["sectors", { id: s.id }, "weight"], value: w - 1, from: w },
          evidence: evidence(list)
        });
      }
    }
    const floor = Number(get(crit, ["comp", "base_floor_usd"]));
    if (isFinite(floor) && floor > 0) {
      const low = skips.filter((j) => reasonOf(j) === "comp too low").map((j) => ({ j, r: parseComp(j.comp) })).filter((x) => !!(x.r && x.r.max));
      if (low.length >= 2) {
        const next = Math.ceil((Math.max(...low.map((x) => x.r.max)) + 1) / 5e3) * 5e3;
        const keptTops = kept.map((j) => parseComp(j.comp)).filter((r) => !!(r && r.max)).map((r) => r.max);
        if (next > floor && next <= floor * 1.3 && !keptTops.some((m) => m < next)) {
          const k = (n) => "$" + Math.round(n / 1e3) + "K";
          out.push({
            id: "comp:" + next,
            kind: "comp",
            text: `Raise the base floor from ${k(floor)} to ${k(next)}`,
            why: `${low.length} roles you ruled out for pay topped out at ${k(Math.max(...low.map((x) => x.r.max)))} or less.`,
            change: { op: "set", path: ["comp", "base_floor_usd"], value: next, from: floor },
            evidence: evidence(low.map((x) => x.j))
          });
        }
      }
    }
    const notes = [];
    const loc = skips.filter((j) => LOCATION.includes(reasonOf(j)));
    if (loc.length >= 2) notes.push({ id: "scan:location", kind: "scan", text: "Read the location section before adding a role", why: `${loc.length} roles got through that weren't remote or open in your state.`, evidence: evidence(loc) });
    const closed = skips.filter((j) => reasonOf(j) === "posting closed");
    if (closed.length >= 2) notes.push({ id: "scan:closed", kind: "scan", text: "Check a posting is still open before adding it", why: `${closed.length} roles were already closed when you got to them.`, evidence: evidence(closed) });
    const rank = (a, b) => b.evidence.length - a.evidence.length;
    const suggestions = out.filter((s) => !dismissed.has(s.id)).sort(rank);
    const scanNotes = notes.filter((s) => !dismissed.has(s.id)).sort(rank);
    const byReason = {};
    skips.forEach((j) => {
      const r = j.skipReason || "No reason given";
      byReason[r] = (byReason[r] || 0) + 1;
    });
    return { days: opts.days || WINDOW_DAYS, skips: skips.length, withNotes: skips.filter((j) => lc2(j.skipNote)).length, byReason, suggestions, scanNotes };
  }
  var indentOf = (l) => l.match(/^ */)[0].length;
  var blank = (l) => /^\s*(#.*)?$/.test(l);
  var quote = (v) => typeof v === "number" || /^[A-Za-z0-9][A-Za-z0-9 .&'/+()-]*$/.test(String(v)) && !/^(true|false|null|yes|no|on|off)$/i.test(String(v)) ? String(v) : JSON.stringify(String(v));
  function blockEnd(lines, i, ind) {
    let k = i + 1;
    while (k < lines.length && (blank(lines[k]) || indentOf(lines[k]) > ind)) k++;
    while (k > i + 1 && blank(lines[k - 1])) k--;
    return k;
  }
  function find(lines, path) {
    let from = 0, to = lines.length, parentInd = -1, at = -1, itemInd = null;
    for (const seg of path) {
      at = -1;
      if (seg && typeof seg === "object") {
        const re2 = new RegExp("^(\\s*)- id:\\s*" + String(seg.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(#.*)?$");
        for (let i = from; i < to; i++) {
          const m = lines[i].match(re2);
          if (m) {
            at = i;
            itemInd = m[1].length;
            break;
          }
        }
        if (at < 0) return null;
        let k = at + 1;
        while (k < to && (blank(lines[k]) || indentOf(lines[k]) > itemInd)) k++;
        from = at;
        to = k;
        parentInd = itemInd + 1;
        continue;
      }
      const re = new RegExp("^(\\s*)(- )?" + String(seg).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\s|$)");
      let want = null;
      for (let i = from; i < to; i++) {
        if (blank(lines[i])) continue;
        const m = lines[i].match(re);
        const ind2 = m ? m[1].length + (m[2] ? 2 : 0) : indentOf(lines[i]);
        if (want == null && ind2 > parentInd) want = ind2;
        if (m && ind2 === want) {
          at = i;
          break;
        }
      }
      if (at < 0) return null;
      const ind = indentOf(lines[at]) + (/^\s*- /.test(lines[at]) ? 2 : 0);
      from = at + 1;
      to = blockEnd(lines, at, ind);
      parentInd = ind;
    }
    return { at, end: to };
  }
  function applyToYaml(text, change, load) {
    if (!change || !Array.isArray(change.path)) return null;
    const lines = String(text || "").split("\n");
    const hit = find(lines, change.path);
    if (!hit) return null;
    const line = lines[hit.at];
    const m = line.match(/^(\s*(?:- )?[^:#]+:)([ \t]*)([^#]*?)([ \t]*#.*)?$/);
    if (!m) return null;
    const [, head, gap, value, comment = ""] = m;
    if (change.op === "set" && Array.isArray(change.value)) {
      if (!value.trim() && lines.slice(hit.at + 1, hit.end).some((l) => !blank(l))) return null;
      lines[hit.at] = head + (gap || " ") + "[" + change.value.map(quote).join(", ") + "]" + comment;
    } else if (change.op === "set") {
      lines[hit.at] = head + (gap || " ") + quote(change.value) + comment;
    } else if (change.op === "add") {
      if (/^\[.*\]$/.test(value.trim())) {
        const inner = value.trim().slice(1, -1).trim();
        lines[hit.at] = head + (gap || " ") + "[" + (inner ? inner + ", " : "") + quote(change.value) + "]" + comment;
      } else if (!value.trim()) {
        let last = -1, ind = null;
        for (let i = hit.at + 1; i < hit.end; i++) {
          if (blank(lines[i])) continue;
          const d = lines[i].match(/^(\s*)- /);
          if (!d) return null;
          ind = d[1];
          last = i;
        }
        if (last < 0) return null;
        lines.splice(last + 1, 0, ind + "- " + quote(change.value));
      } else return null;
    } else return null;
    const out = lines.join("\n");
    if (load) {
      try {
        const d = load(out), path = change.path;
        const node = path.reduce((x, k) => x == null ? x : typeof k === "object" ? arr2(x).find((y) => y && y.id === k.id) : x[k], d);
        const ok = change.op === "set" ? Array.isArray(change.value) ? JSON.stringify(node) === JSON.stringify(change.value) : node === change.value : arr2(node).some((v) => lc2(v) === lc2(change.value));
        if (!ok) return null;
      } catch (_) {
        return null;
      }
    }
    return out;
  }
  return __toCommonJS(skip_feedback_exports);
})();
globalThis.RoleRadarSkipFeedback = RoleRadarSkipFeedback;
