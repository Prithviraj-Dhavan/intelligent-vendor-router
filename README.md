# Intelligent Vendor Routing Platform

A single unified API that routes requests (KYC, OCR, SMS, PAN verification, payments, etc.) to the best available third-party vendor, based on configurable rules and live performance signals — built for the Signzy SDE Intern assignment.

```
Client → POST /route → Routing Engine → Vendor A / Vendor B / Vendor C → Standardized Response
```
The client never knows which vendor actually handled the request.

## ✨ What makes this submission different

- **8 routing strategies implemented**, not the minimum 3: `priority`, `weighted`, `lowest-latency`, `lowest-cost`, `failover`, `round-robin`, `feature-based`, `health-based`.
- **Failover works as a universal safety net**, not just as its own strategy — if the strategy's first pick fails a simulated call, the engine automatically retries the next-best eligible vendor before giving up (see `docs/routing-decisions-explained.md`).
- **A live, honest dashboard** — not screenshots, an actual running control room: register vendors, fire test requests, watch an animated signal travel from client → router → the chosen vendor, disable a vendor mid-demo and watch failover happen live, and inspect the full audit trail.
- **Bonus Agentic AI is fully functional even without an API key** — a rule-based fallback means every AI endpoint (`/ai/generate-config`, `/ai/explain/:logId`, `/ai/recommend-strategy`) works out of the box; set `XAI_API_KEY` to upgrade to full LLM reasoning via Grok.

## Quick start

```bash
cd backend
npm install
npm start
```
Then open **http://localhost:3000** — the dashboard is served by the same Express app (no separate frontend server, no build step, no CORS configuration needed).

Requires Node.js 18+ (uses the built-in `fetch` for the optional AI integration).

**Optional** — to enable full LLM-powered AI features instead of the rule-based fallback:
```bash
export XAI_API_KEY=xai-...
npm start
```

## Project structure

```
signzy-vendor-router/
├── backend/
│   ├── server.js                 # Express app, all routes
│   ├── routing/
│   │   ├── store.js              # in-memory vendor + metrics + logs store
│   │   ├── engine.js             # eligibility filtering + strategy execution + failover
│   │   ├── strategies.js         # the 8 routing strategy implementations
│   │   ├── mockResponses.js      # capability-aware mock vendor responses
│   │   └── aiAgent.js            # bonus: agentic AI (LLM + rule-based fallback)
│   └── package.json
├── frontend/
│   ├── index.html                # dashboard markup (structure only)
│   ├── styles.css                # "signal routing control room" visual theme
│   └── app.js                    # dashboard logic (vanilla JS, no build step)
└── docs/
    ├── sample-vendor-configs.json
    ├── sample-api-requests-responses.md
    ├── routing-decisions-explained.md
    ├── architecture-diagram.svg
    └── AI_USAGE.md
```

## Mandatory APIs (all implemented)

| Method | Path | Purpose |
|---|---|---|
| POST | `/vendors` | Register a vendor for a capability |
| GET | `/vendors` | List vendors (optional `?capability=`) |
| POST | `/route` | Route a request to the best vendor |
| GET | `/vendor-metrics` | Live latency / success / error / availability per vendor |
| GET | `/routing-logs` | Full audit trail of routing decisions |
| GET | `/health` | System + vendor health snapshot |

Extras added beyond the minimum: `PATCH /vendors/:id`, `DELETE /vendors/:id`, `POST /vendors/:id/toggle` (manual kill-switch, great for live demos), `GET /strategies`, `PATCH /config` (change default strategy at runtime).

## How vendor calls are simulated

Real KYC/OCR/SMS/payment vendors need paid credentials that don't exist for a take-home assignment. `simulateVendorCall()` in `backend/routing/engine.js` is the **one function** you'd replace with a real HTTP call (`axios.post(vendor.endpointUrl, ...)`) to go to production — every other piece (eligibility rules, strategy logic, metrics, failover, audit logging) is written as real production logic, not a demo shortcut. Each vendor config carries `simulatedErrorRate` / `simulatedBaseLatencyMs` / `simulatedLatencyJitterMs` so you can reproduce specific scenarios (e.g. the brief's own sample: a vendor crossing a latency threshold and getting passed over) deterministically.

## Demoing failover live (30 seconds, good for the evaluator call)

1. Register `VendorA` (priority 1) and `VendorB` (priority 2) for `PAN_VERIFICATION` — or use the pre-filled dashboard form.
2. Send a request from the dashboard's Route Tester — watch the signal travel to VendorA.
3. Click **Disable** on VendorA's card.
4. Send the same request again — watch the signal skip VendorA (now dimmed, marked disabled) and land on VendorB, with the reason spelled out: *"vendor manually disabled."*
5. Check **Routing logs** below — both decisions are there with full context.

## Evaluation criteria coverage

| Criteria | Where |
|---|---|
| Vendor routing design | `routing/engine.js`, `routing/strategies.js` — 8 strategies |
| Failover handling | universal retry-on-failure + dedicated `failover` strategy + live-demo toggle |
| Metrics tracking | `routing/store.js` — rolling latency window, success/error rate, rate-limit counters, health |
| Rule/config design | vendor schema (priority, weight, cost, timeout, rate limit, features) + `PATCH /config` |
| API design | see table above, all mandatory + extras |
| Code quality | modular (`store` / `engine` / `strategies` / `mockResponses` / `aiAgent`), commented, tested live |
| Documentation | this file + `docs/` |
| Agentic AI bonus | `routing/aiAgent.js` — 3 endpoints, LLM + rule-based fallback |

## Testing it yourself

All examples in `docs/sample-api-requests-responses.md` were run against a live local instance of this exact code (not hand-written by hand — copy-pasteable and verified).
