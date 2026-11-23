// RR-AGENT Llm: the only file that calls fetch. fakeLlm is for tests.
export type Msg = { role: string; content: unknown };
export type ToolDef = { name: string; description: string; input_schema: unknown };
export type LlmRequest = { model: string; system?: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number };
export type ToolCall = { id: string; name: string; input: unknown };
export type LlmResponse = {
  text: string; toolCalls: ToolCall[]; usage: { input: number; output: number }; model: string; stopReason?: string;
};
export interface Llm { call(req: LlmRequest): Promise<LlmResponse> }

export function anthropicLlm(apiKey?: string): Llm {
  return {
    async call(req) {
      const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens ?? 1024, messages: req.messages };
      if (req.system !== undefined) body.system = req.system;
      if (req.tools) body.tools = req.tools;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Anthropic API error: HTTP ${res.status}`); // body not echoed: it could carry the key
      const j: any = await res.json();
      const blocks: any[] = Array.isArray(j.content) ? j.content : [];
      return {
        text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
        toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })),
        usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 },
        model: j.model ?? req.model,
        stopReason: j.stop_reason,
      };
    },
  };
}

export function fakeLlm(script: { text?: string; toolCalls?: ToolCall[]; usage?: { input: number; output: number } }[]): Llm & { calls: LlmRequest[] } {
  const queue = [...script];
  const calls: LlmRequest[] = [];
  return {
    calls,
    async call(req) {
      calls.push(req);
      const step = queue.shift();
      if (!step) throw new Error("fakeLlm script exhausted");
      return { text: step.text ?? "", toolCalls: step.toolCalls ?? [], usage: step.usage ?? { input: 0, output: 0 }, model: req.model };
    },
  };
}
