# Agent-memory platforms: Mem0 vs. Zep

> Verbatim output of a deep-research run commissioned for the 2026 to 2027 roadmap
> (research date July 11, 2026). Checked in unedited as source material, so the
> plain-language house style does not apply to this file. The roadmap it feeds is
> `docs/roadmap/2026-2027.md`; the brief that produced it is
> `docs/research/2027-roadmap-brief.md`.

**Research date: July 11, 2026.** I reviewed the companies’ current websites, documentation, FAQs, pricing, open-source repositories, GitHub issues and discussions, and independent practitioner commentary. Public feedback is still concentrated in technical communities rather than large, verified-review datasets, so individual user reports below should be treated as warning signals—not failure-rate estimates.

## Executive conclusion

**Mem0 is the stronger default for most teams building ordinary cross-session personalization.** Its mental model is straightforward: send useful interactions to `add`, retrieve relevant memories with `search`, and decide which results go into the model prompt. It is comparatively inexpensive, has a more complete self-hosted option, and is well suited to preferences, durable user facts, project decisions, goals, and recurring instructions. ([Mem0][1])

**Zep is the stronger choice when time, relationships, provenance, and changing facts are central to the product.** Its core is a temporal context graph: facts have validity periods, replaced facts remain available historically, and derived information links back to the raw episodes that produced it. That is materially more capable for questions such as “What was true at that time?”, “What changed?”, and “How are these people, accounts, products, or events related?” ([Zep][2])

The biggest practical lesson is that **memory writing is harder than memory retrieval**. A system that retrieves perfectly from a polluted memory store will still produce bad answers. Mem0’s main risk is over-capturing, duplicating, hallucinating, or retaining obsolete facts. Zep’s main risks are ingestion latency, higher complexity, and the amount of irrelevant context that can accompany its intentionally high-recall retrieval strategy. ([GitHub][3])

## Side-by-side comparison

| Dimension                    | Mem0                                                                                             | Zep                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **Core abstraction**         | Selected facts and memories extracted from messages, stored in SQL/vector/entity-oriented stores | Temporal graph of entities, relationships, facts, and source episodes                                                      |
| **Best use cases**           | Preferences, profile facts, durable decisions, goals, personalized assistants                    | Changing relationships, CRM/support histories, enterprise entities, longitudinal health or workflow context                |
| **Write behavior**           | Current automatic extraction is additive; corrections may require explicit update/delete         | New facts can invalidate previous relationships while preserving historical truth                                          |
| **Retrieval**                | Semantic, keyword, entity, and temporal signals; the application chooses what enters the prompt  | Context assembled from facts, entities, episodes, summaries, observations, and user summaries                              |
| **Source provenance**        | Metadata and original memory records; implementation-dependent                                   | Raw episodes are retained as ground truth and connected to derived graph information                                       |
| **Short-term state**         | Long-term memory layer; the application should separately manage recent conversation/tool state  | Threads help organize interaction history, but recent turns still need an application-side buffer while ingestion finishes |
| **Self-hosting**             | Full open-source library and server/dashboard options                                            | Full Zep Community Edition is deprecated; self-hosting means Graphiti or enterprise BYOC                                   |
| **Starting paid price**      | $19/month Starter; $79/month Growth; $249/month Pro                                              | Flex is $104/month billed annually or $125 monthly; Flex Plus is $312/month annually or $375 monthly                       |
| **Primary operational risk** | Low-quality or excessive memory writes                                                           | Processing delay, graph/model complexity, and noisy high-recall context                                                    |

The architectural distinctions above follow the products’ current documentation. ([Mem0][1])

---

# Mem0

## What Mem0 does well

### 1. It has the easiest product model to understand

Mem0 sits between the application and the model. The application records useful information after an interaction and retrieves relevant memories before a later model call. By default, Mem0 turns messages into distilled facts instead of storing the entire transcript verbatim—for example, converting a sentence about aisle seats into a reusable preference. ([Mem0][1])

This makes Mem0 attractive when the product requirement is simply:

> “Remember what matters about this user or task, and bring it back when relevant.”

