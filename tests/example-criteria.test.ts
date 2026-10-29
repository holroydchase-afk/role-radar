// The live page embeds the repo's example criteria.yaml for a first-time user ("Start from the example").
// This keeps that copy in sync: if criteria.yaml changes, paste it into the exampleCriteria block in app/role-radar.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("app/role-radar.html embeds criteria.yaml verbatim as the example criteria (RR-M3.2)", () => {
  const m = /<script type="text\/plain" id="exampleCriteria">\n([\s\S]*?)<\/script>/.exec(read("app/role-radar.html"));
  assert.ok(m, "exampleCriteria block is in the page");
  assert.equal(m[1], read("criteria.yaml"), "the embedded example matches criteria.yaml; copy it over");
});
