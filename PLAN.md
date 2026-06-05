# Journey Map — Build Plan

## Overview

A tool that takes recorded web interaction sessions (clicks, inputs, network requests) and transforms them into visual user journey maps, test artifacts, and process documentation — with zero setup on the target app.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React + Tailwind |
| Visualization | Mermaid (P1) → React Flow + ELK.js (P2+) |
| AI | Claude API, `claude-sonnet-4-6`, prompt caching |
| Backend | Node.js + Express |
| Storage | None (P1-2) → SQLite (P3+) → PostgreSQL if SaaS (P5+) |
| Docker | No (P1-2) → Docker Compose (P4+) |
| Recording input | JSON paste/upload (P1-3) → Chrome extension integration (P4+) |

---

## Phase 1 — Core Pipeline
**Status:** `complete`
**Goal:** Prove the concept end-to-end. Paste a recording JSON, get a journey map and test artifacts out.

### Deliverables
- [ ] Vite + React web app with JSON paste/upload input
- [ ] Node.js + Express API
- [ ] Claude API integration with prompt caching for large recordings
- [ ] AI processing: raw events → semantic stations → structured graph
- [ ] Rendered Mermaid diagram (visual journey)
- [ ] Exported Playwright test script
- [ ] Exported Gherkin/BDD scenario
- [ ] Exported Markdown summary

### Success Criteria
Given the sample recording, the app produces:
- A readable named journey (e.g. "Login → Feed → Profile")
- A runnable Playwright test
- A Gherkin scenario
- A Markdown summary
— with zero manual configuration of rules or patterns.

### Out of Scope
- Persistence / saving sessions
- Multi-session aggregation
- Screenshots
- Interactive graph (Mermaid only)

---

## Phase 2 — Subway Map Visualization
**Status:** `complete`
**Goal:** Replace Mermaid with a beautiful, interactive subway-style map.

### Deliverables
- [ ] React Flow + ELK.js layout engine
- [ ] Station cards: label, domain category, primary API, action count
- [ ] Color-coded domain lines (auth = blue, content = green, user = purple)
- [ ] Detail panel on station click: raw events, APIs called, timing
- [ ] Edge thickness reflects sequence order / confidence

### Success Criteria
A single recording produces a visually compelling, interactive subway-style map where clicking a station reveals its details.

---

## Phase 3 — Multi-Session Aggregation
**Status:** `complete`
**Goal:** Turn individual recordings into a process map across many sessions.

### Deliverables
- [ ] SQLite storage for sessions
- [ ] Session list / management UI
- [ ] Merge multiple recordings into one graph
- [ ] Edge thickness = visit frequency
- [ ] Station stats: visit count, avg time spent
- [ ] Drop-off analysis (where sessions end)

### Success Criteria
5+ recordings aggregated into one map with meaningful traffic weighting on edges.

---

## Phase 4 — Visual Stations & Manual Context
**Status:** `in progress`
**Goal:** Each station becomes a rich, annotated snapshot — visual and contextual.

### Deliverables
- [x] Screenshots attached to stations (from recording steps) + gallery with lightbox/zoom
- [x] Manual screenshot upload, move screenshot between stations
- [x] API request/response upload per endpoint (matched by endpoint signature across sessions)
- [x] Response-shape comparison (added/removed/type-changed) with accept-new flow
- [x] Services per station (manual)
- [x] Feature flags per station (toggle, rollout/targeting, description)
- [x] Observability links per station (dashboard/trace/logs/alert/metric)
- [ ] Desktop vs. mobile view differentiation

### Success Criteria
Clicking a station shows its screenshot plus the services, flags, observability, and
endpoint detail that give full context for that step.

---

## Phase 4.5 — Impact Analysis (the payoff)
**Status:** `complete`
**Goal:** Turn captured context into blast-radius analysis. Describe a change → get the
user journeys/stations at risk, ranked, with what to check.

### Deliverables
- [x] Server gathers all station context across sessions (endpoints, services, flags, observability, edges)
- [x] `POST /api/sessions/impact` → LLM returns ranked concerns (high/medium/low) per station
- [x] Impact tab: change description input + ranked concern cards with checks
- [x] Click a concern → "View on map" jumps to the aggregate map, selects + centers + pulses that station
- [x] Save/share an impact report (persisted in `impact_reports`; Reports list + shareable `?report=<id>` link)

### Success Criteria
"I'm changing the auth-service login endpoint" returns the affected stations with
reasoning and concrete checks, derived from real recorded journeys.

---

## Phase 5 — OpenTelemetry Layer
**Status:** `in progress`
**Goal:** Optionally connect frontend journeys to backend traces for engineering teams.