That is a much smaller engineering and conceptual commitment than adopting a temporal knowledge graph.

### 2. Scoping is practical for SaaS applications

Memories can be scoped with identifiers such as `user_id`, `agent_id`, `run_id`, and metadata. Mem0 explicitly recommends filtering every search so memories from different users, agents, sessions, workspaces, or sources do not mix. ([Mem0][1])

This maps cleanly to common product boundaries:

* user-level preferences;
* agent-specific knowledge;
* organization or workspace metadata;
* temporary run or task context.

### 3. Retrieval combines several useful signals

Mem0’s managed retrieval combines semantic similarity, exact keyword matching, entity relevance, and temporal intent. That is important because pure vector similarity is often poor at account numbers, names, dates, identifiers, and “latest state” questions. The open-source result depends more heavily on the configured vector store, reranker, and entity or graph components. ([Mem0][1])

### 4. It is configurable without requiring a graph-first architecture

Teams can customize extraction instructions to specify which facts should be remembered and which categories must be excluded. This is essential for domain-specific systems—for example, remembering travel preferences but excluding transient scheduling details, credentials, medical data, or unverified assumptions. ([Mem0][4])

Mem0 also gives self-hosters control over the language model, embedding model, vector database, reranker, and storage configuration. The managed platform removes most of that operational burden, while the open-source version provides considerably more flexibility.

### 5. It is much easier to pilot economically

The primary table on Mem0’s current pricing page lists:

* Free: 10,000 add requests and 1,000 retrievals per month.
* Starter: $19/month, 50,000 adds and 5,000 retrievals.
* Growth: $79/month, 200,000 adds and 20,000 retrievals.
* Pro: $249/month, 500,000 adds and 50,000 retrievals.
* Enterprise: custom pricing and limits, with on-premises deployment, audit logs, integrations, and SSO listed. ([Mem0][5])

One caution: the page currently renders a duplicated lower pricing table with conflicting Growth figures. The numbers above come from the primary table at the top of the page.

## Where Mem0 is weaker

### 1. Extraction quality can pollute the store

Mem0 uses an LLM to determine which preferences, decisions, plans, and other details are worth retaining. It then deduplicates and embeds those extracted memories. This is convenient, but the extraction model can still classify temporary information as durable, restate system instructions as user facts, generate near-duplicates, or infer details that were never actually provided. Mem0’s own documentation therefore advises calling `add` only for reusable information and avoiding secrets and unredacted sensitive data. ([Mem0][1])

A particularly severe—but nonrepresentative—GitHub report described one self-hosted deployment that accumulated 10,134 entries in 32 days. After manual review, the reporter retained only 224 and described duplicates, malformed memories, and hallucinated user attributes. That deployment used specific local and hosted extraction models and does not establish a platform-wide failure rate, but it clearly illustrates what happens when automatic writing is enabled without a strict memory policy and ongoing inspection. ([GitHub][3])

Other community reports similarly describe temporary dates, times, and conversational details being captured until extraction rules were tightened. Self-hosted users have also reported substantial write latency when using local models and vector stores. Those outcomes are highly configuration-dependent, but they reinforce that “self-hosted” does not mean “operationally free.”

### 2. Its current automatic algorithm is additive

When a user says they moved from one city to another, Mem0 can retain the new fact without silently rewriting the old one. Applications must use explicit update or delete operations when a memory needs correction or removal. ([Mem0][1])

This is defensible for auditability, but it creates an engineering responsibility: the application must distinguish among:

* a new fact that complements an old one;
* a correction;
* a changed fact;
* a time-limited fact;
* a contradiction;
* a false memory that should never have been stored.

Without that logic, the store may contain both current and obsolete claims and depend on retrieval-time recency ranking to choose correctly.

### 3. “Graph memory” is not equivalent to Zep’s temporal graph

Mem0’s documentation and pricing describe graph memory primarily in terms of **entity linking and relationship-aware retrieval**. That can improve results involving people, organizations, projects, and concepts, but it is not the same product model as Zep’s validity-windowed temporal graph with explicit source episodes and historical relationships. ([Mem0][1])

