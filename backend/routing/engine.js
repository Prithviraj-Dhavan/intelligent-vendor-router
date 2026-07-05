// engine.js
const store = require("./store");
const { runStrategy } = require("./strategies");
const { generateMockResponse } = require("./mockResponses");

/**
 * Simulates an actual call to a vendor. In production this is where you'd
 * do `await axios.post(vendor.endpointUrl, payload, { timeout: vendor.timeoutMs })`.
 * Here we simulate latency + failure using the vendor's configured
 * simulatedErrorRate / simulatedBaseLatencyMs so the whole platform (metrics,
 * failover, health-based routing) can be demoed realistically and fast.
 */
function simulateVendorCall(vendor, payload, capability) {
  const jitter = Math.floor(Math.random() * vendor.simulatedLatencyJitterMs);
  const latencyMs = vendor.simulatedBaseLatencyMs + jitter;
  const roll = Math.random();
  const success = roll >= vendor.simulatedErrorRate;
  return {
    success,
    latencyMs,
    response: success ? generateMockResponse(capability, payload) : null,
  };
}

/**
 * Builds the eligibility report for every vendor registered under a
 * capability: whether it qualifies for this request, and if not, why.
 * This is what "Automatically switch to another vendor when..." (spec
 * section 5) actually implements.
 */
function evaluateCandidates(capability, requirements = {}) {
  const allVendors = store.listVendors(capability);
  const requiredFeatures = requirements.requiredFeatures || [];
  const maxLatencyMs = requirements.maxLatencyMs;

  return allVendors.map((vendor) => {
    const metrics = store.computeDerivedMetrics(vendor.id);
    const reasons = [];

    if (vendor.status !== "ACTIVE") reasons.push("vendor manually disabled");
    if (!metrics.isHealthy) reasons.push("vendor unhealthy (down or high recent error rate)");
    if (metrics.isRateLimited) reasons.push("rate limit reached for current minute");
    const missingFeatures = requiredFeatures.filter((f) => !vendor.supportedFeatures.includes(f));
    if (missingFeatures.length) reasons.push(`missing required feature(s): ${missingFeatures.join(", ")}`);
    if (maxLatencyMs && metrics.avgLatencyMs > maxLatencyMs) reasons.push(`avg latency ${metrics.avgLatencyMs}ms exceeds threshold ${maxLatencyMs}ms`);

    return { vendor, metrics, eligible: reasons.length === 0, reasons };
  });
}

function pickStrategyName(requirements, defaultStrategy) {
  if (requirements?.strategyOverride) return requirements.strategyOverride;
  if (requirements?.preferLowCost) return "lowest-cost";
  return defaultStrategy || "priority";
}

/**
 * Main entry point for POST /route.
 */
function route({ capability, payload, requirements = {} }, defaultStrategy = "priority") {
  const candidateReport = evaluateCandidates(capability, requirements);
  const eligible = candidateReport.filter((c) => c.eligible);
  const strategyName = pickStrategyName(requirements, defaultStrategy);

  const baseLog = {
    capability,
    strategyUsed: strategyName,
    candidatesConsidered: candidateReport.map((c) => ({
      name: c.vendor.name,
      eligible: c.eligible,
      reasons: c.reasons,
    })),
  };

  if (eligible.length === 0) {
    const log = store.addLog({
      ...baseLog,
      vendorUsed: null,
      routingReason: "No eligible vendor available for this capability under current rules.",
      status: "NO_VENDOR_AVAILABLE",
    });
    return {
      status: "FAILURE",
      vendorUsed: null,
      routingReason: log.routingReason,
      latencyMs: 0,
      cost: 0,
      response: null,
      logId: log.id,
      strategyUsed: strategyName,
      candidates: candidateReport.map((c) => ({ name: c.vendor.name, eligible: c.eligible, reasons: c.reasons })),
    };
  }

  const { chosen, ranked, reason } = runStrategy(strategyName, eligible, {
    capability,
    requiredFeatures: requirements.requiredFeatures,
  });

  // Failover strategy (and, as a general safety net, any strategy) walks
  // down the ranked list on simulated failure rather than giving up after
  // one bad call.
  const attemptOrder = strategyName === "failover" ? ranked : [chosen, ...ranked.filter((c) => c !== chosen)];

  let result = null;
  let usedCandidate = null;
  let routingReason = reason;
  const attempts = [];

  for (const candidate of attemptOrder) {
    const outcome = simulateVendorCall(candidate.vendor, payload, capability);
    store.recordCall(candidate.vendor.id, { success: outcome.success, latencyMs: outcome.latencyMs });
    attempts.push({ vendor: candidate.vendor.name, success: outcome.success, latencyMs: outcome.latencyMs });

    if (outcome.success) {
      result = outcome;
      usedCandidate = candidate;
      if (candidate !== chosen) {
        routingReason = `${reason} | Failed over to ${candidate.vendor.name} after earlier candidate(s) failed: ${attempts
          .filter((a) => !a.success)
          .map((a) => a.vendor)
          .join(", ")}.`;
      }
      break;
    }
  }

  if (!result) {
    const log = store.addLog({
      ...baseLog,
      vendorUsed: null,
      routingReason: `All eligible vendors failed on this request. Attempts: ${JSON.stringify(attempts)}`,
      status: "ALL_VENDORS_FAILED",
    });
    return {
      status: "FAILURE",
      vendorUsed: null,
      routingReason: log.routingReason,
      latencyMs: attempts.reduce((a, b) => a + b.latencyMs, 0),
      cost: 0,
      response: null,
      logId: log.id,
      strategyUsed: strategyName,
      candidates: candidateReport.map((c) => ({ name: c.vendor.name, eligible: c.eligible, reasons: c.reasons })),
    };
  }

  const log = store.addLog({
    ...baseLog,
    vendorUsed: usedCandidate.vendor.name,
    vendorId: usedCandidate.vendor.id,
    routingReason,
    status: "SUCCESS",
    latencyMs: result.latencyMs,
    cost: usedCandidate.vendor.costPerRequest,
    attempts,
  });

  return {
    status: "SUCCESS",
    vendorUsed: usedCandidate.vendor.name,
    routingReason,
    latencyMs: result.latencyMs,
    cost: usedCandidate.vendor.costPerRequest,
    response: result.response,
    logId: log.id,
    strategyUsed: strategyName,
    candidates: candidateReport.map((c) => ({ name: c.vendor.name, eligible: c.eligible, reasons: c.reasons })),
    attempts,
  };
}

module.exports = { route, evaluateCandidates, simulateVendorCall };
