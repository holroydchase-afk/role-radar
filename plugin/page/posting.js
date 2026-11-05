/* Role Radar: built from src/posting.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarPosting = (() => {
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

  // src/posting.ts
  var posting_exports = {};
  __export(posting_exports, {
    ATS: () => ATS,
    ATS_LABEL: () => ATS_LABEL,
    apiUrl: () => apiUrl,
    decodeEntities: () => decodeEntities,
    extractHtml: () => extractHtml,
    fromUrl: () => fromUrl,
    postingSource: () => postingSource,
    sanitizeHtml: () => sanitizeHtml
  });
  var ATS = ["greenhouse", "ashby", "lever"];
  var ATS_LABEL = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };
  var lc = (s) => String(s == null ? "" : s).toLowerCase().trim();
  var URL_RULES = [
    { ats: "greenhouse", re: /^https?:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i },
    { ats: "greenhouse", re: /^https?:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/embed\/job_app\?(?=.*\bfor=([^&#]+))(?=.*\btoken=(\d+))/i },
    { ats: "ashby", re: /^https?:\/\/jobs()\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i },
    { ats: "lever", re: /^https?:\/\/jobs(\.eu)?\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i }
  ];
  function fromUrl(url) {
    const u = String(url || "").trim();
    for (const r of URL_RULES) {
      const m = r.re.exec(u);
      if (!m) continue;
      let slug;
      try {
        slug = decodeURIComponent(m[2]);
      } catch {
        return null;
      }
      return { ats: r.ats, slug, id: m[3], eu: !!m[1] };
    }
    return null;
  }
  function postingSource(job, companies) {
    if (!job) return null;
    const byUrl = fromUrl(job.url);
    if (byUrl) return byUrl;
    const ats = lc(job.ats || job.source);
    if (!ATS.includes(ats)) return null;
    const docId = String(job._id || "");
    const id = docId.startsWith(ats + "-") ? docId.slice(ats.length + 1) : "";
    let slug = "";
    const cid = String(job.companyId || "");
    if (cid.startsWith(ats + "-")) slug = cid.slice(ats.length + 1);
    if (!slug && Array.isArray(companies)) {
      const c = companies.find((x) => x && lc(x.ats) === ats && x.slug && lc(x.name) === lc(job.company));
      if (c) slug = String(c.slug);
    }
    return id && slug ? { ats, slug, id, eu: false } : null;
  }
  function apiUrl(src) {
    const s = encodeURIComponent(String(src.slug)), i = encodeURIComponent(String(src.id));
    if (src.ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs/${i}`;
    if (src.ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
    if (src.ats === "lever") return `https://api${src.eu ? ".eu" : ""}.lever.co/v0/postings/${s}/${i}?mode=json`;
    return "";
  }
  var NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\xA0" };
  function decodeEntities(s) {
    return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 1114111 ? String.fromCodePoint(n) : m;
      }
      const v = NAMED[e.toLowerCase()];
      return v === void 0 ? m : v;
    });
  }
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  var escText = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  function extractHtml(src, data) {
    if (!src || !data || typeof data !== "object") return "";
    const d = data;
    if (src.ats === "greenhouse") return typeof d.content === "string" ? decodeEntities(d.content) : "";
    if (src.ats === "ashby") {
      const job = (Array.isArray(d.jobs) ? d.jobs : []).find((j) => j && String(j.id) === String(src.id));
      return job ? String(job.descriptionHtml || (job.descriptionPlain ? `<p>${escText(job.descriptionPlain)}</p>` : "")) : "";
    }
    if (src.ats === "lever") {
      const lists = (Array.isArray(d.lists) ? d.lists : []).map((l) => `${l && l.text ? `<h3>${escText(l.text)}</h3>` : ""}<ul>${l && l.content || ""}</ul>`).join("");
      const body = d.description || (d.descriptionPlain ? `<p>${escText(d.descriptionPlain)}</p>` : "");
      return body || lists ? String(body) + lists + String(d.additional || "") : "";
    }
    return "";
  }
  var KEEP = new Set("P BR UL OL LI STRONG B EM I U H1 H2 H3 H4 H5 H6 BLOCKQUOTE A DIV SPAN SECTION TABLE THEAD TBODY TR TD TH HR SUB SUP CODE PRE SMALL".split(" "));
  var DROP = new Set("SCRIPT STYLE IFRAME FRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA IMG PICTURE SVG MATH LINK META NOSCRIPT TEMPLATE VIDEO AUDIO SOURCE CANVAS HEAD TITLE BASE".split(" "));
  function sanitizeHtml(html, doc) {
    const out = doc.createDocumentFragment();
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
    const copy = (from, to) => {
      for (const n of Array.from(from.childNodes)) {
        if (n.nodeType === 3) {
          to.appendChild(doc.createTextNode(n.nodeValue));
          continue;
        }
        if (n.nodeType !== 1) continue;
        const e = n;
        const tag = e.tagName.toUpperCase();
        if (DROP.has(tag)) continue;
        if (!KEEP.has(tag)) {
          copy(e, to);
          continue;
        }
        const el = doc.createElement(tag.toLowerCase());
        if (tag === "A") {
          const href = String(e.getAttribute("href") || "").trim();
          if (/^https?:\/\//i.test(href)) {
            el.setAttribute("href", href);
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
        }
        copy(e, el);
        to.appendChild(el);
      }
    };
    copy(parsed.body, out);
    return out;
  }
  return __toCommonJS(posting_exports);
})();
globalThis.RoleRadarPosting = RoleRadarPosting;
