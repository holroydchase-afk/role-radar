/* Role Radar skip feedback: what the owner's skips say about the criteria.
 * Reads the owner's recent skips (status "skipped", skippedBy not "rule") with their reason chip and comment,
 * finds patterns, and proposes concrete criteria.yaml changes. Nothing is applied here: the page puts an accepted
 * change in the Criteria editor and the owner saves it. tests/skip-feedback.test.mjs pins the rules down.
 *
 *   company      2+ skips at one company                      → add to hard_exclude.companies
 *   title word   2+ "Wrong level"/"Wrong domain" skips share   → add to role.title_exclude
 *                a title word no pursued role has
 *   culture      a phrase in 2+ "Culture" comments            → add to culture.red_flags
 *   sector       3+ "Wrong domain" skips in a weight-2+ sector → lower that sector's weight by 1
 *                with nothing pursued there
 *   comp         2+ "Comp too low" skips with a stated range  → raise comp.base_floor_usd just past their tops
 *                (at most 30% up, never above a pursued role's top)
 *   scan notes   2+ location or closed-posting skips          → a plain note for the scan, no criteria change
 *
 * A suggestion's id is stable (kind + value), so "Not now" sticks across visits.
 * Classic script: sets window.RoleRadarSkipFeedback in the browser, module.exports in Node. */
