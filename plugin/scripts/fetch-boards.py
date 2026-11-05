#!/usr/bin/env python3
"""Role Radar board fetcher.

Reads every company board straight from the Greenhouse, Ashby and Lever
public APIs, filters PM titles (Product Manager/Lead/Owner/Management) in code (no truncation), and repairs board
addresses: when a company's board fails on its recorded ATS, the other two
are tried with the same slug (plus any altSlugs on the company doc).

Workday boards (ats "workday") are read too, from the public careers-site
feed every *.myworkdayjobs.com site uses. Their slug is "<tenant>.<wdN>/<site>",
e.g. "usaa.wd1/USAAJOBSWD" for usaa.wd1.myworkdayjobs.com/USAAJOBSWD. An
optional wdFacets object on the company doc ({"jobFamilyGroup": [ids]})
narrows a huge board to the job families worth reading. Workday boards are
never self-healed onto other ATSs. A Workday company doc with no "/" in its
slug is a placeholder (covered by job alerts) and is skipped.

Two more careers-site feeds are read with a keyword search ("product"), paged
to the end, then filtered in code like every other board:
  ats "eightfold": slug "<host>|<domain>", e.g.
    "searchjobs.libertymutualgroup.com|libertymutual.com"
  ats "jibe": slug "<host>", e.g. "jobs.statefarm.com"
  ats "smartrecruiters": slug "<company identifier>", e.g. "ServiceNow"
    (public postings API, searched for "product")
Industry board Tech Jobs for Good (ats "techjobsforgood"): slug = search
  queries joined by "|", e.g. "product manager|product lead"; its jobs carry
  their own "company" field.
Rippling boards (ats "rippling") are read in full from the public board API:
  slug "<board>", e.g. "arcadiacareers" for ats.rippling.com/arcadiacareers/jobs

Usage:
  python3 -I fetch-boards.py <companies_dir> [--monday] [--out FILE]

<companies_dir> holds one JSON file per company doc, as written by
ArtifactData list with out_dir (e.g. <dir>/companies/greenhouse-span.json).
The doc may be the bare data object or {"id":..., "data": {...}}.

Prints a JSON report (see REPORT SHAPE at the bottom). Exit code 0 even when
boards fail; exit code 2 only when no board could be reached at all, which
means the shell has no network and the scan should fall back to WebFetch.
"""
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ATS_ORDER = ["greenhouse", "ashby", "lever"]
READABLE = ATS_ORDER + ["workday", "eightfold", "jibe", "smartrecruiters", "rippling", "techjobsforgood", "oracle"]
SEARCH_WORD = "product"
SEARCH_MAX_PAGES = 30
WD_PAGE = 20      # Workday rejects bigger pages
WD_MAX_PAGES = 40  # 800 jobs; past that the read counts as partial
TITLE_RE = re.compile(r"product (manager|lead|owner|management)", re.I)
UA = "RoleRadar/1.0 (personal job tracker)"
TIMEOUT = 25


def board_url(ats, slug):
    if ats == "greenhouse":
        return f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
    if ats == "ashby":
        return f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"
    if ats == "lever":
        return f"https://api.lever.co/v0/postings/{slug}?mode=json"
    raise ValueError(ats)


def get_json(url):
    """Returns (status, payload). status is an int HTTP code, or 0 for a
    network-level failure. Retries once on 429/5xx/network errors."""
    last = (0, None)
    for attempt in range(2):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = (e.code, None)
            if e.code not in (429, 500, 502, 503, 504):
                return last
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            last = (0, str(e))
        time.sleep(2 + 3 * attempt)
    return last


