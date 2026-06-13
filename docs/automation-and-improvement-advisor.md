# Automating context capture — and the deferred "Improvement Advisor"

Two linked topics:
1. **The Improvement Advisor** — a proposed "where should we improve, and why?" feature. Deferred.
2. **Automating context capture** — the prerequisite that would make #1 actually good (and that
   independently attacks the manual-maintenance problem).

They're documented together because **#1 is gated on #2.**

---

## Part 1 — The Improvement Advisor (deferred)

### What it would be
The mirror image of impact analysis. Impact is *reactive* ("I'm changing X → what breaks?").
The advisor is *proactive* ("given everything you know about my system → where is it weakest,
and why?"). It synthesizes across the captured signals already in `gatherStationContext()`:
coverage gaps, trace error-rate/p95, past incidents, observability gaps, lingering feature
flags, stale docs, heavily-depended-on services, high-traffic steps — and returns **ranked,
evidence-backed improvement opportunities**.

Decided shape (if/when built):
- **Audit by default + optional focus** ("reduce incidents", "raise coverage", "cut latency").
- Reuse the impact engine wholesale: `gatherStationContext()` → one-shot/agent hybrid → **critic**.
- Output: `{ area, category, priority, why: evidence[], recommendation, verify[] }` + a one-line
  system-health summary. Reuse the existing evidence chips (`trace`, `coverage-gap`, `incident`, …).
- Lives as an Impact sub-mode: `Analyze · Improve · Reports · Evals`.

### Why it's deferred (honest reasoning)
- **Only as good as the data, and the data is sparse + manual.** One app, ~10 stations, mostly
  hand-entered context. An audit over thin data is either thin or padded with generic advice —
  the "confident but unverifiable" trap, and *worse* than impact analysis because an open
  "improve?" prompt has no concrete change to anchor on.
- **Overlaps what already exists.** `AggregateStats` + the **Risk & gaps** / coverage lenses
  already *show* the gaps. At ~10 stations a glance does the prioritization an LLM would.
- **Not the differentiator.** Journey-grounded impact analysis is the moat; "health audit" is a
  commodity. More surface area, little new defensibility.

### When it becomes worth building
When context is **auto-populated at scale** (Part 2): 50+ stations with live traces, incidents
syncing in, coverage from CI. At that point cross-cutting prioritization is real work a glance
can't do, and recommendations are genuinely evidence-grounded.

### Guardrail if built early anyway
Make it **strictly evidence-gated**: emit a recommendation only when it cites a real captured
signal (a trace error rate, a coverage gap, an incident). Otherwise say "not enough data yet" —
never generic advice.

---

## Part 2 — Automating context capture

> **Implementation guide:** the concrete engineering design (pipeline diagram, connector
> contract, schema/source tagging, per-connector sketches, review UX) lives in
> [`automation.md`](automation.md). This section is the summary + rationale.

Today most of `gatherStationContext()` is manual. Automating it is the high-leverage work: it
fixes the manual-maintenance contradiction *and* unlocks the advisor.

### The one principle for all of it
```
source (CI / OTel / PagerDuty / flag provider / recording)
   → map to a canonical station (deterministic where possible, LLM-mediated where fuzzy)
   → PROPOSE, don't commit   (tag by source · reviewable · never silently authoritative)
```
This mirrors the Phase 6 Layer-2 caution and the critical-assessment trust rule. Several tables
already carry a `source` column (`api_requests.source`, `screenshots.source`) — extend that
convention to every derived row: `'recording' | 'ci' | 'otel' | 'pagerduty' | 'flagsmith' | 'manual'`,
so derived data is always distinguishable and the user confirms before it's authoritative.

### Mapping strategies (how a signal finds its station)
- **Deterministic (preferred):** by **endpoint signature** (`endpointKey('POST','/api/auth/login')`
  — the same matcher used for api_requests and traces) or by **service name**. No LLM, no trust risk.
- **LLM-mediated (only when fuzzy):** e.g. free-text incident titles → station. Must be
  propose-don't-commit and tagged, because it reintroduces the unverifiable-data risk.

### Signal-by-signal roadmap

| Signal | Source | How to map | Status today | Effort/Value |
|---|---|---|---|---|
| Stations, edges, APIs, actions | LLM over the recording | — | **automatic** | done |
| API request/response samples | recording `networkRequests[]` | by endpoint + timestamp (`extractApiRequests`) | **automatic** | done |
| Suggested services | LLM over network calls | confirm chips | **partial** (suggest only) | low |
| **Traces** (→ services, downstream, p95, error rate) | **OTel collector push** | endpoint signature (`traces.endpoint`) | upload-only | **low effort, high value** |
| **Incidents** | **PagerDuty / Sentry via MCP** | service/endpoint → station; titles LLM-mapped (propose) | manual | med effort, high value |
| **Test coverage** | **CI `lcov.info`** (a `services/lcov.js` stub exists) | covered files → services/endpoints | manual | med effort, med value |
| Services (deterministic) | network **hostnames** in the recording | hostname → service name | AI-suggested only | low effort, med value |
| Feature flags | flag provider API (LaunchDarkly/Unleash/Flagsmith) | flag key ↔ station usage | manual | med effort, low value |
| Observability links | URL templates per service / a registry | service → dashboard/alert URL | manual | low effort, low value |
| Docs (PRD/design) | repo conventions or a docs registry | path/title → journey/station | manual | low value |

### Recommended sequence (cheap + high value first)
1. **Trace push endpoint** (`POST /api/.../traces` accepting OTLP from a collector). Finishes
   the deferred Phase 5 item; auto-populates the *highest-signal* data (real services, latency,
   error rates) with zero manual work, matched deterministically by endpoint.
2. **Deterministic service derivation** from recording hostnames — small win, removes a manual step.
3. **Incident sync** (PagerDuty/Sentry via the MCP host that already exists) → `derived_incidents`
   keyed by canonical station. This is Phase 6 Layer-2; propose-don't-commit.
4. **LCOV import** from CI for real test-coverage status.
5. **Then** revisit the Improvement Advisor — now it has rich, auto-derived, evidence-grade data
   to reason over, and the critic keeps it honest.

### Why this order
Automation value is roughly **(signal quality × how manual it is today)**. Traces score highest
on both — they're ground truth (not user opinion) and currently require manual upload. Incidents
are next (high value, currently 100% manual). Coverage and flags are useful but lower-signal or
lower-churn. The advisor sits *last* because it's a consumer of all of the above, not a producer.

---

## Related — Phase 8: PR Blast-Radius Bot

The **PR Blast-Radius Bot** (PLAN.md → Phase 8) is the third consumer of the journey graph,
alongside impact analysis (reactive) and the Improvement Advisor (proactive). On a PR it bridges
the diff → graph and posts an evidence-cited comment. It belongs in this doc's orbit for two
reasons:

- **Same gating thesis.** Like the advisor, it's *only as good as the auto-populated graph*. A PR
  touching code with no recorded journey → weak/empty analysis; correct behavior is to **go quiet,
  not guess**. So the Part 2 automation roadmap (traces → incidents → coverage) is its prerequisite
  too — it gets sharper as context auto-populates at scale.
- **Same mapping principle.** Its new primitive — a `repo→service(s)` map (auto-suggested from
  trace `servicesObserved`, user-confirmed) — is the same *deterministic-first, propose-don't-commit*
  pattern as the connectors above. Map a signal (here, a repo's diff) to canonical stations
  deterministically where possible, LLM only where fuzzy, tagged and reviewable.

For a single product, "many repos" is an **advantage**, not a blocker: one shared graph, a per-repo
Action calling one impact brain. Multiple *unrelated* products need workspaces/multi-tenancy —
deferred with the Phase 5 multi-user work. Full write-up in PLAN.md → Phase 8.

---

## TL;DR
- The Improvement Advisor is a good idea **whose value is gated on data richness**; building it
  now would mostly reprint the existing lenses or risk generic advice. **Defer.**
- The leverage is in **automating context capture** — connectors that map to canonical stations
  and *propose, don't commit*. Start with the **trace push endpoint** (highest signal, currently
  manual), then incident sync, then coverage.
- Once context auto-populates at scale, the advisor becomes worth building and genuinely useful.
