# Deep Research Brief: evidence for Marrow's next-year roadmap (2026 H2 to 2027)

> Purpose: produce an evidence dossier that a founder can turn directly into a
> dependency-ordered roadmap (a todolist executed in a loop). Every recommendation
> must be backed by a cited, dated source or a clearly labeled inference. This brief
> is self-contained: you do not need access to Marrow's repository to run it.

---

## 0. Your role and standard of proof

You are a principal-level product strategist and technical analyst doing primary research
for the founder of **Marrow**. Your job is not to summarize the internet. It is to find
**decision-grade evidence**: what is real demand vs hype, what competitors have actually
shipped (not announced), where the technical frontier is heading, and what "world-class"
looks like for each user persona. Treat this like an investment memo, not a blog post.

Rules of evidence:

- Prefer **primary sources**: product docs, changelogs, GitHub repos, commits, and issues,
  pricing pages, funding announcements, conference talks, benchmark papers, first-party user
  interviews and threads. Cite each claim with a URL and a date.
- Prefer sources **dated within the last 12 to 18 months** (roughly 2025-01 onward). Explicitly
  flag anything older and say why it still holds.
- **Quantify** wherever possible: GitHub stars and their growth rate, download counts, funding
  amounts, pricing, benchmark deltas, adoption numbers. A number with a source beats an adjective.
- Separate **fact** (cited) from **inference** (your reasoning) from **speculation** (labeled as such).
- When sources conflict, say so and give your weighted read. Do not launder uncertainty as consensus.
- Call out **what you could not find**. Absence of evidence is itself a finding for a roadmap.

---

## 1. What Marrow is (primer, so you evaluate the right thing)

**Marrow is the product-context layer for coding agents.** When an AI coding agent (Claude Code,
Cursor, Codex, Windsurf, Cline, Devin, or a custom agent over MCP) works on a codebase, it knows
the *code* but not the *product truth*: why a decision was made, which goals are still live, what
was tried and rejected, what is decided vs still open. Marrow is the durable, provenance-backed
"room" that product truth lives in, and it feeds the agent a **task-scoped** slice of that truth
before it codes and checks the diff against it after.

Core design (the parts that constrain the roadmap):

- **One datastore: Postgres plus pgvector.** No graph database, no Redis, no Kafka, no new service.
  The knowledge graph is an `edge` table walked by a recursive CTE. Scheduling is cron or GitHub
  Actions calling a CLI, never a daemon.
- **Evidence is append-only and immutable.** Raw source material (`raw/`) has no status and is
  never edited. Every *distilled* fact carries `status` plus `confidence` plus `provenance` (a
  verbatim evidence span you can trace to).
- **Agent proposes, human promotes.** Agents can only *propose* facts. A fact becomes `decided`
  only when a human promotes it. No agent or MCP tool can write `decided`. This trust boundary is
  the product's spine.
- **Context is task-scoped.** The retrieval call (`prepare_task`) never returns the whole brain.
  It returns a small, walked, task-relevant slice. Measured roughly 2.5x token efficiency vs
  dumping context.
- **Surfaces:** a CLI, an MCP server (so any MCP host uses it), and a web console with a
  dependency-free living "map" of the knowledge graph.

**What Marrow already shipped (do NOT recommend building these, they exist):**

- A typed, directed **knowledge graph** (edges: concerns, serves, supersedes, refines,
  conflicts_with, relates_to), extracted automatically during distillation, walked during
  retrieval so a 2-hop relevant fact surfaces even with zero keyword overlap.
- **Freshness**: facts carry `verified_at` and `expires_at`. Staleness is derived and surfaced in
  citations and the maintenance brief. Confidence is never silently decayed.
- **A skeptic**: a fresh-context `verify` gate that attacks proposed facts (single-source,
  weak-provenance, contradicts-decided) and records an append-only verdict. It never promotes.
- **Maintenance loops**: `lint` (duplicates, contradictions, dead edges) and `synthesize` (weekly
  "what changed, what's drifting" digest), plus a session-end hook that mines a finished session
  into dated evidence.
- **Positioning**: a "context budget" narrative and a 3-line snippet to wire any repo in.

Marrow's aspiration is a **world-class developer-tool experience** on par with Temporal, Langfuse,
Linear, and Claude Code itself: onboarding, docs, DX, trust and provenance UX, and reliability.

---

## 2. The roadmap decision this research must inform

