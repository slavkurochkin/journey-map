# Why the impact engine is a *hybrid* (one-shot + agent)

A design note for understanding the impact analyzer in `server/services/llm.js`
(`analyzeImpact` → `shouldUseAgent` → one-shot **or** `runImpactAgent` → critic).

---

## The problem

"Describe a change, get the blast radius" means reasoning over the **journey graph** —
stations, their endpoints/services/flags/traces, and the edges between them — to decide
which stations are at risk. There are two fundamentally different ways to feed that graph
to an LLM.

---

## The two architectures

### A. One-shot ("stuff the context")

Put the **entire** graph into the (cached) system prompt, ask once, parse the JSON.

```
system = IMPACT_PROMPT + JSON.stringify(wholeGraph)
user   = "CHANGE: …"
→ one model call → concerns
```

**Strengths**
- **Holistic reasoning.** The model sees every station at once, so it catches cross-cutting
  and downstream effects without having to "decide to go look." Output is richer — fuller
  monitor/flows/review lists, more complete concern sets.
- **Cheap & simple at small N.** One call. With prompt caching the big block is ~90% off on
  repeats. No loop, no orchestration, fewer failure modes.

**Weakness**
- **It does not scale.** The whole graph rides in every call. As stations grow:
  - you hit the **context window** (eventually it literally won't fit);
  - cost grows with graph size on *every* analysis, even though most stations are irrelevant
    to a given change;
  - quality degrades — big contexts cause "lost in the middle," where the model under-weights
    facts buried in a long dump.

### B. Agent ("retrieve what you need")

Give the model **tools** to navigate the graph (`search_stations`, `get_station`,
`get_downstream`, `find_endpoint_consumers`, `get_traces`) and let it pull only the stations
the change touches, in a `tool_use` loop.

```
loop:
  model picks a tool  → server runs it over the graph → result back to model
until model emits the concerns JSON
```

**Strengths**
- **Scales past the context wall.** Only the relevant slice enters the context, regardless of
  total graph size. Token cost tracks *what the change touches*, not the whole app.
- This is **retrieval done with structured tool calls** instead of embeddings — for queries
  like "who calls `POST /api/auth/login`," exact graph lookups beat vector similarity (and
  avoid standing up a vector DB; see the deferred vector-DB decision).

**Weaknesses**
- **More expensive & slower at small N.** A 10-station graph that fits in one prompt turns into
  6–12 model round-trips. You pay orchestration overhead for retrieval you didn't need.
- **Thinner reasoning if under-fed.** The model only reasons over what it fetched; a small or
  cheap model can stop early or loop on redundant searches, producing sparser output than the
  one-shot would have for the same graph.
- **More moving parts** — a loop, iteration caps, tool plumbing, more failure modes.

---

## The empirical moment

At the project's real scale (~10 stations) the agent produced **noticeably thinner** analysis
than the one-shot: fewer concerns, emptier monitor/flows/review lists. That wasn't a bug — it's
the predictable result of using a retrieval architecture where retrieval isn't needed yet. The
one-shot's "see everything at once" is simply better when everything *fits*.

So the honest takeaway: **neither architecture is universally right. The correct choice is a
function of graph size.**

---

## The decision: size-gated hybrid

```js
function shouldUseAgent(context) {
  const stations = context.stations.length;
  const size = JSON.stringify(context).length;
  return stations > 25 || size > 45000;   // ~ "doesn't comfortably fit one-shot"
}
```

- **Small/medium graph → one-shot.** Richer, holistic, cheaper here. This is the common case
  today, so the everyday experience is the *better* one.
- **Large graph → agent.** Switches on exactly when "stuff everything" starts to hurt (cost,
  context limits, lost-in-the-middle). The agent's overhead is worth paying *because the
  alternative is now worse or impossible*.

The threshold is a heuristic for "is the graph small enough that stuffing it is still the better
deal." `45KB` ≈ ~10–12k tokens of context — comfortably fits with caching and keeps the model
focused; beyond that, selective retrieval wins. Tune the numbers as models/limits change; the
*principle* is what matters.

### Safety net: the degenerate-output guard

The agent path can still come back thin (small model loops, stops early). So after the agent
runs, if the result looks degenerate (no concerns, or empty ship-it lists), `analyzeImpact`
**re-synthesizes a one-shot over only the stations the agent fetched** (`touched`). That set is
small by construction, so it fits — giving you *selective retrieval* (agent finds the relevant
stations at scale) **plus** *holistic synthesis* (one-shot reasons richly over that slice). Best
of both, automatically, exactly when needed.

### Orthogonal: the critic

A verification pass runs after **either** path — it re-checks each concern against the real
station context and drops/demotes unsupported ones. It's independent of the one-shot/agent
choice: it improves *trust* (precision), while the hybrid choice is about *coverage/scale/cost*.

---

## Why not just pick one?

| If we committed to… | We'd lose… |
|---|---|
| One-shot only | The ability to scale past the context window; cost balloons on large apps. |
| Agent only | Output quality and cost-efficiency at the scale we actually run at today (it was *measurably worse* at 10 stations). |

The hybrid lets the product be **good now** (one-shot richness at current scale) **and ready
later** (agent when graphs get big), with a guard so the agent can't regress quality even in its
own regime.

---

## The general principle (the part worth keeping)

> **"Retrieve vs. stuff" is a scale decision, not a fashion.** Stuffing the whole context is
> simpler, cheaper, and reasons better — *until it doesn't fit or the cost/quality curve turns*.
> Don't pay agent/retrieval overhead before the context wall forces you to. Gate on size, keep a
> fallback that recovers the stuffed-context benefits over the retrieved slice, and verify
> separately.

This is the same lesson behind the deferred vector-DB decision: don't add retrieval
infrastructure speculatively — add it when the data outgrows "just put it all in the prompt."