(function (root, factory) {
  const api = factory(root.RoleRadarScoring || (typeof require === "function" ? require("./scoring.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoleRadarSkipFeedback = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SC) {
  const DAY = 864e5;
  const WINDOW_DAYS = 30;
  const PURSUED = ["saved", "applying", "applied", "screen", "interviewing", "offer"];
  const LEVEL_DOMAIN = ["wrong level", "wrong domain"];
  const LOCATION = ["not remote", "location"];
  // Words every PM title shares; they never say why a role was wrong.
  const TITLE_STOP = new Set("product manager management senior sr staff principal lead pm of and the for to a an in on at with ii iii iv i remote us usa".split(" "));
  const STOP = new Set(("a an and are as at be but by for from has have i in is it its of on or our posting role team that the their they this to was were with would you your " +
    "not no very too so just like says said asks wants need needs looks seems much more less than about into over").split(" "));

  const lc = (s) => String(s == null ? "" : s).toLowerCase().trim();
  const arr = (a) => (Array.isArray(a) ? a : a == null || a === "" ? [] : [a]);
  const st = (j) => (j && j.status) || "new";
  const toMs = (s) => { if (!s) return NaN; const v = String(s); return new Date(v.length === 10 ? v + "T12:00:00" : v).getTime(); };
  const has = (hay, needle) => {
    const n = lc(needle);
    if (!n) return false;
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + e + "($|[^a-z0-9])").test(lc(hay));
  };
  const words = (s) => lc(s).replace(/[^a-z0-9+\- ]+/g, " ").split(/\s+/).filter(Boolean);
  const get = (o, path) => path.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);

  /** The owner's skips (not a scan's or a cleanup's) within the window, newest first. */
  function ownerSkips(jobs, { now = Date.now(), days = WINDOW_DAYS } = {}) {
    return arr(jobs)
      .filter((j) => j && st(j) === "skipped" && lc(j.skippedBy) !== "rule")
      .map((j) => ({ j, at: toMs(j.skippedAt || j.statusAt) }))
      .filter((x) => isFinite(x.at) && x.at <= now && now - x.at <= days * DAY)
      .sort((a, b) => b.at - a.at)
      .map((x) => x.j);
  }
  const evidence = (list) => list.map((j) => ({ id: j._id, company: j.company || "", title: j.title || "", reason: j.skipReason || "", note: j.skipNote || "" }));
  const pursued = (jobs) => arr(jobs).filter((j) => j && (PURSUED.includes(st(j)) || j.appliedAt));

  /** Patterns in the owner's recent skips, as suggested criteria changes and notes for the scan. */
  function analyze(jobs, spec, opts = {}) {
    spec = spec && typeof spec === "object" ? spec : {};
    const dismissed = new Set(arr(opts.dismissed));
    const skips = ownerSkips(jobs, opts);
    const kept = pursued(jobs);
    const out = [];
    const reasonOf = (j) => lc(j.skipReason);

    // Company: two or more of the owner's skips at one company.
    const byCo = new Map();
    skips.forEach((j) => { const k = lc(j.company); if (k) (byCo.get(k) || byCo.set(k, []).get(k)).push(j); });
    const excluded = arr(get(spec, ["hard_exclude", "companies"])).map(lc);
    for (const [k, list] of byCo) {
      if (list.length < 2 || excluded.includes(k) || kept.some((j) => lc(j.company) === k)) continue;
      const name = list[0].company.trim();
      out.push({ id: "company:" + k, kind: "company", text: `Never show ${name}`, why: `You ruled out ${list.length} of its roles.`,
        change: { op: "add", path: ["hard_exclude", "companies"], value: name }, evidence: evidence(list) });
    }

    // Title word: shared by 2+ wrong-level or wrong-domain skips, in no role the owner pursued.
    const ld = skips.filter((j) => LEVEL_DOMAIN.includes(reasonOf(j)));
    const include = arr(get(spec, ["role", "title_include"])).flatMap(words);
    const exclude = arr(get(spec, ["role", "title_exclude"]));
    const byWord = new Map();
    ld.forEach((j) => new Set(words(j.title)).forEach((w) => {
      if (w.length < 3 || TITLE_STOP.has(w) || include.includes(w) || /^\d+$/.test(w)) return;
      (byWord.get(w) || byWord.set(w, []).get(w)).push(j);
    }));
    for (const [w, list] of byWord) {
      if (list.length < 2 || exclude.some((x) => has(w, x) || has(x, w)) || kept.some((j) => has(j.title, w))) continue;
      const shown = (String(list[0].title).match(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i")) || [w])[0];
      out.push({ id: "title:" + w, kind: "title", text: `Skip titles with "${shown}"`, why: `${list.length} roles you ruled out as ${[...new Set(list.map((j) => j.skipReason))].join(" or ").toLowerCase()} had it in the title.`,
        change: { op: "add", path: ["role", "title_exclude"], value: shown }, evidence: evidence(list) });
    }

    // Culture: a word or two-word phrase that shows up in 2+ Culture comments.
    const cult = skips.filter((j) => reasonOf(j) === "culture" && j.skipNote);
    const flags = [...arr(get(spec, ["culture", "red_flags"])), ...arr(get(spec, ["culture", "hard_red_flags"]))];
    const grams = new Map();
    cult.forEach((j) => {
      const ws = words(j.skipNote), seen = new Set();
      ws.forEach((w, i) => {
        if (!STOP.has(w) && w.length >= 4) seen.add(w);
        const b = ws[i + 1]; if (b && !STOP.has(w) && !STOP.has(b)) seen.add(w + " " + b);
      });
      seen.forEach((g) => (grams.get(g) || grams.set(g, []).get(g)).push(j));
    });
    const phrases = [...grams].filter(([g, list]) => list.length >= 2 && !flags.some((f) => has(g, f) || has(f, g)))
      .sort((a, b) => b[1].length - a[1].length || b[0].split(" ").length - a[0].split(" ").length);
    const pickedPhrases = [];
    for (const [g, list] of phrases) {
      if (pickedPhrases.some((p) => p.includes(g) || g.includes(p)) || pickedPhrases.length >= 2) continue;
      pickedPhrases.push(g);
      out.push({ id: "culture:" + g, kind: "culture", text: `Treat "${g}" as a culture red flag`, why: `It came up in ${list.length} of your Culture skips.`,
        change: { op: "add", path: ["culture", "red_flags"], value: g }, evidence: evidence(list) });
    }

    // Sector: 3+ wrong-domain skips in a weight-2+ sector where nothing was pursued.
    if (SC && SC.sectorFor) {
      const bySec = new Map();
      skips.filter((j) => reasonOf(j) === "wrong domain").forEach((j) => {
        const s = SC.sectorFor(j, spec); if (!s || !s.id || s.id === "default") return;
        (bySec.get(s.id) || bySec.set(s.id, { s, list: [] }).get(s.id)).list.push(j);
      });
      for (const { s, list } of bySec.values()) {
        const w = Number(s.weight) || 0;
        if (list.length < 3 || w < 2 || kept.some((j) => (SC.sectorFor(j, spec) || {}).id === s.id)) continue;
        out.push({ id: `sector:${s.id}:${w - 1}`, kind: "sector", text: `Lower ${s.label || s.id} from weight ${w} to ${w - 1}`, why: `You ruled out ${list.length} roles there as the wrong domain and pursued none.`,
          change: { op: "set", path: ["sectors", { id: s.id }, "weight"], value: w - 1, from: w }, evidence: evidence(list) });
      }
    }

    // Comp: raise the floor just past the tops of the ranges the owner turned down for pay.
    const floor = Number(get(spec, ["comp", "base_floor_usd"]));
    if (SC && SC.parseComp && isFinite(floor) && floor > 0) {
      const low = skips.filter((j) => reasonOf(j) === "comp too low").map((j) => ({ j, r: SC.parseComp(j.comp) })).filter((x) => x.r && x.r.max);
      if (low.length >= 2) {
        const next = Math.ceil((Math.max(...low.map((x) => x.r.max)) + 1) / 5000) * 5000;
        const keptTops = kept.map((j) => SC.parseComp(j.comp)).filter((r) => r && r.max).map((r) => r.max);
        if (next > floor && next <= floor * 1.3 && !keptTops.some((m) => m < next)) {
          const k = (n) => "$" + Math.round(n / 1000) + "K";
          out.push({ id: "comp:" + next, kind: "comp", text: `Raise the base floor from ${k(floor)} to ${k(next)}`, why: `${low.length} roles you ruled out for pay topped out at ${k(Math.max(...low.map((x) => x.r.max)))} or less.`,
            change: { op: "set", path: ["comp", "base_floor_usd"], value: next, from: floor }, evidence: evidence(low.map((x) => x.j)) });
        }
      }
    }

    // Notes for the scan itself: gates it already has but let roles through anyway.
    const notes = [];
    const loc = skips.filter((j) => LOCATION.includes(reasonOf(j)));
    if (loc.length >= 2) notes.push({ id: "scan:location", kind: "scan", text: "Read the location section before adding a role", why: `${loc.length} roles got through that weren't remote or open in your state.`, evidence: evidence(loc) });
    const closed = skips.filter((j) => reasonOf(j) === "posting closed");
    if (closed.length >= 2) notes.push({ id: "scan:closed", kind: "scan", text: "Check a posting is still open before adding it", why: `${closed.length} roles were already closed when you got to them.`, evidence: evidence(closed) });

    const rank = (a, b) => b.evidence.length - a.evidence.length;
    const suggestions = out.filter((s) => !dismissed.has(s.id)).sort(rank);
    const scanNotes = notes.filter((s) => !dismissed.has(s.id)).sort(rank);
    const byReason = {};
    skips.forEach((j) => { const r = j.skipReason || "No reason given"; byReason[r] = (byReason[r] || 0) + 1; });
    return { days: opts.days || WINDOW_DAYS, skips: skips.length, withNotes: skips.filter((j) => lc(j.skipNote)).length, byReason, suggestions, scanNotes };
  }

  // ---- Applying a change to the criteria YAML text, keeping every comment and line as it was. ----
  const indentOf = (l) => l.match(/^ */)[0].length;
  const blank = (l) => /^\s*(#.*)?$/.test(l);
  const quote = (v) => (typeof v === "number" || /^[A-Za-z0-9][A-Za-z0-9 .&'/+()-]*$/.test(String(v)) && !/^(true|false|null|yes|no|on|off)$/i.test(String(v)) ? String(v) : JSON.stringify(String(v)));
  /** End (exclusive) of the block that starts at line i: the next real line indented at or left of `ind`. */
  function blockEnd(lines, i, ind) {
    let k = i + 1;
    while (k < lines.length && (blank(lines[k]) || indentOf(lines[k]) > ind)) k++;
    while (k > i + 1 && blank(lines[k - 1])) k--;
    return k;
  }
  /** Line index of a key: plain keys at the next level down, or { id } to find a "- id: x" list item. */
  function find(lines, path) {
    let from = 0, to = lines.length, parentInd = -1, at = -1, itemInd = null;
    for (const seg of path) {
      at = -1;
      if (seg && typeof seg === "object") {
        const re = new RegExp("^(\\s*)- id:\\s*" + String(seg.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*(#.*)?$");
        for (let i = from; i < to; i++) { const m = lines[i].match(re); if (m) { at = i; itemInd = m[1].length; break; } }
        if (at < 0) return null;
        // An item's own keys sit two spaces right of its dash; the item ends at the next dash at that indent.
        let k = at + 1; while (k < to && (blank(lines[k]) || indentOf(lines[k]) > itemInd)) k++;
        from = at; to = k; parentInd = itemInd + 1;
        continue;
      }
      const re = new RegExp("^(\\s*)(- )?" + String(seg).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":(\\s|$)");
      let want = null;
      for (let i = from; i < to; i++) {
        if (blank(lines[i])) continue;
        const m = lines[i].match(re);
        const ind = m ? m[1].length + (m[2] ? 2 : 0) : indentOf(lines[i]);
        if (want == null && ind > parentInd) want = ind;
        if (m && ind === want) { at = i; break; }
      }
      if (at < 0) return null;
      const ind = indentOf(lines[at]) + (/^\s*- /.test(lines[at]) ? 2 : 0);
      from = at + 1; to = blockEnd(lines, at, ind); parentInd = ind;
    }
    return { at, end: to };
  }

  /** The YAML text with one change applied, or null when the change can't be placed safely.
   *  Pass js-yaml's load as `load` to double-check the result parses and says what was intended. */
  function applyToYaml(text, change, load) {
    if (!change || !Array.isArray(change.path)) return null;
    const lines = String(text || "").split("\n");
    const hit = find(lines, change.path);
    if (!hit) return null;
    const line = lines[hit.at];
    const m = line.match(/^(\s*(?:- )?[^:#]+:)([ \t]*)([^#]*?)([ \t]*#.*)?$/);
    if (!m) return null;
    const [, head, gap, value, comment = ""] = m;
    if (change.op === "set") {
      lines[hit.at] = head + (gap || " ") + quote(change.value) + comment;
    } else if (change.op === "add") {
      if (/^\[.*\]$/.test(value.trim())) {
        const inner = value.trim().slice(1, -1).trim();
        lines[hit.at] = head + (gap || " ") + "[" + (inner ? inner + ", " : "") + quote(change.value) + "]" + comment;
      } else if (!value.trim()) {
        let last = -1, ind = null;
        for (let i = hit.at + 1; i < hit.end; i++) { if (blank(lines[i])) continue; const d = lines[i].match(/^(\s*)- /); if (!d) return null; ind = d[1]; last = i; }
        if (last < 0) return null;
        lines.splice(last + 1, 0, ind + "- " + quote(change.value));
      } else return null;
    } else return null;
    const out = lines.join("\n");
    if (load) {
      try {
        const d = load(out), path = change.path;
        const node = path.reduce((x, k) => (x == null ? x : typeof k === "object" ? arr(x).find((y) => y && y.id === k.id) : x[k]), d);
        const ok = change.op === "set" ? node === change.value : arr(node).some((v) => lc(v) === lc(change.value));
        if (!ok) return null;
      } catch (_) { return null; }
    }
    return out;
  }

  return { WINDOW_DAYS, ownerSkips, analyze, applyToYaml };
});
