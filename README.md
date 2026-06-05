# Journey Map

Turn recorded web sessions into visual user-journey maps, test artifacts, and **change-impact analysis** — with zero instrumentation on the target app.

You paste or upload a recording (clicks, inputs, network requests, screenshots), and the app uses an LLM to group raw events into semantic "stations," lays them out as an interactive subway-style map, and lets you describe a proposed change to get the journeys and stations at risk — ranked, with concrete checks and a test plan.

> **Why:** Existing tools each solve one piece (Datadog for observability, Mixpanel for funnels, Playwright for tests). Journey Map combines user journey + context + test generation, driven by zero-setup recordings and AI semantic grouping.

---

## Features

- **Journey map** — raw recording → semantic stations → interactive subway map (React Flow + ELK layout), color-coded by domain.
- **Multi-session aggregation** — merge many recordings into one process map; edge thickness = visit frequency; per-station visit stats.
- **Rich station context** — screenshots with lightbox, manual screenshot upload, per-endpoint request/response capture with shape-diffing, services, feature flags, observability links, and past incidents.
- **Coverage lenses** — overlay E2E / contract / integration / unit / service-unit coverage on the map.
- **Impact analysis** — describe a change, get ranked concerns (high/medium/low) per station with evidence and "what to check," plus a focused test plan, monitoring checklist, affected flows, and review focus.
- **Ask follow-ups** — a chat panel to interrogate the analysis.
- **Jump to map** — click a concern to highlight and center that station on the aggregate map.
- **Save & share reports** — persist an analysis and share it via a `?report=<id>` link.
- **Exports** — Mermaid diagram, Playwright test, Gherkin scenario, Markdown summary, and a copyable change brief.
- **Pluggable AI providers** — Anthropic (Claude), OpenAI, or local Ollama, with prompt caching, app-level result memoization, smart task routing, and per-model compatibility settings.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React + Tailwind |
| Visualization | React Flow + ELK.js (Mermaid for exports) |
| Backend | Node.js + Express |
| Storage | SQLite via the built-in `node:sqlite` module |
| AI | Anthropic / OpenAI / Ollama, with prompt caching |

---

## Prerequisites

- **Node.js 22+** (the server uses the built-in `node:sqlite` module).
- An API key for at least one provider — **Anthropic** (recommended) or **OpenAI** — or a local **Ollama** install for offline use.

---

## Setup

```bash
# 1. Install dependencies for both client and server
npm run install:all

# 2. Configure the server environment
cp .env.example server/.env
#   then edit server/.env and add your API key(s)

# 3. Run both the API and the web client (concurrently)
npm run dev
```

- Web client: http://localhost:5173
- API server: http://localhost:3001 (the client dev server proxies `/api` here)

### Environment variables (`server/.env`)

```bash
ANTHROPIC_API_KEY=your_anthropic_key_here   # preferred provider
OPENAI_API_KEY=your_openai_key_here         # optional fallback
PORT=3001                                   # optional, defaults to 3001
```

At least one provider key is required (unless you use Ollama). You can switch the active provider and model at runtime from **Settings** in the app header.

---

## Configuration (in-app Settings)

Open the gear icon in the header:

- **Provider & model** — pick Anthropic / OpenAI / Ollama and the model. Each provider remembers its own model. The active provider · model is shown as a pill in the header.
- **Smart routing** (Anthropic) — run easy tasks (initial analysis & follow-up chat) on a cheaper model (Haiku) while impact analysis and test plans use your selected model. On by default; never overrides your choice upward.
- **Advanced model parameters** — max output tokens, temperature (blank = provider default), the OpenAI token-limit parameter (`auto` learns `max_tokens` vs `max_completion_tokens` per model), and a Force-JSON toggle for models that reject `response_format`.

Cost optimizations applied automatically: **prompt caching** (≈90% off repeated context), **app-level memoization** (identical analysis re-runs are free and instant), and **smart routing** (cheaper model for easy tasks).

---

## Project structure

```
journey-map/
├── client/                # Vite + React app
│   └── src/components/     # SubwayMap, StationDetail, ImpactAnalysis, SettingsModal, …
├── server/                # Express API
│   ├── routes/            # analyze, sessions, impact, annotations, settings, …
│   ├── services/          # llm, prompt, stations, aggregate, settings, …
│   └── data/              # SQLite DB (gitignored)
├── PLAN.md                # phased build plan
└── README.md
```

### Scripts

| Command | What it does |
|---|---|
| `npm run install:all` | Install client + server dependencies |
| `npm run dev` | Run API and web client together |
| `npm run dev --prefix server` | API only (`node --watch`) |
| `npm run dev --prefix client` | Web client only |
| `npm run build --prefix client` | Production build of the client |
| `npm test --prefix server` | Server tests (`node --test`) |

---

## Recording format

Recordings are JSON with a `steps[]` array of interaction events (clicks, inputs, navigations, network requests). Screenshots are embedded as steps of `type: "screenshot"` with a `dataUrl` and `region`, matched to stations by timestamp.

> ⚠️ **Recordings capture live network traffic, including `Authorization: Bearer` tokens and response bodies.** They are treated as sensitive: recording files (`step-recording-*.json`, `recordings/`) and the SQLite data directory are gitignored. Don't commit real recordings — sanitize or use throwaway credentials if you need to share one.

---

## Data & privacy

- All data is stored locally in `server/data/sessions.db` (gitignored). There is no multi-user auth — this is a single-user, self-hosted tool.
- API keys live only in `server/.env` (gitignored).
- Nothing is sent anywhere except to the AI provider you configure, when you run an analysis.