The founder will use your dossier to choose and sequence the **next roughly 4 quarters of work**.
The output must let them answer: *What are the highest-leverage things to build next, in what order,
that (a) are backed by real demand, (b) respect Marrow's sacred constraints, and (c) either raise
the UX to world-class or open a durable moat?* Frame everything toward that decision.

---

## 3. Research workstreams

Run these as parallel workstreams. Each is self-contained and each should end with its own
"implications for the roadmap" paragraph.

### WS-1: Market and demand. Is "product context for coding agents" a real, growing, monetizable need?

- Who feels this pain most acutely today, and how do they solve it now (CLAUDE.md and AGENTS.md
  files, Notion or Linear docs pasted into prompts, RAG over docs, tribal memory)? Find real user
  testimony (HN, Reddit r/LocalLLaMA and r/ExperiencedDevs, X, Discord, GitHub issues) about the
  pain of agents losing product intent, re-litigating decided decisions, or hallucinating requirements.
- Quantify the tailwind: growth of AI coding agents in production (Cursor, Claude Code, Copilot,
  Windsurf, Devin, Cline, Codex). Adoption numbers, revenue where public, enterprise rollouts.
- Is willingness-to-pay for a *context or memory* layer demonstrated anywhere (pricing, revenue,
  funding of adjacent startups)? Or is it assumed to be free or commodity? This is the crux.
- What is the sharpest **wedge persona**, the one who will pay first and refer others?

### WS-2: Competitive and adjacent landscape (the most important workstream)

For each of the following, find: what they actually ship, last-12-months changelog, positioning,
pricing, GTM, traction (stars, funding, users), and, critically, **where they overlap with Marrow
and where Marrow is differentiated**. Note especially anyone converging on "agent memory plus
knowledge graph plus provenance."

- **Agent memory platforms**: Mem0, Zep plus Graphiti, Letta (MemGPT), Cognee, Supermemory, and
  any newer entrants. (Graphiti and Zep is the closest architectural cousin, a temporal knowledge
  graph for agents. Study it hardest.)
- **Coding-agent-native context and memory**: what Cursor (memories, rules), Claude Code (CLAUDE.md,
  subagents, skills, MCP), Windsurf, Cline, Continue, and Sourcegraph or Cody do for persistent
  product and project context. Are any of them building the thing Marrow builds, in-house?
- **Spec, PRD, and decision-record tooling** moving toward AI: Linear, Notion AI, Dovetail, plus
  "spec-driven development" and ADR (architecture decision record) tooling. Does product truth get
  captured there instead?
- **RAG and context frameworks and GraphRAG**: LlamaIndex, LangChain or LangGraph, Microsoft
  GraphRAG, and the state of "agentic RAG." What is becoming a commodity building block vs a product?
- **MCP ecosystem**: the state of the Model Context Protocol registry or marketplace, notable
  context and memory MCP servers, and whether a *standard* for agent memory or context is emerging
  that Marrow should conform to or ride.
- For each: **is this a competitor, a complement, a distribution channel, or an acquirer?**

### WS-3: Technical frontier. Where does agent context and memory go in 2026 to 2027?

- **Long context vs retrieval**: as frontier models push toward very large or effectively-infinite
  context, does task-scoped retrieval still win? Find evidence on cost, latency, "lost in the middle"
  or context-rot degradation, and when retrieval beats stuffing. This bears directly on Marrow's core bet.
- **Memory standards and interop**: is anything standardizing how agents read and write persistent
  memory (protocol-level, MCP extensions, framework conventions)? What should Marrow implement to
  stay portable?
- **GraphRAG and temporal knowledge graphs**: current best practices, benchmarks, and failure modes.
  What is now table stakes for a knowledge-graph-backed retrieval system?
- **Verification and groundedness**: state of the art in fact-verification, contradiction detection,
  and provenance or citation for LLM outputs, to sharpen Marrow's skeptic beyond rules (it has a
  `model_used` slot reserved for a model-based deep pass).
- **Provenance and trust**: emerging expectations (and any regulation) around auditability of what an
  AI system "knew" and why, relevant to Marrow's append-only, traceable design as a selling point.

### WS-4: User personas and jobs-to-be-done. What does world-class look like for each?

Build a JTBD profile for each persona: pains, current workaround, the switch trigger, the "wow"
moment, and what would make them a paying advocate.

