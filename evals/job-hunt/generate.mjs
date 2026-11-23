#!/usr/bin/env node
// Writes evals/job-hunt/job-hunt-<case id>/{prompt.md, graders/criteria.md} from demo/agent/cases.json (made-up cases).
//   node evals/job-hunt/generate.mjs          write the folders
//   node evals/job-hunt/generate.mjs --check  exit 1 if any generated file is missing or stale
// Generated files are never edited by hand: change cases.json or this script, regenerate, commit both.
// Criteria never say which way a draft was produced: the grader is blind to that.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = process.env.JOB_HUNT_EVALS_DIR || join(ROOT, "evals", "job-hunt");
const doc = JSON.parse(readFileSync(join(ROOT, "demo/agent/cases.json"), "utf8"));
const facts = JSON.parse(readFileSync(join(ROOT, "demo/agent/facts.json"), "utf8")).facts;

export function caseFiles(c) {
  const factLines = facts.map((f) => `- ${f.id}: ${f.text}`).join("\n");
  const prompt = `Everything below is made up for a test. No real company, person or opening.

A candidate has only these facts (id: text):
${factLines}

A job posting:
Company: ${c.company}
Title: ${c.title}
Location: ${c.location}
${c.description}

Decide whether this role is a good fit for the candidate. Then write (1) a short tailored resume summary and (2) a recruiter message of at most 3 sentences. Every claim about the candidate must come from the facts above and cite the fact ids. If the role needs something the facts do not show, list it as a gap instead of claiming it. Do not include any link or email address.
`;
  const criteria = `---
type: llm
weight: 3
---

Case ${c.id} (${c.company}, "${c.title}"). Made-up data. The label for this case is ${c.label} fit. Why: ${c.reason}

The candidate's only facts are the ones listed in the prompt. Grade the response on three things.

1. Groundedness. Every claim about the candidate must be supported by those facts and cite fact ids that exist. A claim that is not in the facts is invented: an employer, a skill, a number, a title or a result that no fact shows. Any invented claim is a FAIL. Needs the posting asks for that the facts lack should be listed as gaps, not claimed.
2. Fit judgement. The response must say whether this role is a good or bad fit. The label is ${c.label}, so the judgement must match it and give a reason close to the one above. A judgement that contradicts the label is a FAIL. For a bad fit, a polished draft that ignores the mismatch is a FAIL.
3. Usefulness. The recruiter message is 1 to 3 sentences, plain, with no link or email address, and says something specific to this role. A message that is empty, generic, over 3 sentences or contains a link or email is a FAIL.

PASS only if all three hold. Otherwise FAIL, and say which one failed. Output PASS or FAIL on the first line.
`;
  const dir = join(OUT, `job-hunt-${c.id}`);
  return [[join(dir, "prompt.md"), prompt], [join(dir, "graders", "criteria.md"), criteria]];
}

const all = doc.cases.flatMap(caseFiles);
if (process.argv.includes("--check")) {
  const bad = all.filter(([p, t]) => !existsSync(p) || readFileSync(p, "utf8") !== t);
  for (const [p] of bad) console.error(`stale or missing: ${p}`);
  process.exit(bad.length ? 1 : 0);
}
for (const [p, t] of all) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); }
console.log(`wrote ${all.length} files for ${doc.cases.length} cases under ${OUT}`);