def post_json(url, body):
    """POST version of get_json, same return shape and retry rule."""
    last = (0, None)
    data = json.dumps(body).encode("utf-8")
    for attempt in range(2):
        req = urllib.request.Request(url, data=data, method="POST", headers={
            "User-Agent": UA, "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = (e.code, None)
            if e.code not in (429, 500, 502, 503, 504):
                return last
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            last = (0, str(e))
        time.sleep(2 + 3 * attempt)
    return last


def wd_date(posted, today=None):
    """'Posted Today' / 'Posted Yesterday' / 'Posted 3 Days Ago' -> YYYY-MM-DD.
    '30+ Days Ago' and anything unreadable -> ''."""
    t = (posted or "").lower()
    now = today if today is not None else time.time()
    if "today" in t:
        days = 0
    elif "yesterday" in t:
        days = 1
    else:
        m = re.search(r"(\d+)\s+days?\s+ago", t)
        if not m or "+" in t:
            return ""
        days = int(m.group(1))
    return time.strftime("%Y-%m-%d", time.gmtime(now - days * 86400))


def try_workday(slug, facets=None):
    """Reads a Workday board page by page. ok=true with partial=true when the
    board is bigger than WD_MAX_PAGES pages (never close jobs from it)."""
    host_part, _, site = slug.partition("/")
    tenant = host_part.split(".")[0]
    if not site or "." not in host_part:
        return {"ok": False, "ats": "workday", "slug": slug, "error": "slug must be tenant.wdN/site"}
    base = f"https://{host_part}.myworkdayjobs.com"
    url = f"{base}/wday/cxs/{tenant}/{site}/jobs"
    jobs, offset, total, partial = [], 0, None, False
    for page in range(WD_MAX_PAGES):
        status, payload = post_json(url, {"appliedFacets": facets or {}, "limit": WD_PAGE,
                                          "offset": offset, "searchText": ""})
        if status != 200:
            return {"ok": False, "ats": "workday", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        if not isinstance(payload, dict) or "jobPostings" not in payload:
            return {"ok": False, "ats": "workday", "slug": slug, "error": "not a job board"}
        if total is None:
            total = int(payload.get("total") or 0)
        posts = payload.get("jobPostings") or []
        for j in posts:
            path = j.get("externalPath") or ""
            ids = j.get("bulletFields") or []
            jobs.append({
                "id": str(ids[0] if ids else path.rsplit("_", 1)[-1]),
                "title": j.get("title") or "",
                "location": j.get("locationsText") or "",
                "url": f"{base}/{site}{path}" if path else "",
                "date": wd_date(j.get("postedOn")),
                "comp": "",
            })
        offset += WD_PAGE
        if not posts or offset >= total:
            break
    else:
        partial = offset < (total or 0)
    pm = [j for j in jobs if TITLE_RE.search(j["title"])]
    out = {"ok": True, "ats": "workday", "slug": slug, "total": total or len(jobs), "pmJobs": pm}
    if partial:
        out["partial"] = True
    return out


def try_eightfold(slug):
    host, _, domain = slug.partition("|")
    if not host or not domain:
        return {"ok": False, "ats": "eightfold", "slug": slug, "error": "slug must be host|domain"}
    jobs, start, total = [], 0, None
    for page in range(SEARCH_MAX_PAGES):
        url = (f"https://{host}/api/apply/v2/jobs?domain={urllib.parse.quote(domain)}"
               f"&query={SEARCH_WORD}&start={start}&num=10")
        status, payload = get_json(url)
        if status != 200:
            return {"ok": False, "ats": "eightfold", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        if not isinstance(payload, dict) or "positions" not in payload:
            return {"ok": False, "ats": "eightfold", "slug": slug, "error": "not a job board"}
        if total is None:
            total = int(payload.get("count") or 0)
        posts = payload.get("positions") or []
        for j in posts:
            created = j.get("t_create")
            jobs.append({
                "id": str(j.get("ats_job_id") or j.get("id")),
                "title": j.get("name") or "",
                "location": "; ".join(j.get("locations") or []) or j.get("location") or "",
                "url": j.get("canonicalPositionUrl") or "",
                "date": time.strftime("%Y-%m-%d", time.gmtime(int(created))) if created else "",
                "comp": "",
                "workplace": j.get("work_location_option") or "",
            })
        start += len(posts)
        if not posts or start >= total:
            break
    else:
        return _search_result("eightfold", slug, jobs, total, partial=True)
    return _search_result("eightfold", slug, jobs, total)


def try_jibe(slug):
    host = slug.strip("/")
    jobs, total = [], None
    for page in range(1, SEARCH_MAX_PAGES + 1):
        status, payload = get_json(f"https://{host}/api/jobs?keywords={SEARCH_WORD}&page={page}&limit=100")
        if status != 200:
            return {"ok": False, "ats": "jibe", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        if not isinstance(payload, dict) or "jobs" not in payload:
            return {"ok": False, "ats": "jibe", "slug": slug, "error": "not a job board"}
        if total is None:
            total = int(payload.get("totalCount") or 0)
        posts = payload.get("jobs") or []
        for w in posts:
            j = w.get("data") or {}
            jobs.append({
                "id": str(j.get("req_id") or j.get("slug")),
                "title": j.get("title") or "",
                "location": j.get("full_location") or j.get("location_name") or "",
                "url": f"https://{host}/main/jobs/{j.get('slug')}" if j.get("slug") else "",
                "date": (j.get("posted_date") or "")[:10],
                "comp": "",
                "workplace": ", ".join(t for t in (j.get("tags6") or []) if isinstance(t, str)),
            })
        if not posts or len(jobs) >= total:
            break
    else:
        return _search_result("jibe", slug, jobs, total, partial=True)
    return _search_result("jibe", slug, jobs, total)


def get_text(url):
    """Like get_json, for HTML pages. Returns (status, text)."""
    last = (0, None)
    for attempt in range(2):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = (e.code, None)
            if e.code not in (429, 500, 502, 503, 504):
                return last
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = (0, str(e))
        time.sleep(2 + 3 * attempt)
    return last


TJFG_CARD = re.compile(
    r'href="/jobs/(\d+)/[^"]*".*?class="header job-title"\s+title="([^"]*)".*?'
    r'class="meta company-name"\s+title="([^"]*)".*?class="location" title="([^"]*)"'
    r'(?:.*?class="salary"\s+title="([^"]*)")?.*?class="date-posted">\s*([^<]*?)\s*<',
    re.S)


def try_techjobsforgood(slug):
    """Tech Jobs for Good (an industry board, not one company). slug = search
    queries separated by "|"; each search page is read and deduped. Every job
    carries its own "company"."""
    import html as _html
    jobs, seen = [], set()
    for q in [x.strip() for x in slug.split("|") if x.strip()] or ["product manager"]:
        status, page = get_text("https://www.techjobsforgood.com/jobs/?q=" + urllib.parse.quote_plus(q))
        if status != 200:
            return {"ok": False, "ats": "techjobsforgood", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {page}"}
        for card in page.split('class="ui raised fluid card job-card"')[1:]:
            m = TJFG_CARD.search(card)
            if not m or m.group(1) in seen:
                continue
            seen.add(m.group(1))
            jid, title, company, loc, sal, posted = (_html.unescape(g or "") for g in m.groups())
            jobs.append({
                "id": jid, "title": title, "company": company, "location": loc,
                "url": f"https://www.techjobsforgood.com/jobs/{jid}/",
                "date": "", "posted": posted, "comp": sal,
                "workplace": "Remote" if "remote" in loc.lower() else "",
            })
    return _search_result("techjobsforgood", slug, jobs, len(jobs))


def try_smartrecruiters(slug):
    company = slug.strip("/")
    jobs, total, offset = [], None, 0
    for _ in range(SEARCH_MAX_PAGES):
        status, payload = get_json(f"https://api.smartrecruiters.com/v1/companies/{company}/postings?q={SEARCH_WORD}&limit=100&offset={offset}")
        if status != 200:
            return {"ok": False, "ats": "smartrecruiters", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        if not isinstance(payload, dict) or "content" not in payload:
            return {"ok": False, "ats": "smartrecruiters", "slug": slug, "error": "not a job board"}
        if total is None:
            total = int(payload.get("totalFound") or 0)
        posts = payload.get("content") or []
        for j in posts:
            loc = j.get("location") or {}
            where = loc.get("fullLocation") or ", ".join(x for x in (loc.get("city"), loc.get("region"), loc.get("country")) if x)
            jobs.append({
                "id": str(j.get("id")),
                "title": j.get("name") or "",
                "location": f"{where} (Remote)" if loc.get("remote") else where,
                "url": f"https://jobs.smartrecruiters.com/{company}/{j.get('id')}",
                "date": (j.get("releasedDate") or "")[:10],
                "comp": "",
                "workplace": "Remote" if loc.get("remote") else ("Hybrid" if loc.get("hybrid") else "On-site"),
            })
        offset += len(posts)
        if not posts or offset >= total:
            break
    else:
        return _search_result("smartrecruiters", slug, jobs, total, partial=True)
    return _search_result("smartrecruiters", slug, jobs, total)


def try_oracle(slug):
    """Oracle Recruiting Cloud careers sites (e.g. Verisk). slug "<host>|<siteNumber>",
    e.g. "fa-ewmy-saasfaprod1.fa.ocs.oraclecloud.com|CX_1". Keyword "product" keeps the read small."""
    if "|" not in slug:
        return {"ok": False, "ats": "oracle", "slug": slug, "error": "slug must be host|siteNumber"}
    host, site = slug.split("|", 1)
    jobs, total, offset = [], None, 0
    for _ in range(10):
        url = (f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true"
               f"&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},keyword=product,limit=100,offset={offset}")
        status, payload = get_json(url)
        if status != 200:
            return {"ok": False, "ats": "oracle", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        items = (payload or {}).get("items") if isinstance(payload, dict) else None
        if not items:
            return {"ok": False, "ats": "oracle", "slug": slug, "error": "not a job board"}
        head = items[0]
        if total is None:
            total = int(head.get("TotalJobsCount") or 0)
        batch = head.get("requisitionList") or []
        for j in batch:
            wp = (j.get("WorkplaceType") or "")
            loc = j.get("PrimaryLocation") or ""
            if wp:
                loc = f"{loc} ({wp})".strip()
            jobs.append({
                "id": str(j.get("Id")),
                "title": j.get("Title") or "",
                "location": loc,
                "url": f"https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{j.get('Id')}",
                "date": (j.get("PostedDate") or "")[:10],
                "comp": "",
                "workplace": wp,
            })
        offset += 100
        if not batch or offset >= (total or 0):
            break
    else:
        return _search_result("oracle", slug, jobs, total, partial=True)
    return _search_result("oracle", slug, jobs, total)


def try_rippling(slug):
    board = slug.strip("/")
    jobs, total = [], None
    for page in range(SEARCH_MAX_PAGES):
        status, payload = get_json(f"https://ats.rippling.com/api/v2/board/{board}/jobs?page={page}&pageSize=100")
        if status != 200:
            return {"ok": False, "ats": "rippling", "slug": slug,
                    "error": f"HTTP {status}" if status else f"network: {payload}"}
        if not isinstance(payload, dict) or "items" not in payload:
            return {"ok": False, "ats": "rippling", "slug": slug, "error": "not a job board"}
        if total is None:
            total = int(payload.get("totalItems") or 0)
        for j in payload.get("items") or []:
            locs = j.get("locations") or []
            jobs.append({
                "id": str(j.get("id")),
                "title": j.get("name") or "",
                "location": "; ".join(l.get("name") or "" for l in locs),
                "url": j.get("url") or f"https://ats.rippling.com/{board}/jobs/{j.get('id')}",
                "date": "",
                "comp": "",
                "workplace": ", ".join(sorted({l.get("workplaceType") or "" for l in locs} - {""})),
            })
        if page + 1 >= int(payload.get("totalPages") or 1):
            break
    else:
        return _search_result("rippling", slug, jobs, total, partial=True)
    return _search_result("rippling", slug, jobs, total)


def _search_result(ats, slug, jobs, total, partial=False):
    pm = [j for j in jobs if TITLE_RE.search(j["title"])]
    out = {"ok": True, "ats": ats, "slug": slug, "total": total or len(jobs), "pmJobs": pm}
    if partial:
        out["partial"] = True
    return out


def parse(ats, payload):
    """Normalizes a board payload to (total, pm_jobs). Returns None when the
    payload is not a job board (wrong shape)."""
    jobs = []
    if ats == "greenhouse":
        if not isinstance(payload, dict) or "jobs" not in payload:
            return None
        for j in payload["jobs"]:
            jobs.append({
                "id": str(j.get("id")),
                "title": j.get("title") or "",
                "location": (j.get("location") or {}).get("name", ""),
                "url": j.get("absolute_url", ""),
                "date": (j.get("updated_at") or "")[:10],
                "comp": "",
            })
    elif ats == "ashby":
        if not isinstance(payload, dict) or "jobs" not in payload:
            return None
        for j in payload["jobs"]:
            if j.get("isListed") is False:
                continue
            comp = j.get("compensation") or {}
            loc = j.get("location") or ""
            wp = (j.get("workplaceType") or "").lower()
            # Ashby sets isRemote on some hybrid/office roles (Plaid NYC, Nov 1); trust workplaceType first.
            if wp in ("hybrid", "onsite", "on-site"):
                loc = f"{loc} ({j.get('workplaceType')})".strip()
            elif j.get("isRemote") and "remote" not in loc.lower():
                loc = f"{loc} (Remote)".strip()
            jobs.append({
                "id": str(j.get("id")),
                "title": j.get("title") or "",
                "location": loc,
                "url": j.get("jobUrl", ""),
                "date": (j.get("publishedAt") or "")[:10],
                "comp": comp.get("compensationTierSummary") or comp.get("scrapeableCompensationSalarySummary") or "",
                "workplace": j.get("workplaceType") or "",
            })
    elif ats == "lever":
        if not isinstance(payload, list):
            return None
        for j in payload:
            cats = j.get("categories") or {}
            sal = j.get("salaryRange") or {}
            comp = ""
            if sal.get("min") or sal.get("max"):
                comp = f"{sal.get('currency', 'USD')} {sal.get('min', '')}-{sal.get('max', '')}"
            created = j.get("createdAt")
            jobs.append({
                "id": str(j.get("id")),
                "title": j.get("text") or "",
                "location": cats.get("location") or ", ".join(cats.get("allLocations") or []),
                "url": j.get("hostedUrl", ""),
                "date": time.strftime("%Y-%m-%d", time.gmtime(created / 1000)) if created else "",
                "comp": comp,
                "workplace": j.get("workplaceType") or "",
            })
    pm = [j for j in jobs if TITLE_RE.search(j["title"])]
    return len(jobs), pm


def try_board(ats, slug):
    status, payload = get_json(board_url(ats, slug))
    if status != 200:
        return {"ok": False, "ats": ats, "slug": slug,
                "error": f"HTTP {status}" if status else f"network: {payload}"}
    parsed = parse(ats, payload)
    if parsed is None:
        return {"ok": False, "ats": ats, "slug": slug, "error": "not a job board"}
    total, pm = parsed
    return {"ok": True, "ats": ats, "slug": slug, "total": total, "pmJobs": pm}


def load_companies(path):
    out = []
    for f in sorted(glob.glob(os.path.join(path, "**", "*.json"), recursive=True)):
        with open(f) as fh:
            doc = json.load(fh)
        data = doc.get("data", doc) if isinstance(doc, dict) else {}
        doc_id = doc.get("id") if isinstance(doc, dict) and "data" in doc else os.path.basename(f)[:-5]
        if data.get("ats") == "workday" and "/" not in str(data.get("slug") or ""):
            continue  # placeholder: no readable board, covered by job alerts
        if data.get("ats") in READABLE and data.get("slug"):
            out.append((doc_id, data))
    return out


def check_company(doc_id, c):
    if c["ats"] == "workday":
        first = try_workday(c["slug"], c.get("wdFacets"))
    elif c["ats"] == "eightfold":
        first = try_eightfold(c["slug"])
    elif c["ats"] == "jibe":
        first = try_jibe(c["slug"])
    elif c["ats"] == "smartrecruiters":
        first = try_smartrecruiters(c["slug"])
    elif c["ats"] == "rippling":
        first = try_rippling(c["slug"])
    elif c["ats"] == "oracle":
        first = try_oracle(c["slug"])
    elif c["ats"] == "techjobsforgood":
        first = try_techjobsforgood(c["slug"])
    else:
        first = try_board(c["ats"], c["slug"])
    rec = {
        "docId": doc_id, "name": c.get("name", ""), "industry": c.get("industry", ""),
        "status": c.get("status", ""), "recordedAts": c["ats"], "recordedSlug": c["slug"],
    }
    if first["ok"]:
        rec.update(first, result="read", movedTo=None)
        return rec
    if c["ats"] not in ATS_ORDER:
        rec.update(ok=False, result="failed", movedTo=None, error=f"{c['ats']}:{c['slug']} {first.get('error', 'empty')}")
        return rec
    # Self-heal: same slug on the other two ATSs, then any altSlugs everywhere.
    attempts = [first]
    candidates = [(a, c["slug"]) for a in ATS_ORDER if a != c["ats"]]
    for alt in c.get("altSlugs") or []:
        candidates += [(a, alt) for a in ATS_ORDER]
    for ats, slug in candidates:
        r = try_board(ats, slug)
        attempts.append(r)
        if r["ok"] and r["total"] > 0:
            rec.update(r, result="moved", movedTo=f"{ats}:{slug}")
            return rec
    rec.update(ok=False, result="failed", movedTo=None,
               error="; ".join(f"{a['ats']}:{a['slug']} {a.get('error', 'empty')}" for a in attempts))
    return rec


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 1
    monday = "--monday" in argv
    out_file = argv[argv.index("--out") + 1] if "--out" in argv else None
    companies = [
        (i, c) for i, c in load_companies(argv[1])
        if c.get("status") != "vetoed" and (monday or c.get("status") != "not_found")
    ]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda ic: check_company(*ic), companies))
    reached = [r for r in results if r["ok"] or "HTTP" in (r.get("error") or "")]
    report = {
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "network": bool(reached),
        "attempted": len(results),
        "read": sum(r["result"] == "read" for r in results),
        "moved": [{"docId": r["docId"], "name": r["name"], "from": f"{r['recordedAts']}:{r['recordedSlug']}", "to": r["movedTo"]}
                  for r in results if r["result"] == "moved"],
        "failed": [{"docId": r["docId"], "name": r["name"], "error": r["error"]}
                   for r in results if r["result"] == "failed"],
        "boards": results,
    }
    text = json.dumps(report, indent=1)
    if out_file:
        with open(out_file, "w") as fh:
            fh.write(text)
    else:
        print(text)
    return 0 if report["network"] else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

# REPORT SHAPE
# {fetchedAt, network: bool, attempted, read,
#  moved: [{docId, name, from: "ats:slug", to: "ats:slug"}],
#  failed: [{docId, name, error}],
#  boards: [{docId, name, industry, status, recordedAts, recordedSlug,
#            ok, result: read|moved|failed, movedTo, ats, slug, total, partial?,
#            pmJobs: [{id, title, location, url, date, comp, workplace?}], error?}]}
# Every board with ok=true and no partial flag was read in full, so
# closed-job detection is safe on it. partial=true (only Workday boards over
# WD_MAX_PAGES pages) means readMode "partial".