- **Solo founder-engineer or small team** shipping fast with a coding agent.
- **Staff or platform engineer at a scaleup** standardizing agent usage across many repos and people.
- **Eng manager or PM** who owns "why we decided this" and fears agents drifting from product intent.
- **Agent-tooling vendor or platform** who might embed Marrow rather than build context in-house.

For each, cite real evidence of the pain (threads, interviews, job posts, conference talks), not
personas invented from thin air.

### WS-5: UX and DX bar. Teardown of the tools Marrow wants to be measured against

Concrete, specific teardowns (with what to imitate) of: **Temporal** (reliability and mental-model
onboarding), **Langfuse** (observability DX, self-host plus cloud, OSS-led GTM), **Linear** (craft,
speed, opinionation), **Claude Code and Cursor** (agent-native UX, first-run, trust), and one great
**OSS infra CLI** (for example Supabase, Neon, Dagger). For each: first-run experience,
time-to-first-value, docs structure, how they build trust, how they convert OSS users to paid.
Extract the specific, copyable UX patterns Marrow should adopt.

### WS-6: Distribution and business model evidence

- How do dev-tools in this exact category (infra and agent-tooling, OSS-led) actually get adopted
  and monetized? Bottoms-up OSS to cloud, MCP registry presence, integrations, content or DevRel,
  design partners. Find real playbooks with numbers.
- Pricing evidence from the closest comparables (per-seat, usage, self-host plus cloud, enterprise).
- What has *failed* in this category, and why: dead memory or context startups, abandoned OSS projects.

### WS-7: Risks, moats, and the "why now, why Marrow" stress test

- What would make Marrow **irrelevant**: models ship native long-term memory, a coding agent ships
  its own product-context layer, a standard makes it a commodity, "just put it in CLAUDE.md" stays
  good enough. Rate each risk's likelihood and horizon.
- What is Marrow's **durable moat** given its constraints (single Postgres, provenance-first,
  human-in-the-loop promotion)? Is the trust boundary (agent proposes, human promotes) a real moat
  or a nice-to-have? Find evidence either way.
- The honest **why-now**: what changed in the last 12 months that makes this the right time?

---

## 4. Source and quality bar (repeated, because it matters)

- Every non-obvious claim: URL plus date. No citation means label it inference or speculation.
- Favor changelogs, repos, pricing pages, funding data, benchmarks, and real user voices over
  think-pieces. Recency-weight to the last 12 to 18 months.
- Quantify. Flag conflicts. Report what you could not find.

---

## 5. Required output format (so it maps straight onto a loopable todolist)

Deliver in this structure:

**A. Executive memo (1 page).** The 5 to 7 findings that should drive the roadmap, each one sentence
with its single strongest piece of evidence. Then the single biggest risk and the single biggest
opportunity.

**B. Evidence dossier by workstream (WS-1 through WS-7).** For each: key findings (cited), a table
of the relevant players or data, and a closing "implications for Marrow's roadmap" paragraph.

**C. Opportunity backlog, the raw material for the roadmap.** A ranked list of 12 to 20 candidate
initiatives. For **each** opportunity, fill this exact card so it can become a roadmap item:

  - **Title** (imperative, for example "Model-based deep skeptic pass").
  - **Problem and evidence**: the pain, with the cited source that proves it's real.
  - **Persona served**: which WS-4 persona, and the switch or wow it unlocks.
  - **Type**: `table-stakes` (must-have to stay credible), `differentiator` (widens the moat), or
    `bet` (high-upside, unproven).
  - **Effort**: S, M, or L, with the main technical risk.
  - **Constraint check**: how it respects Marrow's sacred rules (one Postgres, evidence immutable,
    agent proposes and human promotes, task-scoped context, dependency-free viz). Flag any that
    strain a rule.
  - **Dependencies**: what must ship first.
  - **Confidence**: high, medium, or low, based on the strength of the demand evidence.

**D. Suggested quarterly themes.** Cluster the backlog into 3 or 4 sequenced themes for the next four
quarters, with the rationale and the dependency order. This is the skeleton the founder will expand
into the executable todolist.

**E. Open questions and further research.** What remains unknown and would most change the plan if answered.

---

## 6. How to run this (optional, for a loop)

This brief is designed to be split into **7 parallel deep-research runs** (one per workstream), each
returning its WS section, then a final synthesis pass that produces sections A, C, D, and E across all
of them. Run WS-2 (competitive) and WS-3 (technical frontier) at the highest depth. They carry the
most roadmap-shaping signal. If run as a single pass, keep the workstream headings intact so the
output stays sortable into the opportunity backlog.
