# Explanation of Routing Decisions

This document explains **how** the platform decides which vendor handles each request — the logic behind every `routingReason` string returned by `POST /route`.

## 1. Eligibility filter (runs before any strategy)

For every vendor registered under the requested `capability`, the engine checks, in order:

| Check | Rejects the vendor when... |
|---|---|
| Manual status | `vendor.status === "DISABLED"` (toggled via `POST /vendors/:id/toggle`) |
| Health | 3+ consecutive failures, or ≥50% error rate after 5+ requests |
| Rate limit | requests already sent this minute ≥ `rateLimitPerMinute` |
| Feature support | `requirements.requiredFeatures` contains something the vendor doesn't list in `supportedFeatures` |
| Latency threshold | `requirements.maxLatencyMs` is set and the vendor's rolling average latency exceeds it |

Only vendors that pass **all** checks become "eligible candidates." Every candidate — eligible or not — is recorded in the response's `candidates[]` array with the specific reason(s) it was excluded, so the decision is always auditable.

If **no** vendor is eligible, the API returns `status: "FAILURE"` with `routingReason: "No eligible vendor available..."` rather than guessing.

## 2. Strategy selection

The strategy used for a request is chosen in this precedence order:
1. `requirements.strategyOverride` (explicit, e.g. `"lowest-cost"`)
2. `requirements.preferLowCost: true` → forces `"lowest-cost"`
3. The platform's configured default strategy (`PATCH /config`, default `"priority"`)

## 3. What each strategy actually does

- **priority** — lowest `priority` number wins (1 beats 2).
- **weighted** — weighted random draw using each vendor's `weight` (e.g. 70/30 split).
- **lowest-latency** — picks the vendor with the lowest rolling average latency.
- **lowest-cost** — picks the vendor with the lowest `costPerRequest`.
- **failover** — orders vendors by priority and calls them in sequence until one succeeds.
- **round-robin** — cycles through eligible vendors evenly, one after another, per capability.
- **feature-based** — among vendors that support the required feature(s), picks the highest-priority one.
- **health-based** — picks the vendor with the best recent success rate / fewest consecutive failures.

## 4. Failover is universal, not just one strategy

Even outside the `failover` strategy, if the strategy's first choice **fails the simulated call** (a real vendor timeout/error in production), the engine automatically retries the next-best eligible candidate before giving up — this is what satisfies "Automatically switch to another vendor when primary vendor is down" from the brief, regardless of which strategy is active. The response's `attempts[]` array shows every vendor that was actually tried, and `routingReason` notes when a failover happened mid-request.

## 5. Standardized response, whatever vendor answered

Regardless of which vendor was used, the client always receives the same envelope shape:
```json
{ "status", "vendorUsed", "routingReason", "latencyMs", "cost", "response" }
```
`response` itself is capability-shaped (e.g. `panStatus`/`nameMatch` for PAN verification, `kycStatus`/`matchScore` for KYC) so the client never needs to know which vendor's raw format it's parsing.

## 6. Why simulate vendor calls at all?

The brief's vendors (KYC, OCR, SMS, payment providers, etc.) require real paid credentials that can't be provisioned for a take-home assignment. `simulateVendorCall()` in `backend/routing/engine.js` is the single seam to swap for a real HTTP call — everything else (eligibility, strategy, metrics, failover, logging) is production-shaped logic that doesn't change when you go live. Each vendor's `simulatedErrorRate` / `simulatedBaseLatencyMs` let you reproduce realistic scenarios (e.g. a vendor crossing a latency threshold, as in the brief's sample output) deterministically for a demo.