### Deliverables
- [x] OTLP-JSON trace ingestion via upload (tolerant parser: `resourceSpans` or plain span array), stored in SQLite, matched to stations by endpoint signature (same model as api_requests)
- [x] Trace waterfall view inside station detail panel (depth-indented spans, colored by service, errors in red)
- [x] Performance metrics per station (p50/p95 duration, error rate) derived from matched traces
- [x] Trace facts feed impact analysis: per-station servicesObserved, downstreamCalls, p95Ms, errorRate added to the impact/chat/test-plan context; prompt treats traces as ground-truth, high-confidence evidence (new `trace` evidence type) — makes blast-radius reasoning evidence-backed rather than inferred
- [ ] OTel collector integration / push ingest endpoint — deferred until there's a real instrumented app
- [x] Backend service map overlay on the journey map — journey-scoped "Services" lens: aggregate map stations carry their services (manual + trace-observed); selecting a service highlights the journey steps that call it and dims the rest (not a standalone Jaeger DAG)
- [ ] Docker Compose for multi-service setup — deferred (conflicts with "no Docker" infra decision; revisit if needed)
- [ ] PostgreSQL migration — deferred (SQLite is fine until multi-user/SaaS)

### Success Criteria
A station can show both the user action (frontend) and the full distributed trace (backend) in one panel. ✅ (via OTLP upload)

---

## Phase 6 — MCP Host (Integrations)
**Status:** `not started`
**Goal:** Let users connect *any* MCP server (GitHub, Sentry, Datadog, PagerDuty, Linear, …)
from a registry, so external context flows in without per-source hardcoding. Connector-first:
"connect an MCP" should be config, not code.

### Two layers (different difficulty — don't conflate)
- **Layer 1 — Live tools in chat/impact (generic, low-risk):** Claude calls connected
  servers' tools *on demand* while answering. Generalizes trivially.
