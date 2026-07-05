// aiAgent.js
// Bonus: Agentic AI helpers described in the "Bonus: Agentic AI" section of
// the brief. Uses the xAI Grok API when XAI_API_KEY is set; otherwise
// falls back to deterministic rule-based logic so every feature still works
// out of the box for a live demo without any API key or internet access.

const HAS_KEY = !!process.env.XAI_API_KEY;
const MODEL = "grok-4.3";

async function callGrok(systemPrompt, userPrompt) {
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`xAI API error: ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return text;
}

/**
 * "Use Vendor A for 70% traffic, Vendor B for 30%, but switch to Vendor C
 *  if latency crosses 2 seconds or error rate is above 5%."
 * -> structured routing config JSON.
 */
async function generateConfigFromText(instruction) {
  if (HAS_KEY) {
    try {
      const system = `You convert plain-English vendor routing instructions into a JSON routing config for an "Intelligent Vendor Routing Platform".
Return ONLY valid JSON, no markdown fences, no preamble, matching this shape:
{
  "capability": string,
  "strategy": "priority"|"weighted"|"lowest-latency"|"lowest-cost"|"failover"|"round-robin"|"feature-based"|"health-based",
  "vendors": [ { "name": string, "weight": number, "priority": number, "costPerRequest": number, "rateLimitPerMinute": number, "timeoutMs": number, "supportedFeatures": string[] } ],
  "failoverRules": [ { "condition": string, "action": string } ],
  "explanation": string
}
Infer sensible defaults for fields the instruction does not mention.`;
      const text = await callGrok(system, instruction);
      const clean = text.replace(/```json|```/g, "").trim();
      return { source: "llm", config: JSON.parse(clean) };
    } catch (err) {
      // fall through to rule-based fallback
    }
  }
  return { source: "rule-based-fallback", config: ruleBasedConfigFromText(instruction) };
}

function ruleBasedConfigFromText(instruction) {
  const text = instruction.toLowerCase();
  const vendorMatches = [...instruction.matchAll(/vendor\s*([a-z0-9]+)[^\d%]*(\d{1,3})\s*%/gi)];
  const vendors = vendorMatches.map((m) => ({
    name: `Vendor${m[1].toUpperCase()}`,
    weight: Number(m[2]),
    priority: 1,
    costPerRequest: 1.0,
    rateLimitPerMinute: 100,
    timeoutMs: 3000,
    supportedFeatures: [],
  }));
  const latencyMatch = text.match(/(\d+(?:\.\d+)?)\s*(second|sec|ms|millisecond)/);
  const errorMatch = text.match(/error rate[^\d]*(\d+(?:\.\d+)?)\s*%/);
  const failoverRules = [];
  if (latencyMatch) {
    const val = latencyMatch[2].startsWith("sec") ? Number(latencyMatch[1]) * 1000 : Number(latencyMatch[1]);
    failoverRules.push({ condition: `avgLatencyMs > ${val}`, action: "switch to fallback vendor" });
  }
  if (errorMatch) {
    failoverRules.push({ condition: `errorRate > ${errorMatch[1]}%`, action: "switch to fallback vendor" });
  }
  return {
    capability: "GENERIC",
    strategy: vendors.length > 1 ? "weighted" : "priority",
    vendors: vendors.length ? vendors : [{ name: "VendorA", weight: 100, priority: 1, costPerRequest: 1.0, rateLimitPerMinute: 100, timeoutMs: 3000, supportedFeatures: [] }],
    failoverRules,
    explanation: "Generated with the rule-based fallback parser (no XAI_API_KEY set). Set the env var to use the full LLM-powered parser.",
  };
}

/**
 * Explain why a particular routing decision (log entry) was made, in
 * plain English suitable for a non-technical stakeholder.
 */
async function explainDecision(log) {
  if (!log) return "No routing log found for that id.";
  if (HAS_KEY) {
    try {
      const system = "You are an assistant that explains API vendor-routing decisions clearly and briefly (3-4 sentences) to a non-technical stakeholder.";
      const prompt = `Routing log entry:\n${JSON.stringify(log, null, 2)}\n\nExplain in plain English why this vendor was chosen and what would need to change for a different vendor to be picked next time.`;
      return await callGrok(system, prompt);
    } catch (err) {
      // fall through
    }
  }
  // Rule-based fallback: just tidy up the log's own routingReason.
  return `${log.routingReason} (Strategy used: ${log.strategyUsed}. To route differently, adjust vendor priority/weight/cost, or change the active strategy.)`;
}

/**
 * Look at current metrics across vendors for a capability and recommend
 * the best routing strategy + flag unhealthy vendors + suggest fallback rules.
 */
async function recommendStrategy(metricsList) {
  if (HAS_KEY) {
    try {
      const system = `You are a routing strategy advisor for an Intelligent Vendor Routing Platform. Given live vendor metrics, recommend the single best routing strategy from: priority, weighted, lowest-latency, lowest-cost, failover, round-robin, feature-based, health-based. Return ONLY JSON: {"recommendedStrategy": string, "reasoning": string, "unhealthyVendors": string[], "suggestedFailoverRules": string[]}`;
      const text = await callGrok(system, JSON.stringify(metricsList, null, 2));
      const clean = text.replace(/```json|```/g, "").trim();
      return { source: "llm", ...JSON.parse(clean) };
    } catch (err) {
      // fall through
    }
  }
  // Rule-based fallback
  const unhealthy = metricsList.filter((m) => !m.isHealthy || m.isRateLimited).map((m) => m.name);
  const sorted = [...metricsList].sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
  const spread = metricsList.length > 1 && Math.max(...metricsList.map((m) => m.avgLatencyMs)) - Math.min(...metricsList.map((m) => m.avgLatencyMs)) > 300;
  const recommendedStrategy = unhealthy.length ? "health-based" : spread ? "lowest-latency" : "weighted";
  return {
    source: "rule-based-fallback",
    recommendedStrategy,
    reasoning: `Rule-based recommendation (no XAI_API_KEY set): ${
      unhealthy.length
        ? `${unhealthy.join(", ")} showing degraded health, so health-based routing avoids them automatically.`
        : spread
        ? "Latency varies significantly across vendors, so lowest-latency routing improves response times."
        : "Vendors look healthy and comparable, so weighted routing balances load and cost."
    }`,
    unhealthyVendors: unhealthy,
    suggestedFailoverRules: [
      "switch vendor if avgLatencyMs > 2000",
      "switch vendor if errorRate > 5%",
      "switch vendor if consecutiveFailures >= 3",
    ],
  };
}

module.exports = { generateConfigFromText, explainDecision, recommendStrategy, HAS_KEY };
