// store.js
// Simple in-memory data store. Swappable for a real DB later (see README).

const vendors = new Map();      // id -> vendor config
const metrics = new Map();      // id -> live metrics
const routingLogs = [];         // append-only log of routing decisions
const roundRobinPointers = new Map(); // capability -> last index used

let nextVendorId = 1;
let nextLogId = 1;

const LATENCY_WINDOW_SIZE = 50;   // rolling window for avg latency
const MAX_LOGS = 2000;            // cap log growth in-memory

function createVendor(cfg) {
  const id = `v${nextVendorId++}`;
  const vendor = {
    id,
    capability: cfg.capability,
    name: cfg.name,
    priority: cfg.priority ?? 100,
    weight: cfg.weight ?? 10,
    costPerRequest: cfg.costPerRequest ?? 1.0,
    timeoutMs: cfg.timeoutMs ?? 3000,
    rateLimitPerMinute: cfg.rateLimitPerMinute ?? 60,
    supportedFeatures: cfg.supportedFeatures ?? [],
    // demo/simulation knobs - a real integration would replace the
    // simulateCall() function in engine.js with an actual HTTP call.
    simulatedErrorRate: cfg.simulatedErrorRate ?? 0.05,
    simulatedBaseLatencyMs: cfg.simulatedBaseLatencyMs ?? 400,
    simulatedLatencyJitterMs: cfg.simulatedLatencyJitterMs ?? 250,
    status: cfg.status ?? "ACTIVE", // ACTIVE | DISABLED (manual kill switch)
    createdAt: new Date().toISOString(),
  };
  vendors.set(id, vendor);
  metrics.set(id, {
    totalRequests: 0,
    successCount: 0,
    errorCount: 0,
    latencyWindow: [],
    minuteWindowStart: Date.now(),
    minuteCount: 0,
    consecutiveFailures: 0,
    lastUsedAt: null,
    lastStatus: null,
    lastLatencyMs: null,
  });
  return vendor;
}

function updateVendor(id, patch) {
  const v = vendors.get(id);
  if (!v) return null;
  Object.assign(v, patch);
  return v;
}

function deleteVendor(id) {
  vendors.delete(id);
  metrics.delete(id);
}

function getVendor(id) {
  return vendors.get(id) || null;
}

function listVendors(capability) {
  const all = Array.from(vendors.values());
  return capability ? all.filter((v) => v.capability === capability) : all;
}

function getMetrics(id) {
  return metrics.get(id) || null;
}

function resetMinuteWindowIfNeeded(id) {
  const m = metrics.get(id);
  const now = Date.now();
  if (now - m.minuteWindowStart >= 60000) {
    m.minuteWindowStart = now;
    m.minuteCount = 0;
  }
}

function recordCall(id, { success, latencyMs }) {
  const m = metrics.get(id);
  if (!m) return;
  resetMinuteWindowIfNeeded(id);
  m.totalRequests += 1;
  m.minuteCount += 1;
  m.lastUsedAt = new Date().toISOString();
  m.lastStatus = success ? "SUCCESS" : "ERROR";
  m.lastLatencyMs = latencyMs;
  m.latencyWindow.push(latencyMs);
  if (m.latencyWindow.length > LATENCY_WINDOW_SIZE) m.latencyWindow.shift();
  if (success) {
    m.successCount += 1;
    m.consecutiveFailures = 0;
  } else {
    m.errorCount += 1;
    m.consecutiveFailures += 1;
  }
}

function computeDerivedMetrics(id) {
  const v = vendors.get(id);
  const m = metrics.get(id);
  if (!v || !m) return null;
  resetMinuteWindowIfNeeded(id);
  const avgLatencyMs = m.latencyWindow.length
    ? Math.round(m.latencyWindow.reduce((a, b) => a + b, 0) / m.latencyWindow.length)
    : v.simulatedBaseLatencyMs;
  const successRate = m.totalRequests ? m.successCount / m.totalRequests : 1;
  const errorRate = m.totalRequests ? m.errorCount / m.totalRequests : 0;
  const isRateLimited = m.minuteCount >= v.rateLimitPerMinute;
  const isHealthy =
    v.status === "ACTIVE" &&
    m.consecutiveFailures < 3 &&
    !(m.totalRequests >= 5 && errorRate > 0.5);
  return {
    vendorId: id,
    name: v.name,
    capability: v.capability,
    status: v.status,
    totalRequests: m.totalRequests,
    successCount: m.successCount,
    errorCount: m.errorCount,
    avgLatencyMs,
    successRate: Number((successRate * 100).toFixed(1)),
    errorRate: Number((errorRate * 100).toFixed(1)),
    availability: isHealthy && !isRateLimited ? 100 : isHealthy ? 80 : 0,
    isHealthy,
    isRateLimited,
    requestsThisMinute: m.minuteCount,
    rateLimitPerMinute: v.rateLimitPerMinute,
    consecutiveFailures: m.consecutiveFailures,
    lastUsedAt: m.lastUsedAt,
    lastStatus: m.lastStatus,
    lastLatencyMs: m.lastLatencyMs,
  };
}

function listAllMetrics(capability) {
  const ids = listVendors(capability).map((v) => v.id);
  return ids.map(computeDerivedMetrics);
}

function addLog(entry) {
  const log = { id: `log${nextLogId++}`, timestamp: new Date().toISOString(), ...entry };
  routingLogs.unshift(log); // newest first
  if (routingLogs.length > MAX_LOGS) routingLogs.pop();
  return log;
}

function getLogs({ capability, vendor, limit = 100 } = {}) {
  let logs = routingLogs;
  if (capability) logs = logs.filter((l) => l.capability === capability);
  if (vendor) logs = logs.filter((l) => l.vendorUsed === vendor);
  return logs.slice(0, limit);
}

function getRoundRobinIndex(capability, candidateCount) {
  const prev = roundRobinPointers.get(capability) ?? -1;
  const next = candidateCount ? (prev + 1) % candidateCount : 0;
  roundRobinPointers.set(capability, next);
  return next;
}

module.exports = {
  createVendor,
  updateVendor,
  deleteVendor,
  getVendor,
  listVendors,
  getMetrics,
  recordCall,
  computeDerivedMetrics,
  listAllMetrics,
  addLog,
  getLogs,
  getRoundRobinIndex,
};