Mem0 is therefore less naturally suited to complex questions requiring multi-hop relationship traversal, contradiction history, or “what was true at a particular point in time?”

### 4. It does not replace complete conversation state

By default, Mem0 stores extracted facts rather than a verbatim transcript. Raw content can be stored with inference disabled, but doing so changes the product from selective memory into a persistent content store and can retain untrusted instructions or sensitive content. ([Mem0][1])

A production agent should still have a separate short-term state layer for recent messages, tool results, workflow variables, pending confirmations, and incomplete tasks.

---

# Zep

## What Zep does well

### 1. Temporal reasoning is a first-class concept

Zep’s graph represents entities and relationships whose truth can change. Facts have validity periods, and when new information supersedes an old fact, the old fact can be invalidated rather than erased. This makes historical and current-state queries much more natural than they are in a conventional vector memory store. ([Zep][2])

Examples where this matters include:

* a customer changing employers or account plans;
* a patient changing medications;
* an organization changing policies;
* a sales opportunity moving between stages;
* ownership, approvals, or responsibilities changing over time.

### 2. It preserves provenance better

Zep and Graphiti retain **episodes**—the raw chat messages, JSON objects, or text blocks that were ingested. Derived facts and relationships can be traced back to these episodes. ([Zep][6])

That is valuable when the application needs to explain:

* where a fact came from;
* whether the source was a user, agent, CRM record, or document;
* when it was observed;
* whether the derived summary accurately reflects the original content.

Neither provenance nor graph structure guarantees truth, but they make investigation and correction considerably more feasible.

### 3. It can assemble richer context

Zep can return facts, entities, raw episodes, thread summaries, observations, and a user summary. The default context block combines several of those representations, while templates let developers control how context is formatted and injected into the model. ([Zep][7])

This is a meaningful advantage for complex agents because different questions need different memory representations. A concise user preference might be enough for one answer, while another question may require the original episode and the surrounding relationship graph.

### 4. Enterprise controls are more prominent

Zep advertises SOC 2 Type II certification, full graph-level tenant isolation, API and audit logging, role- and attribute-based access controls, and enterprise deployment options including BYOK and BYOC. HIPAA BAAs and one-year audit/API-log retention are listed for Enterprise, and Zep states that it signs DPAs for EU customers. ([Zep][8])

Mem0 advertises SOC 2 Type I, HIPAA support, BYOK, auditability, and enterprise/on-premises options. These are not identical assurance levels, and any regulated procurement should verify the exact service scope, subprocessors, retention behavior, deletion guarantees, and contract language rather than relying only on product badges.

### 5. Its charging model does not meter retrieval

Zep charges primarily according to the size of ingested episodes: one credit for up to 350 bytes and another credit for each additional 350-byte portion. Retrieval, storage, threads, users, and graph storage are listed as zero-credit operations. ([Zep][9])

That can be attractive for products with moderate ingestion and very frequent reads, although larger JSON payloads and long messages can consume credits quickly.

## Where Zep is weaker

### 1. There is a much higher paid-entry point

Current self-service pricing is:

* Free prototype: 10,000 credits per month, with lower-priority episode processing.
* Flex: $1,250/year, equivalent to $104/month billed annually, or $125 month-to-month; 50,000 credits.
* Flex Plus: $3,750/year, equivalent to $312/month billed annually, or $375 month-to-month; 200,000 credits.
* Enterprise: negotiated pricing. ([Zep][9])

Observations, custom extraction instructions, webhooks, and analytics are listed under Flex Plus rather than basic Flex. Consequently, a serious evaluation of advanced context behavior can start at a substantially higher cost than a Mem0 pilot. ([Zep][9])

### 2. New information is not necessarily immediately query-ready

Building and updating the graph involves entity extraction, relationship extraction, deduplication, temporal interpretation, embedding, and indexing. A user report involving Zep and Graphiti described recent conversation details remaining unavailable while ingestion was still processing, with concern that larger document ingestion could take much longer. The report is from one configuration, but it identifies an architectural issue that any graph-extraction pipeline must address. ([GitHub][10])

