/* Role Radar posting preview: find a role's public job-board API and read its description.
 * The page calls these when you open a role's preview panel. Text comes straight from the
 * company's own board (Greenhouse, Ashby or Lever), word for word, and is never stored.
 *
 *   postingSource(job, companies) -> {ats, slug, id, eu} or null (no public API for this source)
 *   apiUrl(src)                   -> the public JSON endpoint to fetch
 *   extractHtml(src, data)        -> the description as HTML, or "" if the posting isn't there
 *   sanitizeHtml(html, doc)       -> a safe DocumentFragment (browser only: needs DOMParser)
 *
 * ES module. scripts/build.mjs bundles it to build/posting.js, a classic script that sets window.RoleRadarPosting. */

export type Ats = "greenhouse" | "ashby" | "lever";
export interface PostingSource { ats: Ats; slug: string; id: string; eu: boolean }
/** What apiUrl and extractHtml read from a source; a hand-made one may leave fields out. */
export interface SourceLike { ats: string; slug?: string; id?: string; eu?: boolean }
/** A role, as far as the preview reads it. */
export interface PostingJob { _id?: string; url?: string; ats?: string; source?: string; companyId?: string; company?: string }
export interface Company { ats?: string; slug?: string; name?: string }

type Rec = Record<string, unknown>;

export const ATS: Ats[] = ["greenhouse", "ashby", "lever"];
export const ATS_LABEL: Record<Ats, string> = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };
const lc = (s: unknown): string => String(s == null ? "" : s).toLowerCase().trim();

// Posting links the scan and manual adds store, newest board domains first.
const URL_RULES: { ats: Ats; re: RegExp }[] = [
  { ats: "greenhouse", re: /^https?:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i },
  { ats: "greenhouse", re: /^https?:\/\/(?:job-boards|boards)(\.eu)?\.greenhouse\.io\/embed\/job_app\?(?=.*\bfor=([^&#]+))(?=.*\btoken=(\d+))/i },
  { ats: "ashby", re: /^https?:\/\/jobs()\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i },
  { ats: "lever", re: /^https?:\/\/jobs(\.eu)?\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i },
];
export function fromUrl(url: unknown): PostingSource | null {
  const u = String(url || "").trim();
  for (const r of URL_RULES) {
    const m = r.re.exec(u);
    if (!m) continue;
    let slug: string;
    try { slug = decodeURIComponent(m[2]); } catch { return null; } // a broken %-escape: no preview, no crash
    return { ats: r.ats, slug, id: m[3], eu: !!m[1] };
  }
  return null;
}

// The scan stores jobs as jobs/<ats>-<jobId> and companies as companies/<ats>-<slug>.
export function postingSource(job: PostingJob | null | undefined, companies?: unknown): PostingSource | null {
  if (!job) return null;
  const byUrl = fromUrl(job.url);
  if (byUrl) return byUrl;
  const ats = lc(job.ats || job.source);
  if (!(ATS as string[]).includes(ats)) return null;
  const docId = String(job._id || "");
  const id = docId.startsWith(ats + "-") ? docId.slice(ats.length + 1) : "";
  let slug = "";
  const cid = String(job.companyId || "");
  if (cid.startsWith(ats + "-")) slug = cid.slice(ats.length + 1);
  if (!slug && Array.isArray(companies)) {
    const c = (companies as (Company | null | undefined)[]).find((x) => x && lc(x.ats) === ats && x.slug && lc(x.name) === lc(job.company));
    if (c) slug = String(c.slug);
  }
  return id && slug ? { ats: ats as Ats, slug, id, eu: false } : null;
}

export function apiUrl(src: SourceLike): string {
  // String() spells a missing field "undefined", as encodeURIComponent would.
  const s = encodeURIComponent(String(src.slug)), i = encodeURIComponent(String(src.id));
  if (src.ats === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs/${i}`;
  if (src.ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
  if (src.ats === "lever") return `https://api${src.eu ? ".eu" : ""}.lever.co/v0/postings/${s}/${i}?mode=json`;
  return "";
}

// Greenhouse escapes its HTML once (&lt;p&gt;...), so it has to be decoded before parsing.
const NAMED: Record<string, string | undefined> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export function decodeEntities(s: unknown): string {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m: string, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escText = (s: unknown): string => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

export function extractHtml(src: SourceLike | null | undefined, data: unknown): string {
  if (!src || !data || typeof data !== "object") return "";
  const d = data as Rec;
  if (src.ats === "greenhouse") return typeof d.content === "string" ? decodeEntities(d.content) : "";
  if (src.ats === "ashby") {
    const job = (Array.isArray(d.jobs) ? (d.jobs as (Rec | null)[]) : []).find((j) => j && String(j.id) === String(src.id));
    return job ? String(job.descriptionHtml || (job.descriptionPlain ? `<p>${escText(job.descriptionPlain)}</p>` : "")) : "";
  }
  if (src.ats === "lever") {
    const lists = (Array.isArray(d.lists) ? (d.lists as (Rec | null)[]) : []).map((l) => `${l && l.text ? `<h3>${escText(l.text)}</h3>` : ""}<ul>${(l && l.content) || ""}</ul>`).join("");
    const body = d.description || (d.descriptionPlain ? `<p>${escText(d.descriptionPlain)}</p>` : "");
    return body || lists ? String(body) + lists + String(d.additional || "") : "";
  }
  return "";
}

// Keep the posting's words and basic structure; drop scripts, styles, images, forms,
// inline styles and event handlers. Links stay only when they are http(s).
const KEEP = new Set("P BR UL OL LI STRONG B EM I U H1 H2 H3 H4 H5 H6 BLOCKQUOTE A DIV SPAN SECTION TABLE THEAD TBODY TR TD TH HR SUB SUP CODE PRE SMALL".split(" "));
const DROP = new Set("SCRIPT STYLE IFRAME FRAME OBJECT EMBED FORM INPUT BUTTON SELECT TEXTAREA IMG PICTURE SVG MATH LINK META NOSCRIPT TEMPLATE VIDEO AUDIO SOURCE CANVAS HEAD TITLE BASE".split(" "));
export function sanitizeHtml(html: unknown, doc: Document): DocumentFragment {
  const out = doc.createDocumentFragment();
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const copy = (from: Node, to: Node) => {
    for (const n of Array.from(from.childNodes)) {
      if (n.nodeType === 3) { to.appendChild(doc.createTextNode(n.nodeValue as string)); continue; }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const tag = e.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (!KEEP.has(tag)) { copy(e, to); continue; }
      const el = doc.createElement(tag.toLowerCase());
      if (tag === "A") {
        const href = String(e.getAttribute("href") || "").trim();
        if (/^https?:\/\//i.test(href)) { el.setAttribute("href", href); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
      }
      copy(e, el);
      to.appendChild(el);
    }
  };
  copy(parsed.body, out);
  return out;
}
