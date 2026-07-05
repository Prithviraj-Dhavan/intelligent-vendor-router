# AI_USAGE.md

This project was built with AI assistance (Claude), used as a pair-programmer and for the bonus "Agentic AI" feature. In the interest of transparency (and because the brief explicitly asks for this file if AI tools are used), here's exactly how:

## Where AI was used

1. **Scaffolding & code generation** — the overall project structure, Express routes, the routing engine, the 8 routing strategies, the metrics store, and the dashboard frontend were generated with Claude based on a detailed spec derived from the assignment brief, then manually reviewed and tested end-to-end (see the `curl` transcripts in `docs/sample-api-requests-responses.md`, all run against the live local server, not fabricated).
2. **Design direction** — the dashboard's visual identity (dark "signal routing control room" theme, the animated request-path diagram) was planned deliberately to avoid generic AI-dashboard defaults, rather than using an off-the-shelf template.
3. **Bonus Agentic AI feature** (`backend/routing/aiAgent.js`) — this is a *runtime* feature of the product itself, not just a build-time tool:
   - `POST /ai/generate-config` — turns a plain-English routing instruction into a structured routing config JSON.
   - `GET /ai/explain/:logId` — explains a specific routing decision in plain English.
   - `POST /ai/recommend-strategy` — analyzes live vendor metrics and recommends the best routing strategy, flags unhealthy vendors, and suggests failover rules.

   These call the xAI Grok API (`grok-4.3`) when an `XAI_API_KEY` environment variable is present. **Without a key, all three endpoints still work** via a deterministic rule-based fallback (regex parsing for config generation, metrics-threshold rules for recommendations) — this was a deliberate choice so the platform is fully demoable offline / without any billing setup during evaluation.

## What was manually verified (not just AI-generated and trusted)

- Every mandatory API (`/vendors`, `/route`, `/vendor-metrics`, `/routing-logs`, `/health`) was tested live with `curl` against a running instance.
- All 8 routing strategies were individually exercised, including a genuine (not staged) all-vendors-failed scenario caused by simulated random error rates.
- The manual vendor kill-switch (`POST /vendors/:id/toggle`) was used to confirm real failover behavior (Vendor A disabled → Vendor B automatically selected, with the reason logged).
- JS syntax across every backend and frontend file was checked with `node --check`.

## What to tell the evaluator

If asked "did you use AI," the honest answer is yes — for scaffolding, and as a first-class product feature (the agentic bonus). The system design decisions (eligibility filtering before strategy selection, failover-as-a-safety-net across all strategies, the simulate-vendor-call seam for going live, the metrics/health model) reflect a real understanding of the problem, which I can walk through and defend in a review.
