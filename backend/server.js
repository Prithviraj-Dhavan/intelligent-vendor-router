// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const store = require("./routing/store");
const engine = require("./routing/engine");
const aiAgent = require("./routing/aiAgent");
const { STRATEGIES } = require("./routing/strategies");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Global default strategy (can be changed at runtime via PATCH /config)
let defaultStrategy = "priority";

// ---------------------------------------------------------------------------
// 1. POST /vendors  - register a vendor
// ---------------------------------------------------------------------------
app.post("/vendors", (req, res) => {
  const { capability, name } = req.body;
  if (!capability || !name) {
    return res.status(400).json({ error: "capability and name are required." });
  }
  const vendor = store.createVendor(req.body);
  res.status(201).json(vendor);
});

// ---------------------------------------------------------------------------
// 2. GET /vendors  - list vendors (optional ?capability=)
// ---------------------------------------------------------------------------
app.get("/vendors", (req, res) => {
  res.json(store.listVendors(req.query.capability));
});

app.patch("/vendors/:id", (req, res) => {
  const updated = store.updateVendor(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Vendor not found." });
  res.json(updated);
});

app.delete("/vendors/:id", (req, res) => {
  store.deleteVendor(req.params.id);
  res.status(204).send();
});

// Convenience: quick manual kill-switch for demoing failover live
app.post("/vendors/:id/toggle", (req, res) => {
  const v = store.getVendor(req.params.id);
  if (!v) return res.status(404).json({ error: "Vendor not found." });
  const updated = store.updateVendor(req.params.id, { status: v.status === "ACTIVE" ? "DISABLED" : "ACTIVE" });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// 3. POST /route  - the unified routing API
// ---------------------------------------------------------------------------
app.post("/route", (req, res) => {
  const { capability, payload, requirements } = req.body;
  if (!capability) return res.status(400).json({ error: "capability is required." });
  const result = engine.route({ capability, payload, requirements }, defaultStrategy);
  res.json(result);
});

// ---------------------------------------------------------------------------
// 4. GET /vendor-metrics
// ---------------------------------------------------------------------------
app.get("/vendor-metrics", (req, res) => {
  res.json(store.listAllMetrics(req.query.capability));
});

// ---------------------------------------------------------------------------
// 5. GET /routing-logs
// ---------------------------------------------------------------------------
app.get("/routing-logs", (req, res) => {
  const { capability, vendor, limit } = req.query;
  res.json(store.getLogs({ capability, vendor, limit: limit ? Number(limit) : undefined }));
});

// ---------------------------------------------------------------------------
// 6. GET /health
// ---------------------------------------------------------------------------
app.get("/health", (req, res) => {
  const all = store.listAllMetrics();
  res.json({
    status: "UP",
    uptimeSeconds: Math.round(process.uptime()),
    defaultStrategy,
    totalVendors: all.length,
    healthyVendors: all.filter((v) => v.isHealthy).length,
    unhealthyVendors: all.filter((v) => !v.isHealthy).map((v) => v.name),
    timestamp: new Date().toISOString(),
  });
});

// Extras: strategy list + global default strategy config
app.get("/strategies", (req, res) => {
  res.json({ available: Object.keys(STRATEGIES), active: defaultStrategy });
});

app.patch("/config", (req, res) => {
  if (req.body.defaultStrategy) defaultStrategy = req.body.defaultStrategy;
  res.json({ defaultStrategy });
});

// ---------------------------------------------------------------------------
// Bonus: Agentic AI endpoints
// ---------------------------------------------------------------------------
app.post("/ai/generate-config", async (req, res) => {
  const { instruction } = req.body;
  if (!instruction) return res.status(400).json({ error: "instruction is required." });
  const result = await aiAgent.generateConfigFromText(instruction);
  res.json(result);
});

app.get("/ai/explain/:logId", async (req, res) => {
  const logs = store.getLogs({ limit: 2000 });
  const log = logs.find((l) => l.id === req.params.logId);
  const explanation = await aiAgent.explainDecision(log);
  res.json({ logId: req.params.logId, explanation });
});

app.post("/ai/recommend-strategy", async (req, res) => {
  const { capability } = req.body;
  const metricsList = store.listAllMetrics(capability);
  const result = await aiAgent.recommendStrategy(metricsList);
  res.json(result);
});

app.get("/ai/status", (req, res) => {
  res.json({ llmEnabled: aiAgent.HAS_KEY });
});

// ---------------------------------------------------------------------------
// Static frontend (single-page dashboard)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.listen(PORT, () => {
  console.log(`\nIntelligent Vendor Routing Platform`);
  console.log(`API + dashboard running at http://localhost:${PORT}`);
  console.log(`AI agent LLM mode: ${aiAgent.HAS_KEY ? "ENABLED (XAI_API_KEY found, using Grok)" : "rule-based fallback (no XAI_API_KEY set)"}\n`);
});