- **Layer 2 — Auto-populate the graph (per-source or LLM-mediated, higher-risk):** pull
  Sentry issues / GH PRs / incidents *into* stations. Can't be fully generic — needs a
  hand-written adapter per source OR an LLM doing the mapping. The LLM path reintroduces
  the unverifiable-data trust risk; if built, derived data must be **tagged by source,
  reviewable, and never silently authoritative** (propose, don't auto-commit).

### Deliverables
- [x] `mcp_servers` registry table `(id, name, url, auth_token, enabled)` + Settings panel CRUD (auth_token never returned to the client — `hasToken` only)
- [x] **Connector-first:** enabled remote servers passed to Anthropic's MCP connector
      (`mcp_servers` param + `anthropic-beta: mcp-client-2025-04-04`) in `transport()` —
      zero client code; gated to the `anthropic` provider
- [x] Wired into `chatImpact` (attached on free-form/non-JSON turns only, so tool-use can't break structured output; text extracted across interleaved tool blocks)
- [x] Self-hosted MCP client host (`@modelcontextprotocol/sdk`) for OpenAI/Ollama: connects
      (Streamable HTTP → SSE fallback), aggregates allowlisted tools with `{server}__{tool}`
      namespacing, runs the `tool_use` loop, isolates per-server failures. MCP now works on
      all three providers (Anthropic via the hosted connector; OpenAI/Ollama via this loop).
- [ ] Deterministic incident sync (PagerDuty REST → `derived_incidents` keyed by canonical
      station) as the hardwired Layer-2 example — feeds the impact eval replay
- [x] Per-server tool allowlisting (security): optional `allowed_tools` per server → connector `tool_configuration.allowed_tools`; blank = all tools. (A generic "read-only" toggle isn't enforceable without per-tool semantics; the allowlist is the concrete control.)

### Success Criteria
A user adds a GitHub or Sentry MCP server in Settings and, with no further code, the impact
chat can call that server's tools to pull live context into its answers.

### Cautions
- **Security surface:** stores third-party tokens, calls remote servers / spawns local
  processes with potentially *write*-capable tools. Fine single-user self-hosted; becomes
  real auth/permission work the moment it's multi-user.
- Keep the core record-and-go loop working with **zero** integrations connected.

---

## Phase 7 — Agentic Impact Engine (wrapper → agent)
**Status:** `not started`
**Goal:** Stop being an LLM wrapper. Today every AI feature in `server/services/llm.js`
(`analyzeImpact`, `generateTestPlan`, `chatImpact`, `generateClarifyingQuestions`) is a
single-shot call: dump the full `gatherStationContext()` into the cached system block, ask
once, `parseJsonResponse()`, done. No loop, no decision about *what to look at*, no action in
the world, no self-checking. This phase introduces the four things that separate an agent from
a wrapper — **tools, a loop, verification, and memory** — starting with the highest-payoff one.

### Why now (ties to existing risks)
- **Context-scale wall** (see [vector-db decision]): one-shot dumps the entire station graph
  every call. Tool-calling retrieval fixes this *without* a vector DB — structured tool calls
  over the graph beat embeddings for "which station calls this endpoint."
- **Trust problem** (critical-assessment #2): one-shot output is confident but unverifiable. A
  critic/verification loop attacks this directly using the eval + feedback tables already built
  in `server/routes/impact.js` (`eval_cases`, `concern_feedback`).
- **Maintenance burden** (critical-assessment #1): an auto-derivation agent turns manual entry
  into review (propose → human confirm).

### Sequencing
Slice 1 is the keystone — it builds the `tool_use` loop in `transport()` that **Phase 6 (MCP
connector) also depends on**, so do Slice 1 before, or as the first step of, Phase 6. Slices
2–4 layer on top and can be picked up independently afterward.
- **Must-have:** Slice 1 (tool-using loop) + Slice 2 (critic) — together they turn the core
  feature from wrapper into trustworthy agent. This is the phase's actual point.
- **Later / opportunistic:** Slice 3 (write-and-run tests) and Slice 4 (auto-derivation) — high
  value but larger surface (sandbox execution, per-source mapping); start once 1–2 land.

### Slice 1 — Tool-using retrieval loop for impact `[must-have, do first]`
Replace the "dump everything" pattern in `analyzeImpact` with a `tool_use` loop where the model
*navigates* the graph instead of being spoon-fed it. Establishes the tool_use plumbing in
`transport()` that Phase 6 (MCP connector) also needs.
- [ ] Add a `tool_use` loop to `transport()` (Anthropic provider first; gate by provider)
- [ ] Internal tool definitions backed by `stations.js`/`db.js`, not a context blob:
  - `search_stations(query)` → matching station ids/labels
  - `get_station(id)` → full detail (endpoints, services, coverage, incidents, traces)
  - `get_downstream(id)` → stations after it via edges
  - `find_endpoint_consumers(endpoint)` → who calls e.g. `POST /api/auth/login`
  - `get_traces(stationId)` → ground-truth trace facts (`traceFactsFor`)
- [ ] Loop: read CHANGE → model selects + pulls only relevant stations → reasons → emits concerns
- [ ] Preserve existing smart-routing, prompt-caching, and app-level memoization
- [ ] Cap tool-call iterations; log per-call tool usage alongside the existing `[llm]` cost line

### Slice 2 — Verification / critic loop `[must-have]`
- [ ] Critic pass: a second call re-checks each emitted concern against the actual station
      context and drops/demotes unsupported ones before returning
- [ ] Feed eval misses back in: inject "historically missed X-type stations for Y-type changes"
      from `eval_cases` results into the next run (memory across runs)
- [ ] Surface a per-run confidence/coverage note derived from the critic, not the generator

### Slice 3 — Agentic test plan (write + run, not describe) `[later]`
- [ ] Tool: `write_playwright_test(station)` using the real captured selectors
- [ ] Tool: `run_test()` in a sandbox → observe pass/fail → fix → retry loop
- [ ] Output a *green* test artifact, not a JSON description of one (upgrades `generateTestPlan`)

### Slice 4 — Auto-derivation agent (attacks the maintenance burden) `[later]`
- [ ] On session import, agent proposes services (from network hostnames), incident links, and
      coverage — tagged by source, **propose-don't-commit**, human confirms (mirrors Phase 6
      Layer-2 caution: derived data is reviewable, never silently authoritative)

### Success Criteria
- Impact analysis answers a change by fetching only the stations it needs (visible in tool-call
  logs), and produces the same-or-better concerns than the one-shot version at lower token cost.
- A measurable trust gain: critic-filtered runs improve precision on `concern_feedback` / recall
  on `eval_cases` versus the one-shot baseline.

### Out of Scope (for the first slice)
- Multi-agent orchestration, planner/executor splits — one tool-use loop first.
- Replacing the structured graph with embeddings (still deferred; see vector-db decision).

---

## Infrastructure Decisions

| Decision | Choice | Revisit at |
|---|---|---|
| Docker | No — too much friction during dev | Phase 4 |
| Database | None for P1-2, SQLite for P3 | Phase 3 |
| PostgreSQL | Only if going SaaS / multi-user | Phase 5 |
| Chrome extension | Out of scope until P4 | Phase 4 |
| MCP host | Connector-first (no client code); self-host only if stdio/non-Anthropic needed | Phase 6 |
| Agent loop | Single `tool_use` loop in `transport()` (Anthropic first); shared by Phase 6 + 7 | Phase 7 |
