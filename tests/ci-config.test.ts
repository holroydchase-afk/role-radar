// CI gate: every PR and push to main runs the privacy check and the full suite, and Pages only
// deploys a commit that ci passed on main. Parses the workflow YAML so a refactor can't drop a step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

type Step = { run?: string; uses?: string; name?: string; with?: Record<string, string>; "continue-on-error"?: boolean };
type Job = { steps?: Step[]; needs?: string | string[]; if?: string };
const wf = (name: string) => yaml.load(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
const runs = (w: { jobs?: Record<string, Job> }) => Object.values(w.jobs || {}).flatMap((j) => (j.steps || []).map((s) => String(s.run || "")));

test("RR-CI-1 ci runs on every pull request and on push to main", () => {
  const ci = wf("ci.yml");
  assert.equal(ci.name, "ci");
  assert.ok("pull_request" in ci.on, "on: pull_request");
  const pr = ci.on.pull_request;
  assert.ok(pr == null || (!pr.branches && !pr.paths), "pull_request is not narrowed to some branches or paths");
  assert.deepEqual(ci.on.push?.branches, ["main"]);
});

test("RR-CI-2 ci runs npm test and the personal-data check", () => {
  const steps = runs(wf("ci.yml"));
  assert.ok(steps.some((r) => /^\s*npm (run )?test\b/m.test(r)), "a step runs npm test: " + JSON.stringify(steps));
  assert.ok(steps.some((r) => /check-private\.mjs|npm run check:private/.test(r)), "a step runs the personal-data check");
  for (const j of Object.values<Job>(wf("ci.yml").jobs)) for (const s of j.steps || []) assert.notEqual(s["continue-on-error"], true, `${s.name || s.run} can't fail silently`);
});

test("RR-CI-3 pages deploys only after ci succeeds on a push to main", () => {
  const pages = wf("pages.yml");
  assert.equal(pages.on.push, undefined, "pages is not triggered straight from a push");
  assert.equal(pages.on.pull_request, undefined);
  const wr = pages.on.workflow_run;
  assert.ok(wr, "triggered by workflow_run");
  assert.deepEqual(wr.workflows, ["ci"]);
  assert.deepEqual(wr.types, ["completed"]);
  assert.deepEqual(wr.branches, ["main"]);
  const build = pages.jobs.build;
  assert.match(build.if, /workflow_run\.conclusion == 'success'/, "build is gated on ci's success");
  assert.match(build.if, /workflow_run\.event == 'push'/, "and on ci having run for a push (not a PR from a branch named main)");
  const checkout = build.steps.find((s: Step) => String(s.uses || "").startsWith("actions/checkout"));
  assert.match(String(checkout?.with?.ref || ""), /workflow_run\.head_sha/, "deploys the exact commit ci tested");
  const deploy = Object.entries<Job>(pages.jobs).find(([, j]) => (j.steps || []).some((s) => String(s.uses || "").startsWith("actions/deploy-pages")));
  assert.ok(deploy, "a deploy-pages job exists");
  assert.ok(([] as string[]).concat(deploy[1].needs || []).includes("build"), "deploy needs the gated build job");
});
