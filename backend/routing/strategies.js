// strategies.js
// Each strategy takes a list of ELIGIBLE candidates (already filtered for
// health, rate limits, and feature support) plus context, and returns the
// chosen vendor + a human-readable reason. Ordering strategies (priority,
// lowest-latency, lowest-cost, health-based) also return the full ranking so
// the API response / UI can show *why* alternatives were passed over.

const { getRoundRobinIndex } = require("./store");

function byPriority(candidates) {
  const ranked = [...candidates].sort((a, b) => a.vendor.priority - b.vendor.priority);
  const chosen = ranked[0];
  return {
    chosen,
    ranked,
    reason: `${chosen.vendor.name} selected: lowest priority number (priority ${chosen.vendor.priority}) among eligible vendors.`,
  };
}

function weighted(candidates) {
  const totalWeight = candidates.reduce((sum, c) => sum + (c.vendor.weight || 1), 0);
  let r = Math.random() * totalWeight;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) {
    r -= c.vendor.weight || 1;
    if (r <= 0) {
      chosen = c;
      break;
    }
  }
  const pct = Math.round((chosen.vendor.weight / totalWeight) * 100);
  return {
    chosen,
    ranked: candidates,
    reason: `${chosen.vendor.name} selected via weighted random draw (${chosen.vendor.weight}/${totalWeight} share, ~${pct}% of traffic).`,
  };
}

function lowestLatency(candidates) {
  const ranked = [...candidates].sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs);
  const chosen = ranked[0];
  return {
    chosen,
    ranked,
    reason: `${chosen.vendor.name} selected: lowest observed average latency (${chosen.metrics.avgLatencyMs}ms) among eligible vendors.`,
  };
}

function lowestCost(candidates) {
  const ranked = [...candidates].sort((a, b) => a.vendor.costPerRequest - b.vendor.costPerRequest);
  const chosen = ranked[0];
  return {
    chosen,
    ranked,
    reason: `${chosen.vendor.name} selected: lowest cost per request (₹${chosen.vendor.costPerRequest}) among eligible vendors.`,
  };
}

function failover(candidates) {
  // Ordered strictly by priority; the engine will actually attempt calls in
  // this order and fail over on simulated failure (see engine.js).
  const ranked = [...candidates].sort((a, b) => a.vendor.priority - b.vendor.priority);
  return {
    chosen: ranked[0],
    ranked,
    reason: `Failover order established by priority; ${ranked[0].vendor.name} attempted first.`,
  };
}

function roundRobin(candidates, ctx) {
  const idx = getRoundRobinIndex(ctx.capability, candidates.length);
  const chosen = candidates[idx % candidates.length];
  return {
    chosen,
    ranked: candidates,
    reason: `${chosen.vendor.name} selected: round-robin slot ${idx % candidates.length} of ${candidates.length} eligible vendors.`,
  };
}

function featureBased(candidates, ctx) {
  // Candidates arriving here have already been filtered for required
  // features; break ties by priority.
  const ranked = [...candidates].sort((a, b) => a.vendor.priority - b.vendor.priority);
  const chosen = ranked[0];
  const feats = (ctx.requiredFeatures || []).join(", ") || "none specified";
  return {
    chosen,
    ranked,
    reason: `${chosen.vendor.name} selected: supports required feature(s) [${feats}]; ranked highest by priority among vendors that qualify.`,
  };
}

function healthBased(candidates) {
  const ranked = [...candidates].sort((a, b) => {
    // healthiest = highest success rate, then lowest error rate, then fewest consecutive failures
    if (b.metrics.successRate !== a.metrics.successRate) return b.metrics.successRate - a.metrics.successRate;
    return a.metrics.consecutiveFailures - b.metrics.consecutiveFailures;
  });
  const chosen = ranked[0];
  return {
    chosen,
    ranked,
    reason: `${chosen.vendor.name} selected: healthiest vendor available (${chosen.metrics.successRate}% success rate, ${chosen.metrics.consecutiveFailures} recent consecutive failures).`,
  };
}

const STRATEGIES = {
  priority: byPriority,
  weighted,
  "lowest-latency": lowestLatency,
  "lowest-cost": lowestCost,
  failover,
  "round-robin": roundRobin,
  "feature-based": featureBased,
  "health-based": healthBased,
};

function runStrategy(name, candidates, ctx) {
  const fn = STRATEGIES[name] || STRATEGIES.priority;
  return fn(candidates, ctx);
}

module.exports = { STRATEGIES, runStrategy };