The production pattern should therefore be:

1. Keep the latest turns in an immediate session buffer.
2. Use that buffer for read-after-write consistency.
3. Send interactions to Zep asynchronously.
4. Switch to graph-derived context after ingestion confirms completion.

Without this pattern, a user may tell the agent something and immediately receive a response that behaves as though the information was forgotten.

### 3. Zep explicitly favors recall over precision

Zep’s documentation says its retrieval philosophy prioritizes high recall and low latency, accepting that some less-relevant material may be included. ([Zep][11])

That is reasonable because a downstream model can often ignore a slightly irrelevant fact, while it cannot use a missing fact. But it has costs:

* larger prompts;
* more distraction and contradiction opportunities;
* weaker prompt caching when dynamic context changes;
* increased model cost;
* a greater need for context templates, filtering, and reranking.

For tasks requiring highly precise evidence sets, this behavior needs to be measured rather than assumed acceptable.

### 4. Self-hosting is no longer “self-host Zep”

Zep’s FAQ says Community Edition is deprecated and unsupported. The options are Zep Cloud, enterprise BYOC, or Graphiti—the open-source temporal graph engine underlying Zep. ([Zep][8])

Graphiti is powerful, but it is not the complete managed Zep product. Teams must operate a graph database such as Neo4j, FalkorDB, or an AWS graph stack; configure LLMs, embeddings, and reranking; and build user, thread, application, governance, and operational tooling around it. Zep’s own comparison says those surrounding capabilities are built into Zep but must be built by Graphiti users. ([Zep][12])

Graphiti also warns that extraction works best with models that reliably support structured output. Smaller or local models can generate invalid schemas and ingestion failures, and throughput must be tuned against model-provider concurrency and rate limits. ([GitHub][13])

### 5. It can be excessive for simple personalization

A temporal graph is unnecessary when the application only needs a few stable fields such as language, dietary preferences, preferred response format, or notification choices. In those cases, a typed SQL profile may be more reliable and less expensive than either product.

---

# What the user feedback really suggests

## Mem0 feedback pattern

The positive pattern is **fast integration and flexibility**. Developers can add useful memory without redesigning the complete application around a graph. It fits naturally into existing agent frameworks and is easy to understand.

The negative pattern is **write selectivity**. Reports of over-capture, near-duplicates, malformed memories, hallucinated profile attributes, and slow local extraction indicate that the default behavior should not be treated as an autonomous, maintenance-free memory curator. The severe 10,134-entry audit is only one deployment, but it is a strong argument for a memory inspection UI, category allowlists, source attribution, and scheduled quality audits. ([GitHub][3])

## Zep and Graphiti feedback pattern

The positive pattern is **a more expressive and defensible memory representation**, especially where facts evolve and provenance matters.

The negative pattern is **operational weight**. Public issue reports focus on ingestion time, provider configuration, graph backends, schema extraction, concurrency, and local-model reliability. Some of these issues concern Graphiti rather than managed Zep Cloud and should not be conflated, but they accurately describe the work involved in running the open-source path. ([GitHub][10])

## Benchmark claims are not a safe purchasing basis

Both companies publish very strong long-term-memory benchmark results. However, the measurements are vendor-authored, configurations differ, and public replication discussions have produced substantially different scores and even reversed apparent rankings. Mem0 and Zep have also publicly disputed benchmark methodology and corrected prior comparisons. ([Mem0][14])

The useful takeaway is not that one benchmark winner is “best.” It is that both systems can outperform naive full-history or basic vector approaches under some conditions. Procurement should depend on an evaluation using the organization’s own conversations, fact types, update patterns, model, latency requirements, and privacy rules.

---

# Selection recommendation

## Choose Mem0 when

Mem0 is the better fit when the product mainly needs durable preferences, user facts, decisions, goals, recurring instructions, or lightweight personalization; the engineering team wants a quick API integration; budget matters; or full self-hosting without committing to a dedicated temporal graph stack is important.

It is my preferred starting point for most consumer assistants, coaching applications, education products, lightweight support personalization, and agent MVPs.

## Choose Zep when

