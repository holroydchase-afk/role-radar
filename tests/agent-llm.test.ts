/* RR-AGENT PR 1: Llm contract (AG-5, AG-6). No network: globalThis.fetch is stubbed.
 *
 * agent/llm.ts exports:
 *   interface Llm { call(req): Promise<LlmResponse> }
 *     req = { model: string, system?: string, messages: [{role, content}], tools?: [{name, description, input_schema}], maxTokens?: number }
 *     LlmResponse = { text: string, toolCalls: [{id, name, input}], usage: {input, output}, model: string, stopReason?: string }
 *   anthropicLlm(apiKey?: string): Llm   uses global fetch. apiKey omitted -> process.env.ANTHROPIC_API_KEY.
 *       Missing key: throws (at creation or at first call) an Error naming ANTHROPIC_API_KEY, BEFORE any fetch.
 *       POST https://api.anthropic.com/v1/messages, headers x-api-key, anthropic-version, content-type: application/json.
 *       usage.input_tokens/output_tokens -> usage.input/output; content type "text" -> text; "tool_use" -> toolCalls.
 *       Non-2xx: throws with the status; the message never contains the key.
 *   fakeLlm(script): Llm  script = array of {text?, toolCalls?, usage?} consumed in order; records every req on .calls;
 *       an exhausted script throws. usage defaults to {input:0, output:0}.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { anthropicLlm, fakeLlm } from "../agent/llm.ts";

const KEY = "sk-ant-TEST-KEY-not-real-123456";
const realFetch = globalThis.fetch;
const realEnv = process.env.ANTHROPIC_API_KEY;
let seen: { url: string; init: any }[] = [];
let captured = "";
const origLog = { log: console.log, error: console.error, warn: console.warn };
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);

const apiReply = {
  id: "msg_demo", model: "m-test", stop_reason: "tool_use",
  content: [
    { type: "text", text: "Scoring it now." },
    { type: "tool_use", id: "toolu_1", name: "score", input: { roleId: "r1" } },
  ],
  usage: { input_tokens: 120, output_tokens: 30 },
};

beforeEach(() => {
  seen = []; captured = "";
  process.env.ANTHROPIC_API_KEY = KEY;
  globalThis.fetch = (async (url: any, init: any) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(apiReply), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realEnv === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realEnv;
  console.log = origLog.log; console.error = origLog.error; console.warn = origLog.warn;
  process.stdout.write = origOut as any; process.stderr.write = origErr as any;
});

const capture = () => {
  const grab = (...a: any[]) => { captured += a.map(String).join(" ") + "\n"; };
  console.log = grab; console.error = grab; console.warn = grab;
  process.stdout.write = ((s: any) => { captured += String(s); return true; }) as any;
  process.stderr.write = ((s: any) => { captured += String(s); return true; }) as any;
};

const req = {
  model: "m-test", system: "You are a job-hunt agent.",
  messages: [{ role: "user", content: "Find roles." }],
  tools: [{ name: "score", description: "Score a role", input_schema: { type: "object", properties: { roleId: { type: "string" } } } }],
  maxTokens: 512,
};

test("AG-5 posts to the Messages API with model, tools and x-api-key from env", async () => {
  const out = await anthropicLlm().call(req);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[0].init.method, "POST");
  const h = new Headers(seen[0].init.headers);
  assert.equal(h.get("x-api-key"), KEY);
  assert.ok(h.get("anthropic-version"), "anthropic-version header set");
  assert.match(h.get("content-type") ?? "", /application\/json/);
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "m-test");
  assert.deepEqual(body.tools, req.tools);
  assert.deepEqual(body.messages, req.messages);
  assert.equal(body.system, req.system);
  assert.equal(body.max_tokens, 512);
  assert.ok(out);
});

test("AG-5 an explicit apiKey argument wins over env", async () => {
  await anthropicLlm("sk-ant-explicit-demo").call(req);
  assert.equal(new Headers(seen[0].init.headers).get("x-api-key"), "sk-ant-explicit-demo");
});

test("AG-5 maps usage and tool_use blocks", async () => {
  const out = await anthropicLlm().call(req);
  assert.deepEqual(out.usage, { input: 120, output: 30 });
  assert.equal(out.text, "Scoring it now.");
  assert.deepEqual(out.toolCalls, [{ id: "toolu_1", name: "score", input: { roleId: "r1" } }]);
  assert.equal(out.model, "m-test");
});

test("AG-5 never prints the key, on success or on an API error", async () => {
  capture();
  await anthropicLlm().call(req);
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 })) as any;
  let msg = "";
  try { await anthropicLlm().call(req); } catch (e: any) { msg = String(e?.message ?? e) + String(e?.stack ?? ""); }
  assert.match(msg, /401/, "error carries the status");
  assert.ok(!msg.includes(KEY), "error text does not contain the key");
  assert.ok(!captured.includes(KEY), "nothing logged contains the key");
});

test("AG-6 ANTHROPIC_API_KEY unset: clear message, no request made", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(async () => { await anthropicLlm().call(req); }, /ANTHROPIC_API_KEY/);
  await assert.rejects(async () => { await anthropicLlm("").call(req); }, /ANTHROPIC_API_KEY/);
  assert.equal(seen.length, 0, "fetch was never called");
});

test("AG-1 fakeLlm returns scripted usage and tool calls in order, and records requests", async () => {
  const llm = fakeLlm([
    { text: "first", usage: { input: 120, output: 30 } },
    { toolCalls: [{ id: "t1", name: "scan", input: {} }], usage: { input: 5, output: 6 } },
  ]);
  const a = await llm.call(req);
  assert.deepEqual(a.usage, { input: 120, output: 30 });
  assert.equal(a.text, "first");
  assert.deepEqual(a.toolCalls, []);
  const b = await llm.call(req);
  assert.deepEqual(b.toolCalls, [{ id: "t1", name: "scan", input: {} }]);
  assert.equal((llm as any).calls.length, 2);
  assert.equal((llm as any).calls[0].model, "m-test");
  await assert.rejects(async () => { await llm.call(req); }, /script/i);
  assert.equal(seen.length, 0, "fake never touches fetch");
});
