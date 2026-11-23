// RR-AGENT loop: the model chooses tools until it answers with no tool call. Kill switch and cap checked every step.
import { SONNET_MODEL } from "./config.ts";
import { CapExceeded, KilledError } from "./harness.ts";
import type { Harness } from "./harness.ts";
import type { Llm, Msg } from "./llm.ts";
import type { ToolDef } from "./tools.ts";

export type AgentResult = {
  stopReason: "final" | "max_turns" | "killed" | "cap_hit";
  exitCode: number;
  finalText: string;
  steps: number;
};

export async function runAgent(o: {
  llm: Llm; harness: Harness; tools: ToolDef[]; goal: string; maxSteps?: number;
}): Promise<AgentResult> {
  const { llm, harness, tools, goal } = o;
  const maxSteps = o.maxSteps ?? 12;
  const system = "You are a job-hunt agent. Use the tools to scan roles, score them, tailor drafts and track them. You only draft: you cannot send anything, and you must never claim a draft was sent.";
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  const messages: Msg[] = [{ role: "user", content: goal }];
  let steps = 0;

  try {
    while (steps < maxSteps) {
      harness.checkKill();
      const res = await llm.call({ model: SONNET_MODEL, system, messages: [...messages], tools: toolDefs, maxTokens: 2000 });
      steps++;
      harness.record(res.usage, SONNET_MODEL);
      if (res.toolCalls.length === 0) return { stopReason: "final", exitCode: 0, finalText: res.text, steps };

      const assistant: unknown[] = [];
      if (res.text) assistant.push({ type: "text", text: res.text });
      for (const c of res.toolCalls) assistant.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      messages.push({ role: "assistant", content: assistant });

      const results: unknown[] = [];
      for (const c of res.toolCalls) {
        harness.checkKill();
        const tool = tools.find((t) => t.name === c.name);
        try {
          if (!tool) throw new Error(`unknown tool: ${c.name}`);
          const out = await tool.run(c.input);
          harness.log({ event: "tool_call", tool: c.name, ok: true });
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) ?? "null" });
        } catch (e) {
          if (e instanceof KilledError || e instanceof CapExceeded) throw e;
          harness.log({ event: "tool_call", tool: c.name, ok: false });
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ type: "tool_result", tool_use_id: c.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    harness.log({ event: "max_turns", steps });
    return { stopReason: "max_turns", exitCode: 5, finalText: "", steps };
  } catch (e) {
    if (e instanceof KilledError) return { stopReason: "killed", exitCode: e.exitCode ?? 4, finalText: "", steps };
    if (e instanceof CapExceeded) return { stopReason: "cap_hit", exitCode: e.exitCode ?? 3, finalText: "", steps };
    throw e;
  }
}
