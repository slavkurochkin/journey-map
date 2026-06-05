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
**Status:** `not started`
**Goal:** Optionally connect frontend journeys to backend traces for engineering teams.

### Deliverables
- [ ] OTel collector integration (optional, requires instrumented app)
- [ ] Trace waterfall view inside station detail panel
- [ ] Backend service map overlay on the journey map
- [ ] Performance metrics per station (p50/p95 load times, error rates)
- [ ] Docker Compose for multi-service setup
- [ ] PostgreSQL migration (if going multi-user/SaaS)

### Success Criteria
A station can show both the user action (frontend) and the full distributed trace (backend) in one panel.

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
- [ ] `mcp_servers` registry table `(id, name, url, auth_token, enabled)` + Settings panel CRUD
- [ ] **Connector-first:** pass enabled remote servers to Anthropic's MCP connector
      (`mcp_servers` param + `anthropic-beta: mcp-client-2025-04-04`) in `transport()` —
      zero client code; gate to the `anthropic` provider
- [ ] Wire into `chatImpact` first, then optionally `analyzeImpact`
- [ ] *Fallback (only if stdio/local servers or non-Anthropic providers needed):* self-hosted
      MCP client host via `@modelcontextprotocol/sdk` — connect, aggregate tools with
      `{server}__{tool}` namespacing, run the `tool_use` loop, isolate per-server failures
- [ ] Deterministic incident sync (PagerDuty REST → `derived_incidents` keyed by canonical
      station) as the hardwired Layer-2 example — feeds the impact eval replay
- [ ] Per-server read-only / tool allowlisting (security)

### Success Criteria
A user adds a GitHub or Sentry MCP server in Settings and, with no further code, the impact
chat can call that server's tools to pull live context into its answers.

### Cautions
- **Security surface:** stores third-party tokens, calls remote servers / spawns local
  processes with potentially *write*-capable tools. Fine single-user self-hosted; becomes
  real auth/permission work the moment it's multi-user.
- Keep the core record-and-go loop working with **zero** integrations connected.

---

## Infrastructure Decisions

| Decision | Choice | Revisit at |
|---|---|---|
| Docker | No — too much friction during dev | Phase 4 |
| Database | None for P1-2, SQLite for P3 | Phase 3 |
| PostgreSQL | Only if going SaaS / multi-user | Phase 5 |
| Chrome extension | Out of scope until P4 | Phase 4 |
| MCP host | Connector-first (no client code); self-host only if stdio/non-Anthropic needed | Phase 6 |