Zep is the better fit when the agent must understand changing relationships and historical state; ingest both conversational and business data; preserve source lineage; answer temporal or multi-hop questions; or satisfy enterprise governance requirements around isolation, logging, deployment boundaries, and controlled context assembly.

It is my preferred option for sophisticated CRM, account intelligence, longitudinal care support, enterprise copilots, policy/compliance workflows, and agents whose value depends directly on understanding how entities change over time.

## Use neither when

A dedicated memory platform is probably unnecessary when the application is single-session, the “memory” is just a small structured customer profile, the knowledge source is predominantly static documentation, or exact deterministic state is more important than semantic recall.

A conventional combination of SQL, a recent-message buffer, and ordinary document RAG may be cheaper, easier to test, and more reliable.

# Recommended evaluation design

Run both systems against the same 200–500 representative conversation sequences, using the same extraction model where configuration permits. Include preference facts, temporary details, corrections, contradictions, malicious instructions, relationship changes, and deletion requests.

Measure:

| Metric                           | What it reveals                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Write precision**              | Percentage of stored memories that genuinely deserved long-term retention                        |
| **Write recall**                 | Important durable facts that were missed                                                         |
| **False-memory rate**            | Stored claims not supported by a source interaction                                              |
| **Duplicate rate**               | Exact and semantic duplication over time                                                         |
| **Current-state accuracy**       | Whether the latest valid fact wins                                                               |
| **Historical accuracy**          | Whether the system can answer what was true previously                                           |
| **Ingestion-ready p95**          | Time until a new fact becomes reliably retrievable                                               |
| **Retrieval recall@k**           | Whether the required evidence appears in the returned context                                    |
| **Context-noise ratio**          | Irrelevant or distracting content returned with useful facts                                     |
| **Prompt tokens per turn**       | Downstream model cost and distraction                                                            |
| **Deletion completeness**        | Whether the fact, embeddings, graph edges, summaries, and source episode are removed as required |
| **Cost per 1,000 conversations** | Platform fees plus extraction, embedding, reranking, storage, and model costs                    |

Regardless of vendor, the production design should include a short-term session buffer, a strict durable-memory allowlist, tenant and source metadata on every write, an inspect/correct/delete interface, periodic quality audits, and explicit protection against instructions embedded in retrieved memory.

**Overall recommendation:** begin with **Mem0** unless temporal relationships and historical truth are central product requirements. Choose **Zep** deliberately when its temporal graph and provenance model create direct business value sufficient to justify the higher cost and architectural complexity.

[1]: https://docs.mem0.ai/core-concepts/how-it-works "How Mem0 Works - Mem0"
[2]: https://help.getzep.com/facts "Facts | Zep Documentation"
[3]: https://github.com/mem0ai/mem0/issues/4573 "What we found after auditing 10,134 mem0 entries: 97.8% were junk · Issue #4573 · mem0ai/mem0 · GitHub"
[4]: https://docs.mem0.ai/platform/features/custom-instructions "Custom Instructions - Mem0"
[5]: https://mem0.ai/pricing "AI Memory Pricing - LLM Memory Plans Starting Free | Mem0"
[6]: https://help.getzep.com/episodes "Episodes | Zep Documentation"
[7]: https://help.getzep.com/context-types "Context types | Zep Documentation"
[8]: https://help.getzep.com/faq "FAQ | Zep Documentation"
[9]: https://www.getzep.com/pricing/ "Pricing | Zep"
[10]: https://github.com/getzep/graphiti/issues/356 "Long Ingestation process · Issue #356 · getzep/graphiti · GitHub"
[11]: https://help.getzep.com/retrieval-philosophy "Retrieval philosophy | Zep Documentation"
[12]: https://help.getzep.com/zep-vs-graphiti "Zep vs Graphiti | Zep Documentation"
[13]: https://github.com/getzep/graphiti/blob/main/README.md "graphiti/README.md at main · getzep/graphiti · GitHub"
[14]: https://mem0.ai/research?utm_source=chatgpt.com "Mem0 Research Paper: Token-Efficient Memory Algorithm"
