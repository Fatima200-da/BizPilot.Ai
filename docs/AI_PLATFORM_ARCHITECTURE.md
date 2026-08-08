# BizPilot AI — AI Platform Architecture

**Author:** Chief AI Architect / Distinguished Engineer / AI Platform Director / Principal Distributed Systems Architect / LLM Infrastructure Architect
**Status:** v1.0 — Architecture Decision Document (pre-implementation)
**Depends on (immutable, not redesigned here):** [`docs/PRD.md`](PRD.md) · [`docs/DATABASE.md`](DATABASE.md) · [`docs/AUTH_ARCHITECTURE.md`](AUTH_ARCHITECTURE.md) · [`docs/API_CONTRACT.md`](API_CONTRACT.md) · [`docs/BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md)
**Audience:** Staff+ engineers implementing and reviewing every AI capability BizPilot AI will ever ship.

> **This document does not start from zero.** `BACKEND_ARCHITECTURE.md` §6 already designed an AI Layer — a Conversation Engine, Prompt Engine, Provider Router, Streaming Engine, and AI Credits Engine, each with a full architectural treatment. This document does not redo that work. It **formalizes those five engines as components of a much larger system**, extends each one to its full production depth, and adds everything that system did not yet cover: memory, retrieval-augmented generation, multi-modal understanding, autonomous agents, tool use, workflow automation, AI-specific economics, observability, safety, and the model-lifecycle machinery a decade-scale AI platform needs. Every section states explicitly whether it is *citing* a prior decision, *extending* one, or introducing genuinely new architecture — that distinction is load-bearing throughout, not a formality.

---

## 0. Executive Summary, Scope & Governing Principles

### 0.1 What This Document Is

An Architecture Decision Document for the **Intelligence Layer** — the subsystem that turns a user's (or a workflow's, or an agent's) intent into a grounded, safe, cost-accounted AI response, across every product surface BizPilot AI will ever expose: Business Copilot, AI Employees, AI Teams, AI Agents, AI Automation, AI Knowledge/Search, AI Analytics, AI Documents, and the vertical capabilities (Marketing, Sales, Finance, Support, Coding) that sit on top of it. The central engineering claim this document makes and defends throughout: **there is exactly one Intelligence Layer**, entered through exactly one Gateway, regardless of which product surface or client triggered the request. Every vertical capability is a *configuration* of this one system (which prompts, which tools, which memory scopes, which agents are involved) — never a parallel implementation.

### 0.2 Scope

Full architecture for the 110 subsystems named in the assignment brief, organized into 15 technical parts (§0.6) plus a formal ADR appendix (Part 16) and a consolidated risk/migration register (Part 17). Covers architecture only — no source code, no pseudocode, no provider SDK specifics beyond what's needed to justify a port boundary.

### 0.3 Non-Goals

- Redesigning anything already decided. `AICredit`/`AIUsage` (`DATABASE.md` §4), the Conversation/Prompt/Provider/Streaming/Credits engines (`BACKEND_ARCHITECTURE.md` §6), the permission pipeline (`AUTH_ARCHITECTURE.md` §4.5), the `/ai/*` REST surface (`API_CONTRACT.md` §5.10) — all treated as fixed inputs. Where this document needs a new column, table, or infrastructure component beyond what those documents defined, it is explicitly marked **(new infrastructure, introduced here)** or **(future schema extension, not required today)** — the same discipline `AUTH_ARCHITECTURE.md` used for `AuthIdentity`/`MfaFactor`.
- Selecting a specific vector database product, a specific embedding model, or a specific agent framework by brand name — this document specifies the *port* and the *selection criteria*, not a procurement decision.
- Anything below the Intelligence Layer that `BACKEND_ARCHITECTURE.md` already owns (DI, module boundaries, the Event Bus's transport, the Queue's retry mechanics, HTTP-level request handling) — reused by reference throughout, never restated.

### 0.4 A Note on Document Density

110 subsystems, each given a naive, independent 24-field treatment, would produce an unreadable, undifferentiated document — the opposite of what a Principal-Engineer review actually rewards. This document instead applies one consistent, condensed template — **Purpose & Responsibilities · Architecture · Scalability & Performance · Security & Privacy · Failure Handling & Recovery · Observability · Trade-offs & Rejected Alternatives · Future Evolution** — at full depth to every subsystem that is architecturally load-bearing (the majority), and in explicitly cross-referenced, compact form to subsystems that are direct extensions of an already-fully-specified mechanism (stated as such, never silently thin). This is the same information-density discipline every prior document in this series has used, applied here at a larger scale because the brief is larger, not because the standard has dropped.

### 0.5 Governing Principles, Made Concrete

| Principle (from the brief) | Concrete mechanism in this document |
|---|---|
| Provider-agnostic / zero vendor lock-in | Every provider (LLM, embedding, moderation, vector store) sits behind a port (§2.3, §7.7); Dynamic Provider Selection (§2.5) and Provider Failover (§11.9) make switching an operational event, not a rewrite |
| Enterprise-first, privacy-first, security-first | Tool/Agent authorization reuses `AUTH_ARCHITECTURE.md`'s exact permission pipeline (§9.10) — an AI agent never has more authority than the human it acts for; PII protection and memory-forgetting extend `AUTH_ARCHITECTURE.md`'s GDPR posture (§13.3, §6.13) rather than creating a parallel one |
| Event-driven, distributed, composable | Agent-to-agent communication and Workflow triggers reuse the Event Bus (`BACKEND_ARCHITECTURE.md` §13.1) verbatim (§9.4, §10.2) |
| Cost-aware | Token Accounting, Cost Forecasting, and per-agent-run budget caps (§11.1–§11.4) extend the existing `CreditLedgerService` (`BACKEND_ARCHITECTURE.md` §6.5) rather than introducing a second accounting system |
| Deterministic where required / eventually consistent where appropriate | Structured-output validation and groundedness checks (§12.9) are deterministic gates; memory consolidation and search-index freshness (§6.12, §7.2) are explicitly eventually consistent, with the inconsistency window stated, not hidden |
| Fault tolerant, self-healing, graceful degradation | Every port has a documented degraded-mode behavior (§2.3's table); circuit breakers and failover (§11.8–§11.9) extend `BACKEND_ARCHITECTURE.md` §9.1 per-adapter |
| Open for future research | Part 15 names four concrete future directions (fine-tuning, distillation, local/edge models, federated learning) and states *why the architecture already accommodates each* rather than treating them as an afterthought |

### 0.6 Document Map (110 Subsystems → 15 Parts)

| Part | Covers subsystem #s | Title |
|---|---|---|
| 1 | 1 | AI Platform Architecture (this document's top-level system view) |
| 2 | 2–11 | Intelligence Layer & LLM Orchestration Engine |
| 3 | 12–20 | Prompt Engineering System |
| 4 | 21–24 | Context Engineering |
| 5 | 25–26 | Conversation Engine (extension) |
| 6 | 27–39 | Memory Architecture |
| 7 | 40–48 | RAG & Knowledge Architecture |
| 8 | 49–55 | Multi-Modal Understanding |
| 9 | 56–69 | Agentic System |
| 10 | 70–73 | Workflow Automation |
| 11 | 74–83 | AI Economics & Resilience |
| 12 | 84–93 | AI Observability & Quality |
| 13 | 94–97 | Safety, Privacy & Compliance |
| 14 | 98–104 | Model Lifecycle & Experimentation |
| 15 | 105–110 | Future Research Directions |
| 16 | — | Formal Architecture Decision Records |
| 17 | — | Consolidated Risks, Assumptions, Constraints, Migration Roadmap |

### 0.7 Diagram Index

| # | Diagram | § |
|---|---|---|
| 1 | Intelligence Layer system architecture | 1.2 |
| 2 | Dependency graph (Intelligence Layer ↔ existing bounded contexts) | 1.3 |
| 3 | AI Gateway component diagram | 2.2 |
| 4 | AI Request Lifecycle (master sequence) | 2.6 |
| 5 | AI Response Lifecycle | 2.6 |
| 6 | Dynamic Provider/Model Selection (flowchart) | 2.5 |
| 7 | Prompt Compiler pipeline | 3.1 |
| 8 | Context Builder pipeline | 4.1 |
| 9 | Memory Architecture layer diagram | 6.1 |
| 10 | Memory retrieval sequence | 6.11 |
| 11 | Memory consolidation sequence | 6.12 |
| 12 | RAG / Knowledge Pipeline (end to end) | 7.1 |
| 13 | Document ingestion sequence | 7.2 |
| 14 | Multi-modal content extraction pipeline | 8.1 |
| 15 | Agent Runtime state diagram | 9.1 |
| 16 | Plan → Execute → Critique → Reflect loop (sequence) | 9.6 |
| 17 | Multi-agent communication (sequence) | 9.3 |
| 18 | Tool invocation & sandboxing (sequence) | 9.11 |
| 19 | Workflow Engine state diagram | 10.1 |
| 20 | Provider failover (sequence) | 11.9 |
| 21 | Model rollout lifecycle (state diagram) | 14.1 |
| 22 | Safety/moderation pipeline (flowchart) | 13.1 |

---

## Part 1 — AI Platform Architecture

### 1.1 Purpose & Responsibilities

Answer, once, the question every subsequent section depends on: *when any part of BizPilot AI needs intelligence, where does it go, and what guarantees does it get?* The answer is the **Intelligence Layer** — a single internal platform, not a per-feature integration. Business Copilot chat, an AI Employee executing a multi-step task, a Workflow's automated AI step, and a background content-generation job (`API_CONTRACT.md` §5.10) are four *entry points*, never four *implementations*.

### 1.2 System Architecture

```mermaid
flowchart TB
    subgraph Entrants["Entry Points"]
        Copilot["Business Copilot (chat)"]
        Employees["AI Employees / AI Teams"]
        Agents["AI Agents (autonomous)"]
        Workflows["Workflow Automation steps"]
        Background["Background jobs (summarization, etc.)"]
    end

    subgraph Gateway["AI Gateway (§2.1–§2.2)"]
        direction TB
        Ingress["Ingress: auth/authz already resolved upstream\n(AUTH_ARCHITECTURE.md §4.5) — Gateway adds AI-specific checks"]
        Router["AI Router (§2.4): path selection"]
    end

    subgraph Orchestration["LLM Orchestration Engine"]
        Memory["Memory Retrieval (Part 6)"]
        RAG["Knowledge Retrieval (Part 7)"]
        ContextBuilder["Context Builder (Part 4)"]
        PromptCompiler["Prompt Compiler (Part 3)"]
        ProviderAbstraction["Provider Abstraction Layer (§2.3)"]
        AgentRuntime["Agent Runtime (Part 9, when path = agentic)"]
    end

    subgraph Providers["External AI Providers (behind ports)"]
        LLM["LLM Providers"]
        Embed["Embedding Providers"]
        Mod["Moderation Providers"]
    end

    subgraph PostProcess["Post-Processing"]
        Validation["Output Validation / Safety (Part 12–13)"]
        Consolidation["Memory Consolidation (§6.12)"]
        Accounting["Token Accounting / Credit Reconciliation (Part 11)"]
    end

    Entrants --> Gateway
    Gateway --> Orchestration
    Memory --> ContextBuilder
    RAG --> ContextBuilder
    ContextBuilder --> PromptCompiler --> ProviderAbstraction
    ProviderAbstraction <--> Providers
    AgentRuntime --> ProviderAbstraction
    Orchestration --> PostProcess
    PostProcess --> Entrants
```

**Design Decisions:** every entry point converges on one Gateway, which is what makes "one unified intelligence architecture" (the brief's explicit requirement) an enforced property rather than an aspiration — there is structurally no second code path by which AI capability could be added to the product without passing through the shared safety, cost, and observability guarantees this document specifies once. The Agent Runtime is drawn as a peer of Provider Abstraction, not a wrapper around it, because a single-turn generation (the common case) never touches the Agent Runtime at all — it is invoked only when the AI Router (§2.4) classifies a request as needing planning/tool use, keeping the low-latency common path free of agentic overhead.

### 1.3 Relationship to Existing Bounded Contexts

```mermaid
flowchart LR
    Intelligence["Intelligence Layer\n(this document)"]
    aiplatform["ai-platform module\n(BACKEND_ARCHITECTURE.md §3.1)"]
    tenancy["tenancy (BusinessProfile, permissions)"]
    content["content (Files → Knowledge Pipeline input)"]
    collaboration["collaboration (Notification/Audit consumers)"]
    extensibility["extensibility (Webhooks, API Keys, Plugin Engine)"]

    Intelligence -->|"implemented inside"| aiplatform
    Intelligence -->|"reads via public interface"| tenancy
    Intelligence -->|"reads via public interface"| content
    Intelligence -->|"publishes domain events to"| collaboration
    Intelligence -->|"tool/agent sandboxing reuses"| extensibility
```

**Design Decisions:** the Intelligence Layer is **not a new bounded context** — it lives inside the `ai-platform` module `BACKEND_ARCHITECTURE.md` §3.1 already defined, as that module's internal architecture grown to full depth. It obeys the same dependency rule (`BACKEND_ARCHITECTURE.md` §1.2/§3.3): it reads `tenancy` and `content` through their public interfaces only, and every side effect it causes elsewhere in the platform (a notification, an audit entry, a webhook) is an event, never a direct call. **Rejected alternative:** modeling the Intelligence Layer as its own top-level bounded context, parallel to `ai-platform`. Rejected — `DATABASE.md` §1.1 already scoped "AI Platform" as one bounded context owning `AICredit`/`AIUsage`/`Conversation`/`Message`/`Prompt`*/`Template`*; introducing a second, overlapping context for "the code that does the AI" versus "the data about the AI" would fight that document's own boundary rather than build on it.

### 1.4 Scalability & Performance Envelope

The Intelligence Layer inherits `BACKEND_ARCHITECTURE.md`'s statelessness guarantee (§1, §9.4) completely — no component introduced in this document holds per-request state outside the request's own execution. The two genuinely new scaling axes this document introduces are: **vector search load** (Part 7, addressed via `pgvector` first, a dedicated vector store later — ADR-AI-003) and **agent run duration/concurrency** (Part 9, addressed via the Worker process, `BACKEND_ARCHITECTURE.md` §8, not the request-serving API process — a multi-minute agent run is never held open on an API instance).

### 1.5 Future Evolution

Part 15 (Future Research Directions) is this section's forward-looking counterpart — every item there (fine-tuning, distillation, local/edge models, federated learning) is a change to *what sits behind a port*, never a change to the system architecture diagrammed in §1.2.

---

## Part 2 — Intelligence Layer & LLM Orchestration Engine

*(Subsystems 2–11: Intelligence Layer, LLM Orchestration Engine, Provider Abstraction Layer, Provider Capability Matrix, Dynamic Provider Selection, Dynamic Model Selection, AI Gateway, AI Router, AI Request Lifecycle, AI Response Lifecycle.)*

### 2.1 AI Gateway

**Purpose & Responsibilities:** the single ingress point for every AI request in the platform (§1.2). Authentication and workspace/permission resolution are **already complete** by the time a request reaches the Gateway (`AUTH_ARCHITECTURE.md` §4.5 / `API_CONTRACT.md` §1.5 run in the Presentation-layer middleware, ahead of any Use Case, per `BACKEND_ARCHITECTURE.md` §2.3) — the Gateway's job starts from an already-authorized identity context and adds everything that's specific to *AI* requests: (1) normalizing the request into one canonical internal shape regardless of entry point (§2.6), (2) a pre-flight credit-affordability check (delegating to the existing `CreditLedgerService.reserve()`, `BACKEND_ARCHITECTURE.md` §6.5 — not reimplemented), (3) prompt-injection surface hardening (§3.7) and input moderation (§13.1) before any provider call, (4) request correlation/tracing initiation (extending `BACKEND_ARCHITECTURE.md` §5.6/§5.7's request-context propagation with AI-specific trace fields).

**Architecture:**

```mermaid
flowchart TB
    In["Incoming AI request\n(from any entry point, §1.2)"] --> Normalize["1. Normalize to canonical AiRequest\n(actionType, workspaceId, userId, input, conversationId?, promptId?, ...)"]
    Normalize --> CreditCheck["2. Credit affordability check\n(CreditLedgerService.reserve, BACKEND_ARCHITECTURE.md §6.5)"]
    CreditCheck -->|insufficient, HARD_STOP| Reject402["Reject — 402, no provider call made"]
    CreditCheck -->|ok| InputModeration["3. Input moderation + injection hardening (§3.7, §13.1)"]
    InputModeration -->|flagged| RejectSafety["Reject — AIUsageStatus.BLOCKED_BY_GUARDRAIL\n(DATABASE.md §4 — existing enum value)"]
    InputModeration -->|clean| Router["4. Hand off to AI Router (§2.4)"]
```

**Scalability & Performance:** stateless, horizontally scaled with the rest of the API process (`BACKEND_ARCHITECTURE.md` §1.1) — the Gateway is a pipeline of fast, synchronous checks (credit reservation is a bounded row-lock operation, `BACKEND_ARCHITECTURE.md` §6.5; moderation is a fast provider call, typically single-digit milliseconds to tens of milliseconds) that adds negligible latency ahead of the (much longer) generation step itself.

**Security & Privacy:** the Gateway is the single place credit reservation and input moderation are *guaranteed* to run — because every entry point converges here (§1.2), there is no code path that reaches a provider call without passing both checks, which is precisely what closes off the failure mode of a new feature accidentally skipping cost or safety controls.

**Failure Handling & Recovery:** a credit-reservation failure or a moderation-provider outage both fail closed at this stage (before any cost is incurred) — consistent with `AUTH_ARCHITECTURE.md`'s general "fail toward bounded, explained rejection, never toward silent bypass" posture. A moderation-provider *outage* (as opposed to a moderation *flag*) is handled by the Circuit Breaker/Failover mechanism (§11.8–§11.9), not by silently skipping the check.

**Observability:** every request entering the Gateway is assigned an `aiTraceId` (in addition to the standard `requestId`/`traceId`, `API_CONTRACT.md` §3.3) that threads through the entire Orchestration pipeline and appears on the resulting `AIUsage` row (`DATABASE.md` §4) — this is the field that makes "show me everything that happened for this one AI generation" a single query rather than a log-correlation exercise.

**Trade-offs & Rejected Alternatives:** **rejected** — letting each entry point (Copilot, Agent Runtime, Workflow steps) perform its own credit check and moderation call independently. Rejected because it is precisely the duplication that would let a new entry point forget one of these checks; centralizing them in one Gateway trades a small amount of indirection for a *structural* guarantee instead of a *remembered* one.

**Future Evolution:** the Gateway is the natural home for future request-level features that must apply uniformly — per-partner rate-limit tiers for a future public AI API (`API_CONTRACT.md` §7.2), and request-level A/B assignment (§14.3).

### 2.2 LLM Orchestration Engine

**Purpose & Responsibilities:** the umbrella name for the pipeline the Gateway hands a normalized request to: Memory Retrieval → Knowledge Retrieval → Context Building → Prompt Compilation → Provider Abstraction (→ Agent Runtime, if the Router selected the agentic path) → Post-Processing. This section names the whole; every stage is specified in its own Part below.

**Architecture:** see §1.2's diagram — the Orchestration Engine *is* everything inside the "Orchestration" subgraph.

**Trade-offs & Rejected Alternatives:** **rejected** — a monolithic "just call the LLM" function with inline context-gathering and prompt-string-building. This is what most AI feature integrations look like at small scale, and it is explicitly rejected here for the same reason `BACKEND_ARCHITECTURE.md` §1.2 rejected the "3-layer" backend structure: it makes each stage (retrieval, compilation, provider selection) untestable in isolation and unshareable across the ten-plus product surfaces (§0.1) this platform must eventually support with the *same* pipeline.

### 2.3 Provider Abstraction Layer

**Purpose & Responsibilities:** extends `BACKEND_ARCHITECTURE.md` §1.3's `AIProviderPort`/§6.3's Provider Router to their full production shape, and generalizes the same pattern to every other externally-provided AI capability this document introduces: not just completion/chat providers, but **embedding providers** (`EmbeddingProviderPort`, Part 7) and **moderation providers** (`ModerationPort`, Part 13). All three follow the identical hexagonal shape already established.

**Architecture — the port catalog this document adds to `BACKEND_ARCHITECTURE.md` §1.3's table:**

| Port | Adapter(s) today | Degraded-mode behavior if provider unavailable |
|---|---|---|
| `AIProviderPort` (existing) | `OpenAIAdapter` | Circuit breaker opens (§11.8) → Dynamic Provider Selection fails over (§11.9) → if no healthy provider remains, request rejected with a clear `502`-mapped error, credit reservation released in full |
| `EmbeddingProviderPort` **(new)** | `OpenAIEmbeddingAdapter` | RAG retrieval (Part 7) degrades to keyword-only search (the existing Postgres FTS half of Hybrid Search, `BACKEND_ARCHITECTURE.md` §7.4) rather than failing the whole request |
| `ModerationPort` **(new)** | Provider-native moderation endpoint adapter | Fails closed at the Gateway (§2.1) — moderation is a safety control, never silently skipped |

**Security & Privacy:** every adapter is the *only* code holding that provider's SDK client and API key (via `SecretsProviderPort`, `BACKEND_ARCHITECTURE.md` §11.1) — unchanged principle, restated because it now applies to three port families instead of one.

**Trade-offs & Rejected Alternatives:** **rejected** — using a third-party LLM-abstraction framework (a "universal LLM client" library) instead of a hand-rolled port. Rejected for the same reason `BACKEND_ARCHITECTURE.md` §2.2 rejected a heavyweight DI framework: a thin, explicit port that BizPilot AI fully controls is easier to reason about, has no framework-version-upgrade risk on the platform's single most important integration surface, and — critically — a generic abstraction library's lowest-common-denominator interface would likely under-expose exactly the provider-specific capabilities (function calling, structured output, vision) the Capability Matrix (§2.4) needs to reason about precisely.

**Future Evolution:** `AnthropicAdapter`, `AzureOpenAIAdapter`, a local/on-prem model adapter (Part 15) — each a new adapter behind an unchanged port, the payoff stated once here and not repeated at every future-adapter mention throughout this document.

### 2.4 Provider Capability Matrix

**Purpose & Responsibilities:** the structured registry every selection decision (§2.5, §2.6) reads from — for each `(provider, model)` pair: supported modalities (text/image/audio/video, input and output independently), maximum context window, function/tool-calling support, streaming support, structured-output (JSON mode) support, moderation built-ins, cost per input/output token, observed p50/p95 latency (fed by Provider Health Monitoring, §11.10), and compliance attributes (data-residency region, whether the provider trains on submitted data, relevant certifications) relevant to `docs/AUTH_ARCHITECTURE.md` §6.3's SOC 2 posture.

**Architecture:** a small, centrally-maintained configuration store (not a Prisma-backed table — this is closer to `BACKEND_ARCHITECTURE.md` §5.8's L1 in-process-cacheable catalog data than to transactional business data; it changes only when BizPilot AI adds/updates a provider integration, not per-tenant, per-request) read by the Provider Router and Dynamic Model Selection at request time and refreshed periodically from live health data.

**Trade-offs & Rejected Alternatives:** **rejected** — deriving capabilities dynamically by probing each provider per request ("try function calling, see if it errors"). Rejected as needless latency and cost on the hot path for information that changes on the order of "when BizPilot AI ships a new integration," not per-request — a static, centrally-updated matrix is both cheaper and more predictable.

**Future Evolution:** as the matrix grows (more providers, more models, Part 15's local/edge entries), it becomes the natural home for cost/quality benchmarking data feeding Model Rollout decisions (Part 14) — the matrix and the Evaluation subsystem (Part 12) are designed to share this data rather than duplicate it.

### 2.5 Dynamic Provider Selection & Dynamic Model Selection

**Purpose & Responsibilities:** given a normalized `AiRequest` and the Capability Matrix, choose *which provider* and, within it, *which model* actually serves the request — the concrete mechanism realizing "zero vendor lock-in" as an operational reality.

**Architecture:**

```mermaid
flowchart TD
    Req["Normalized AiRequest + required capabilities\n(modality, context length, tool-calling need, structured-output need)"] --> Filter["1. Filter Capability Matrix to providers/models\nthat satisfy the hard requirements"]
    Filter --> Health{"2. Any candidate provider's\ncircuit breaker open? (§11.8)"}
    Health -->|remove unhealthy| Rank["3. Rank remaining candidates:\ncost policy (plan-tier dependent) × quality tier × observed latency"]
    Rank --> Rollout{"4. Active Shadow/Canary assignment\nfor this workspace? (§14.2–§14.3)"}
    Rollout -->|yes| RolloutCandidate["Route per rollout policy\n(may override the ranked choice)"]
    Rollout -->|no| TopRanked["Select top-ranked candidate"]
    RolloutCandidate --> Selected["Selected (provider, model)"]
    TopRanked --> Selected
```

**Design Decisions:** cost policy is plan-tier-aware by design (`DATABASE.md` §3's `SubscriptionPlan.featureMatrix` already anticipates per-plan capability differences) — Free/Starter workspaces default to cost-optimized model selection (smaller/cheaper models for routine `AIActionType`s), Business/Enterprise workspaces can pin a preferred quality tier or specific model (a documented Enterprise override, consistent with `AUTH_ARCHITECTURE.md` §7.3's pattern of Enterprise-tier configuration surfaces).

**Failure Handling & Recovery:** if every candidate provider is unhealthy, the request fails with a clear, credit-neutral rejection (§2.1) — there is no silent fallback to a degraded/incorrect provider; "no healthy provider" is a real outage state that must surface as one, per `BACKEND_ARCHITECTURE.md`'s fail-secure-and-bounded philosophy applied throughout this series.

**Trade-offs & Rejected Alternatives:** **rejected** — a purely static, hardcoded `AIActionType → model` mapping (no ranking, no health-awareness). This is explicitly what `BACKEND_ARCHITECTURE.md` §6.3 shipped as the *launch* `ProviderRoutingPolicy` — this document is the specified evolution of that exact policy into a health- and cost-aware ranking function, not a contradiction of it; the launch behavior is the degenerate case where only one candidate ever passes the filter.

**Future Evolution:** true multi-objective, usage-data-informed dynamic routing (learning, from Part 12's evaluation data, which model actually performs best per task type) is the natural endpoint of this design — deferred until there is production evaluation data to route on (YAGNI, consistent with `BACKEND_ARCHITECTURE.md` §6.3's identical stated reasoning).

### 2.6 AI Router & AI Request/Response Lifecycle

**Purpose & Responsibilities:** the AI Router is **not** the Provider Router (§2.5) — it is a distinct, earlier decision: given a normalized request, which *internal execution path* handles it — a single synchronous/streamed generation (the common case, most of `API_CONTRACT.md` §5.10's traffic), a RAG-augmented generation (Part 7 engages), or a full Agent Runtime invocation (Part 9 engages, for multi-step/tool-using tasks). This routing decision is driven by `AIActionType` (a strong prior — `AUTOMATION_RUN` and Agent-triggered actions route agentic by construction) refined by a lightweight `TaskComplexityClassifier` for ambiguous cases (heuristics on input structure/length; a full ML classifier is explicitly deferred, YAGNI, until routing accuracy data justifies it).

**AI Request Lifecycle (master sequence, subsuming and extending `BACKEND_ARCHITECTURE.md` §2.3 and §6.4):**

```mermaid
sequenceDiagram
    participant Entry as Entry Point (§1.2)
    participant GW as AI Gateway (§2.1)
    participant Router as AI Router
    participant Mem as Memory Retrieval (Part 6)
    participant RAG as Knowledge Retrieval (Part 7)
    participant CB as Context Builder (Part 4)
    participant PC as Prompt Compiler (Part 3)
    participant PA as Provider Abstraction (§2.3)
    participant Agent as Agent Runtime (Part 9, if selected)
    participant Post as Post-Processing (§12.9, §6.12, §11.2)

    Entry->>GW: request
    GW->>GW: normalize, credit-reserve, moderate input
    GW->>Router: route(request)
    Router->>Mem: retrieve relevant memory
    Router->>RAG: retrieve relevant knowledge (if applicable)
    Mem-->>CB: memory context
    RAG-->>CB: retrieved documents
    CB->>CB: rank, compress, fit to window (Part 4)
    CB->>PC: assembled context
    PC->>PC: compile final prompt (Part 3)
    alt simple/RAG path
        PC->>PA: generate(prompt)
        PA-->>Post: provider response (sync or streamed)
    else agentic path
        PC->>Agent: goal + context
        Agent->>PA: (possibly many) generate() calls, tool calls (Part 9)
        Agent-->>Post: final result
    end
    Post->>Post: validate output, safety post-check,\nconsolidate memory, reconcile credits
    Post-->>Entry: AI Response Lifecycle complete
```

**AI Response Lifecycle (§ detail):** the reverse path is not a passive return — it is an active pipeline: raw provider output → Output Validation (§12.9, schema/groundedness checks) → Safety post-check (§13.1) → Mapper to the existing response DTO shape (`BACKEND_ARCHITECTURE.md` §5.2, unchanged) → Memory Consolidation trigger (§6.12, async, never blocking the response) → Credit reconciliation (`CreditLedgerService.reconcile()`, `BACKEND_ARCHITECTURE.md` §6.5, unchanged) → delivery (SSE stream frames or the single JSON envelope, `API_CONTRACT.md` §5.10, unchanged).

**Trade-offs & Rejected Alternatives:** **rejected** — always routing through the full Agent Runtime "just in case," even for simple single-turn requests. Rejected on both latency and cost grounds — the Agent Runtime's Plan→Execute→Critique→Reflect loop (Part 9) is strictly more expensive than a single generation call, and routing every request through it would make the common case pay for capability it never uses; the Router's classification step exists specifically to keep the two paths' costs proportional to their actual complexity.

---

## Part 3 — Prompt Engineering System

*(Subsystems 12–20: Prompt Compiler, Versioning, Registry, Library, Optimizer, Validation, Injection Defense, Cache, Analytics.)*

A necessary disambiguation, stated once here and relied on throughout: **the Prompt Library** (`DATABASE.md` §4's `Prompt`/`PromptVersion`, exposed via `API_CONTRACT.md` §5.8) is the *customer-facing* saved-prompt feature. **The Prompt Compiler** (this section) is the *internal* pipeline that turns a compile-time input — which may or may not reference a Prompt Library entry — into the literal text sent to a provider. `BACKEND_ARCHITECTURE.md` §6.2 named this internal system the "Prompt Engine"; this Part is that engine's full production specification. **Prompt Registry** = the versioned catalog of *system-authored* prompt templates (onboarding flows, agent planning prompts, safety-check prompts) that ship with the platform itself, as distinct from user-authored Prompt Library entries — both are compiled through the same Compiler.

### 3.1 Prompt Compiler

**Purpose & Responsibilities:** deterministic assembly of the final prompt from: a template (from the Prompt Registry or the user's Prompt Library, `DATABASE.md` §4's `{{variable}}` token pattern, reused unchanged), the resolved variables (`BusinessProfile` fields, per-request input, memory/RAG context from Parts 6–7 via the Context Builder), and a structural envelope appropriate to the target provider/model's expected format (from the Capability Matrix, §2.4) — e.g., whether the provider expects a single string, a structured messages array, or a specific system/user/tool role separation.

**Architecture:**

```mermaid
flowchart LR
    Template["Template (Registry or Prompt Library,\nDATABASE.md §4 {{variable}} tokens)"] --> Resolve["Resolve variables:\nBusinessProfile, request input,\nassembled context (Part 4)"]
    Resolve --> Guard["Injection Defense pass (§3.7)"]
    Guard --> Envelope["Structure per target provider's\nexpected format (Capability Matrix, §2.4)"]
    Envelope --> Cache{"Cache hit?\n(§3.8, identical template+variables)"}
    Cache -->|yes| Return["Return compiled prompt (skip recompilation)"]
    Cache -->|no| Compile["Compile + cache"]
    Compile --> Return
```

**Security & Privacy:** the Compiler is the single point where user-supplied content is combined with system instructions — it is therefore also the enforcement point for Injection Defense (§3.7), not an optional add-on layered elsewhere; every compiled prompt structurally delimits "trusted" (BizPilot-authored template/instructions) from "untrusted" (user input, retrieved document content, memory content) segments, consistent with the provider-format envelope step above.

**Trade-offs & Rejected Alternatives:** **rejected** — free-form string concatenation per `AIActionType` handler (each generation Use Case builds its own prompt string ad hoc). Rejected for the same reason `BACKEND_ARCHITECTURE.md` §6.2 rejected it: no single, auditable place to review "what exactly are we sending to the provider," and no shared enforcement point for injection defense.

**Future Evolution:** the Optimizer (§3.5) operates on Compiler output/input pairs recorded via Analytics (§3.9) — the Compiler's job is intentionally narrow (deterministic assembly) so that optimization stays a separate, evaluable concern rather than baked into assembly logic itself.

### 3.2 Prompt Versioning

**Purpose & Responsibilities:** for the customer-facing Prompt Library, this is **already fully specified and not redesigned** — `DATABASE.md` §4's `Prompt`/`PromptVersion` split, with `API_CONTRACT.md` §5.8's "editing is creating a new version" rule. This document adds only the system-side counterpart: **Registry prompts are versioned identically** (the same immutable-version, one-current-pointer pattern, `DATABASE.md` §4's aggregate pattern reused, per `BACKEND_ARCHITECTURE.md` §4.3's `Prompt` aggregate), so a system prompt change (e.g., tuning the Agent Planner's instructions) is itself a reviewable, rollback-able version, not an in-place edit to a running system.

**Trade-offs & Rejected Alternatives:** **rejected** — treating Registry prompts as plain configuration files with no version history. Rejected because system prompts are exactly the kind of change that needs Shadow/Canary evaluation (Part 14) before full rollout — that requires addressable, comparable versions, which unversioned config cannot provide.

### 3.3 Prompt Registry

**Purpose & Responsibilities:** the catalog of system-authored prompt templates — onboarding assembly prompts, the Agent Planner/Critic prompts (Part 9), the safety/moderation-adjacent prompts (Part 13), the Memory Consolidation extraction prompt (§6.12). Distinguished from the Prompt Library (customer-facing) by authorship and visibility (Registry entries are never workspace-editable), but sharing the exact same `Prompt`/`PromptVersion` data shape and Compiler pipeline.

**Architecture:** Registry entries are seeded/updated via the same migration/seed discipline `BACKEND_ARCHITECTURE.md` §14 established for the `Permission` catalog — code-reviewed, deployed, never edited live through the API.

### 3.4 Prompt Library (Customer-Facing)

Fully specified in `DATABASE.md` §4 and `API_CONTRACT.md` §5.8 — **cited, not redesigned.** This document's only addition: Prompt Library entries flow through the same Compiler (§3.1) and are eligible inputs to the Optimizer (§3.5) and Analytics (§3.9) below, meaning a workspace's saved prompts benefit from the same quality tooling system prompts do.

### 3.5 Prompt Optimizer

**Purpose & Responsibilities:** an offline (not request-path) capability that proposes improved prompt variants based on accumulated Analytics (§3.9) and Evaluation data (Part 12) — e.g., flagging a Prompt Library entry with a persistently low implicit-feedback score (§12.8) and suggesting a revised phrasing, or A/B testing (§14.4) two Registry prompt candidates.

**Architecture:** runs as a scheduled background job (`BACKEND_ARCHITECTURE.md` §8, Phase 2 queue), never on the request path — optimization suggestions are surfaced (to BizPilot's internal team for Registry prompts; optionally to workspace admins as a suggestion, never an automatic overwrite, for Prompt Library entries) rather than auto-applied, preserving the versioning discipline of §3.2 (a suggestion becomes a new, reviewed version, never a silent mutation).

**Trade-offs & Rejected Alternatives:** **rejected** — fully automated prompt self-modification (the system rewrites its own prompts without human review). Rejected as a Zero-Trust/Fail-Secure violation at the content-generation level — an automatically-mutating prompt is exactly the kind of undocumented, hard-to-audit change this entire document series has consistently rejected in every other subsystem (custom roles, RBAC, migrations); optimization proposes, versioning + review disposes.

**Future Evolution:** as Evaluation data (Part 12) matures, the Optimizer is the natural consumer of it for automated *candidate generation* (still human-gated for promotion) — an explicit, bounded research direction, not a near-term commitment.

### 3.6 Prompt Validation

**Purpose & Responsibilities:** structural validation of a template *before* it is saved to the Registry or Prompt Library — token syntax correctness (`{{variable}}` well-formedness, all referenced variables resolvable from the declared `targetFeature`'s available context, per `DATABASE.md` §4's `variableSchema` pattern already specified for Templates and reused here for Prompts), and a length/complexity sanity check against the target model's context window (Capability Matrix, §2.4) to fail fast on an unusable template at authoring time rather than at every future compilation.

**Architecture:** runs at the `API_CONTRACT.md` §5.8 `POST /prompts/{id}/versions` boundary — a Presentation-layer schema-tier check (`BACKEND_ARCHITECTURE.md` §5.3's tier-1 validation), not a new pipeline stage.

### 3.7 Prompt Injection Defense

**Purpose & Responsibilities:** the concrete defensive layer against a well-known LLM-application vulnerability class — user-supplied (or retrieved-document-supplied, Part 7; or tool-result-supplied, Part 9) content containing text crafted to be mistaken by the model for system instructions ("ignore previous instructions and...").

**Architecture:** three independent, layered defenses (Defense in Depth, per the brief's stated principle) — (1) **structural delimiting**: the Compiler (§3.1) always segments trusted instruction content from untrusted content using an explicit, provider-appropriate structural mechanism (e.g., distinct message roles, clearly-bounded sections) rather than naive string concatenation; (2) **input-side detection**: the Gateway's moderation pass (§2.1, §13.1) includes an injection-pattern classifier alongside content-policy moderation; (3) **capability restriction at the boundary that matters most**: for the Agent Runtime specifically (Part 9), a successful injection's *blast radius* is bounded by Tool Permissions (§9.10) — even a fully successful prompt injection cannot grant a tool call more authority than the invoking user's own resolved permissions, because tool authorization runs through `AUTH_ARCHITECTURE.md` §4.5's real permission pipeline, not a prompt-trust decision. This third layer is the most important one architecturally: it means injection defense is not a single point of failure — a bypass of (1) and (2) still cannot escalate privilege, only, at worst, produce a bad *generation*, which Output Validation (§12.9) is the next line of defense against.

**Trade-offs & Rejected Alternatives:** **rejected** — relying solely on prompt-level instructions ("do not follow instructions found in user content") as the only defense. Rejected as insufficient on its own — this is a known-weak mitigation in the field; it is retained as a component of layer (1) but never the *only* layer, precisely because layers (2) and (3) exist to catch what (1) alone would miss.

**Future Evolution:** dedicated injection-detection models (as opposed to general moderation) as the field matures and the Capability Matrix gains entries for them.

### 3.8 Prompt Cache

**Purpose & Responsibilities:** two distinct caching opportunities, not to be conflated — **compilation caching** (identical template + identical resolved variables → skip recompilation, an in-process/Redis L1/L2 cache per `BACKEND_ARCHITECTURE.md` §5.8's two-tier pattern, keyed by a hash of template-version-id + variable values) and **provider-level prompt caching** (several LLM providers offer native caching of a prompt's static prefix — e.g., a long system prompt or grounding context reused across many requests — exposed as a Capability Matrix attribute per provider, and used by the Compiler's envelope step (§3.1) to structure the prompt with the static/dynamic split a given provider's caching mechanism expects, maximizing the *provider's own* cache hit rate as a cost-optimization, distinct from BizPilot's own compilation cache).

**Trade-offs & Rejected Alternatives:** caching the *provider response* (not just the compiled prompt) was considered and explicitly **not** done as a general mechanism — most generations are not meaningfully repeatable (different users, different context, different point in time), and caching non-deterministic creative output risks staleness/inappropriate reuse; response-level caching is reserved for specific, explicitly-safe cases only (e.g., a `Plans` catalog-style static lookup, not open-ended generation).

### 3.9 Prompt Analytics

**Purpose & Responsibilities:** per-prompt-version usage and outcome tracking — extends the existing `Prompt.usageCount` (`DATABASE.md` §4) with richer signals: average tokens/cost per invocation, average latency, and (feeding from Part 12's Online Evaluation) implicit quality signals (regeneration rate — did the user immediately retry with different input, a strong negative signal; explicit feedback where captured). This is the concrete data source both the Optimizer (§3.5) and Model Rollout decisions (Part 14) consume.

**Observability:** surfaced through the same `AIUsage`-derived analytics pipeline `API_CONTRACT.md` §5.10's `GET /ai/usage/summary` already specifies — extended with a `promptVersionId` breakdown dimension, not a new endpoint.

---

## Part 4 — Context Engineering

*(Subsystems 21–24: Context Builder, Context Compression, Context Ranking, Context Window Optimization.)*

### 4.1 Context Builder

**Purpose & Responsibilities:** the assembly point between *retrieval* (Memory, Part 6; Knowledge/RAG, Part 7) and *compilation* (Part 3) — collects every candidate piece of context for a request (conversation history/summary from the Conversation Engine, `BusinessProfile` grounding, retrieved memories, retrieved documents, tool-call results if mid-agent-run), and produces the bounded, ranked, compressed set that actually gets compiled into the prompt.

**Architecture:**

```mermaid
flowchart TB
    Sources["Candidate context sources:\nConversation history/summary (Part 5)\nMemory retrieval (Part 6)\nKnowledge/RAG retrieval (Part 7)\nBusinessProfile (DATABASE.md §2, always included)\nAgent working memory (Part 9, if applicable)"] --> Rank["Context Ranking (§4.3):\nscore every candidate by relevance"]
    Rank --> Budget{"Fits target model's\ncontext window? (Capability Matrix, §2.4)"}
    Budget -->|yes| Pass["Pass through unmodified"]
    Budget -->|no| Compress["Context Compression (§4.2):\nsummarize/truncate lowest-ranked first"]
    Compress --> Fit["Context Window Optimization (§4.4):\nfinal packing against the target budget"]
    Pass --> Output["Assembled context → Prompt Compiler (§3.1)"]
    Fit --> Output
```

**Design Decisions:** the Builder always operates against a **token budget derived from the selected model** (a consequence of Dynamic Model Selection, §2.5, having already run, or a conservative default budget if model selection is deferred until after context assembly — the two are sequenced so the Builder never assembles more than the eventual target can accept) rather than a fixed, provider-agnostic limit — this is what lets the same Builder serve a small-context cost-optimized model and a large-context premium model correctly, without two separate code paths.

**Trade-offs & Rejected Alternatives:** **rejected** — always sending the maximum context the model window allows ("more context is always better"). Rejected on two grounds: cost (larger context = more input tokens = more credits consumed, §11.1) and quality (well-documented "lost in the middle" degradation in long-context LLM performance means unranked, uncompressed maximal context is not even strictly better for output quality) — Ranking and Compression exist because *relevant, bounded* context outperforms *maximal, unranked* context on both axes.

### 4.2 Context Compression

**Purpose & Responsibilities:** when candidate context exceeds budget, reduce it — via the *already-specified* Conversation summarization mechanism (`BACKEND_ARCHITECTURE.md` §6.1, reused, not reimplemented) for conversation history specifically, and via a general extractive/abstractive compression step (a smaller/cheaper model summarization call, itself routed through Dynamic Model Selection, §2.5) for retrieved document/memory content that doesn't fit.

**Scalability & Performance:** compression is itself an LLM call and therefore itself consumes credits and adds latency — the Builder only invokes it when the uncompressed candidate set genuinely exceeds budget (checked cheaply via token counting first), never speculatively.

**Trade-offs & Rejected Alternatives:** **rejected** — naive truncation (simply cutting off content past a length limit) as the only compression strategy. Rejected as the general default — restated from `BACKEND_ARCHITECTURE.md` §6.1's identical, already-accepted reasoning (truncation silently loses information a summary preserves) — but **retained as a fallback**: if the compression call itself fails or times out, truncating the lowest-ranked content is the documented degraded-mode behavior (graceful degradation over hard failure), never a silent, unbounded retry loop.

### 4.3 Context Ranking

**Purpose & Responsibilities:** score every candidate context item before Compression/Window Optimization run — reuses the `RetrievalRankingService` (Part 7's shared abstraction, cited here as the same component) so that ranking logic for "which retrieved document chunk matters most" and "which piece of context matters most for this prompt" is one implementation, not two.

**Architecture:** ranking factors: semantic relevance to the current request (embedding similarity, Part 7), recency (weighted differently for episodic vs. semantic content, §6.8–§6.9), source authority (a workspace's own `BusinessProfile`/uploaded content ranks above generically-retrieved memory, by design), and — for conversation history specifically — turn recency with a summary-boundary discount (content already folded into a rolling summary is deprioritized relative to unsummarized recent turns).

### 4.4 Context Window Optimization

**Purpose & Responsibilities:** the final packing step — given the ranked, possibly-compressed candidate set and the hard token budget, select the actual final subset/ordering, respecting model-specific positional effects where known (e.g., placing the highest-relevance content near the beginning and end of the context, consistent with the "lost in the middle" consideration named in §4.1, rather than naive priority-ordered concatenation).

**Future Evolution:** as the Capability Matrix (§2.4) accumulates per-model positional-sensitivity data (from Evaluation, Part 12), Window Optimization becomes model-aware in its packing strategy, not just budget-aware — deferred until that data exists (YAGNI).

---

## Part 5 — Conversation Engine (Extension)

*(Subsystems 25–26: Conversation Engine, Conversation Lifecycle.)*

**Fully architected in `BACKEND_ARCHITECTURE.md` §6.1 — cited, not redesigned.** This Part records only what changes given everything Parts 2–4 add: the Conversation Engine's `getContextForGeneration()` (its existing public interface) is now one *input* to the Context Builder (§4.1) rather than the entire context — a conversation's history/summary is composed alongside Memory (Part 6) and Knowledge retrieval (Part 7), not compiled directly. The **Conversation Lifecycle** state machine is unchanged (create → append turns → summarize past threshold → archive); its summarization job is the same background job named in `BACKEND_ARCHITECTURE.md` §6.1 §8, now additionally recognized as one of the trigger points for Memory Consolidation (§6.12) — a conversation crossing the summarization threshold is a natural, efficient moment to also extract candidate long-term memories from the content being folded into the summary, rather than a separately-scheduled scan.

```mermaid
stateDiagram-v2
    [*] --> Active: First message
    Active --> Active: Append turn (within context budget)
    Active --> Summarizing: Token threshold crossed (BACKEND_ARCHITECTURE.md §6.1)
    Summarizing --> Active: Summary produced;\nMemory Consolidation triggered (§6.12)
    Active --> Archived: Explicit close / long inactivity
    Archived --> [*]
```

**Trade-offs & Rejected Alternatives:** **rejected** — running Memory Consolidation on a fully independent schedule, decoupled from summarization. Rejected as wasted redundant work — both processes need to read and semantically process the same aging conversation content; triggering consolidation *from* the summarization event (an existing domain event publish point, reusing the Event Bus per `BACKEND_ARCHITECTURE.md` §13.1) is strictly more efficient and keeps the two processes' view of "what's been processed" trivially consistent.

---

## Part 6 — Memory Architecture

*(Subsystems 27–39: Memory Architecture, Working Memory, Session Memory, User Memory, Workspace Memory, Business Memory, Organizational Memory, Long-Term Memory, Semantic Memory, Episodic Memory, Memory Retrieval, Memory Consolidation, Forgetting Strategy.)*

The largest genuinely new territory in this document. A critical disambiguation up front: **Memory is what the AI remembers *about* a user/business** (preferences, facts, past interactions); **Knowledge (Part 7) is content the business has explicitly given the AI to reference** (uploaded documents). They are architecturally related (both are retrieved and injected via the Context Builder, Part 4; both may share the same underlying vector-store infrastructure, §6.10) but conceptually distinct, and this document keeps them in separate Parts specifically so that distinction stays visible in the architecture, not just in prose.

### 6.1 Memory Architecture (Layer Model)

```mermaid
flowchart TB
    subgraph Ephemeral["Ephemeral — request-scoped"]
        Working["Working Memory (§6.2)\nin-process only, never persisted as 'memory'"]
    end
    subgraph Relational["Relational — existing DATABASE.md storage, cited not redesigned"]
        Session["Session Memory (§6.3) = Conversation + Message\n(DATABASE.md §4, BACKEND_ARCHITECTURE.md §6.1)"]
        Business["Business/Workspace Memory (§6.5–§6.6) = BusinessProfile + Settings\n(DATABASE.md §2)"]
    end
    subgraph NewRelational["New — future schema extension, not required today"]
        User["User Memory (§6.4)"]
    end
    subgraph VectorStore["New infrastructure — Long-Term Memory Store (§6.10)"]
        Semantic["Semantic Memory (§6.8): generalized facts"]
        Episodic["Episodic Memory (§6.9): specific remembered events"]
    end
    subgraph Deferred["Explicitly deferred"]
        Org["Organizational Memory (§6.7)"]
    end

    Working -.feeds, within one request.-> Session
    Session -->|"Memory Consolidation (§6.12)\non summarization"| VectorStore
    Business -->|always included, existing design| ContextBuilder["Context Builder (Part 4)"]
    Session --> ContextBuilder
    User -.future.-> ContextBuilder
    VectorStore -->|"Memory Retrieval (§6.11)"| ContextBuilder
```

### 6.2 Working Memory

**Purpose & Responsibilities:** the request-scoped, in-flight state during a single AI Request's processing — the assembled context, intermediate Agent Runtime reasoning/tool-call results within one turn (Part 9). Lives only in process memory for the duration of the request; never independently persisted (though Agent Runtime steps *are* logged for observability/audit, per §12.4 — a distinct concern from being "memory" in the retrieval sense).

**Architecture:** analogous to a CPU register versus RAM — the fastest, most transient tier, with zero infrastructure of its own (no new port, no new store) beyond ordinary process memory and the existing `AsyncLocalStorage`-based request context (`BACKEND_ARCHITECTURE.md` §5.6).

### 6.3 Session Memory

**Fully specified — cited, not redesigned.** = the Conversation Engine (`BACKEND_ARCHITECTURE.md` §6.1) exactly. Named here only to place it correctly within this document's unified memory taxonomy, per the brief's explicit numbered requirement.

### 6.4 User Memory

**Purpose & Responsibilities:** persistent facts/preferences about an individual human user, remembered across sessions/conversations — "this user prefers concise output," "this user is the head of marketing and asks about campaign performance most often." **(Future schema extension, not required today)** — no `DATABASE.md` model exists for this; when built, it is a lightweight, workspace-scoped, per-user structured store (key facts + confidence/recency metadata), not a free-text blob, so it composes predictably with the Context Builder's ranking (§4.3).

**Security & Privacy:** subject to the same GDPR erasure path as every other user-attributable data — `AUTH_ARCHITECTURE.md` §6.2's anonymization job is the trigger point that must, when built, also purge or anonymize this user's User Memory entries, extending that existing mechanism rather than creating a second, inconsistent deletion path (a hidden risk explicitly flagged: any future memory-store addition that *doesn't* wire into the existing anonymization job is a compliance gap by construction, not by oversight, so this document states the requirement now, ahead of the store existing).

**Future Evolution:** the concrete next design step (out of scope here) is the schema shape and the extraction mechanism (likely folded into Memory Consolidation, §6.12, tagged by scope).

### 6.5 Workspace Memory & 6.6 Business Memory

**Business Memory maps directly to the existing `BusinessProfile`** (`DATABASE.md` §2) — cited, not redesigned; this is already the AI grounding-context object every generation auto-includes. **Workspace Memory** is defined here as the *superset*: `BusinessProfile` (static, explicitly-authored facts) plus derived/learned operational patterns accumulated over time (which `AIActionType`s this workspace uses most, typical tone/style patterns observed across its content, per the Brand Voice Trainer concept `DATABASE.md` already anticipated for `BusinessProfile`) — the learned half is Long-Term Memory content (§6.8) *scoped* to the workspace, not a separate storage mechanism; "Workspace Memory" is therefore a **retrieval scope**, not a new store, composed from `BusinessProfile` (relational, always included) plus workspace-scoped Long-Term Memory (retrieved, ranked, §6.11).

### 6.7 Organizational Memory

**Purpose & Responsibilities:** for agency/multi-workspace users (`PRD.md`'s Agency Alex persona) — learned patterns/preferences useful *across* an agency's client workspaces. **Explicitly deferred**, and deferred with the identical caution `API_CONTRACT.md` §5.17 already stated for cross-workspace search: any cross-workspace capability must be an *explicit, permissioned aggregation*, never an implicit widening of per-workspace retrieval — `DATABASE.md` §3.1's strict workspace-isolation boundary is not softened by this document. If built, Organizational Memory is a distinct, opt-in retrieval scope requiring its own explicit authorization check, not an automatic default.

### 6.8 Semantic Memory & 6.9 Episodic Memory

**Purpose & Responsibilities:** two *content types* within Long-Term Memory (§6.10), not two storage systems. **Semantic** = generalized, recency-agnostic facts/knowledge ("this business sells B2B project-management software to mid-market teams"). **Episodic** = specific, time-anchored remembered events/interactions ("on 2026-03-03, the user asked about competitor pricing and the AI recommended a 15% discount tier"). Distinguished by a `memoryType` tag on each stored vector, retrieved with different ranking weightings (§4.3): Semantic favors pure relevance regardless of age; Episodic favors relevance *combined with* recency decay (an older episodic memory is less likely to still be actionable than an older semantic fact).

### 6.10 Long-Term Memory Store — New Infrastructure

**Purpose & Responsibilities:** the durable, similarity-searchable store holding consolidated Semantic and Episodic memories, populated by Memory Consolidation (§6.12) and read by Memory Retrieval (§6.11). This is the first genuinely new piece of infrastructure this document introduces beyond what `DATABASE.md` specified.

**Architecture — the store choice (ADR-AI-003, Part 16):** **`pgvector`** (a PostgreSQL extension) as the launch implementation, behind a `VectorStorePort` (the same hexagonal-adapter pattern used throughout this series). This deliberately reuses `BACKEND_ARCHITECTURE.md` ADR-003's exact reasoning (Postgres full-text search before a dedicated search engine) applied to a structurally identical decision: zero new infrastructure to operate at launch, transactional co-location with the relational data a memory is associated with (a memory's workspace/user scoping can be enforced by the *same* row-level authorization joins the rest of the platform already uses, rather than a second, separately-secured system), and a documented, low-friction swap path to a dedicated vector database (Pinecone/Qdrant/Weaviate) once per-workspace vector volume or the need for more advanced ANN indexing algorithms exceeds `pgvector`'s comfortable ceiling.

**Security & Privacy:** every stored vector carries `workspaceId` and (for User Memory-scoped entries) `userId` — retrieval queries (§6.11) filter by these at the database level, the same pattern `API_CONTRACT.md` §5.17 established for federated search's filter-at-query-time requirement, applied here to memory retrieval for the identical reason (never a post-hoc filter over an unrestricted result set).

**Failure Handling & Recovery:** Long-Term Memory is explicitly an **enhancement, never a dependency for correctness** — if the vector store is unavailable, generation proceeds without it (Session Memory and Business Memory, both relationally-backed and always available, still ground every response) — a graceful-degradation guarantee stated explicitly because it is what makes this new infrastructure's introduction low-risk to the platform's existing reliability posture.

**Trade-offs & Rejected Alternatives:** **rejected** — a dedicated vector database from day one. Rejected per ADR-AI-003's reasoning above; **rejected** — no Long-Term Memory at all, relying solely on Session + Business Memory. Rejected as insufficient for the product's stated ambition (`AI Memory`, `AI Employees` that "remember context" over time per the brief's own framing) — a Copilot that forgets everything outside the current conversation and the static BusinessProfile cannot deliver on that promise.

### 6.11 Memory Retrieval

**Purpose & Responsibilities:** the `MemoryRetrievalService` composing everything above into what the Context Builder (§4.1) receives — always includes Session Memory (current conversation) and Business Memory (`BusinessProfile`, unconditional, per existing design); conditionally includes Long-Term Memory (vector similarity search, scoped to workspace and, where relevant, user, gated by a minimum relevance threshold so irrelevant memories never dilute context) and (future) User Memory.

```mermaid
sequenceDiagram
    participant CB as Context Builder
    participant MR as MemoryRetrievalService
    participant Conv as Conversation Engine (Part 5)
    participant Rel as tenancy (BusinessProfile, via public interface)
    participant VS as Long-Term Memory Store (§6.10)

    CB->>MR: retrieve(workspaceId, userId, conversationId, queryContext)
    MR->>Conv: getContextForGeneration()
    MR->>Rel: get default BusinessProfile
    MR->>VS: similarity search (workspace+user scoped, threshold-gated)
    VS-->>MR: ranked candidate memories (or empty, if unavailable — degraded, not failed)
    MR-->>CB: composed memory context
```

**Scalability & Performance:** the vector-store query is the one step here with nontrivial latency at scale — bounded by a strict timeout (consistent with `BACKEND_ARCHITECTURE.md` §9.2's tiered-timeout policy) with "no memory retrieved" as the timeout's degraded outcome, never a blocked request.

### 6.12 Memory Consolidation

**Purpose & Responsibilities:** the background process (Worker-process job, `BACKEND_ARCHITECTURE.md` §8) that extracts candidate long-term memories from Session Memory activity and writes them to the Long-Term Memory Store — triggered by Conversation summarization (§ Part 5's stated integration) and, for Workspace Memory's learned-pattern component (§6.5), by periodic aggregate analysis of workspace activity.

**Architecture:** extraction uses an LLM call (a Registry prompt, §3.3, specifically tuned for "extract durable, reusable facts from this conversation excerpt, tagged Semantic or Episodic") — itself routed through the same Provider Abstraction/Dynamic Model Selection (§2.3, §2.5), typically to a cost-optimized model since extraction quality requirements are lower than user-facing generation. Extracted candidates are **deduplicated/merged** against existing memories (embedding-similarity-based near-duplicate detection) before storage — a deliberate bound against unbounded memory growth (a real, named operational risk: without deduplication, Long-Term Memory would grow linearly and unboundedly with conversation volume, degrading both storage cost and retrieval relevance over time).

**Security & Privacy:** the extraction prompt explicitly instructs against extracting unnecessary PII (extending `AUTH_ARCHITECTURE.md`/`DATABASE.md`'s data-minimization principle into the AI-generated-content path itself), reinforced by the PII Protection layer (§13.3) run over extraction output before storage — belt-and-suspenders, consistent with this series' consistent Defense-in-Depth application.

**Trade-offs & Rejected Alternatives:** **rejected** — consolidating on every single message (rather than at summarization-threshold boundaries). Rejected as wasted cost for the overwhelming majority of conversational turns that contain nothing worth remembering long-term — restating, at the memory layer, the exact "don't do expensive work on every turn, only past a meaningful threshold" reasoning `BACKEND_ARCHITECTURE.md` §6.1 already established for summarization itself.

### 6.13 Forgetting Strategy

**Purpose & Responsibilities:** memory correctness over time is not just about writing — it's about *not* retaining what's no longer useful or no longer lawful to retain. Two independent mechanisms, deliberately not conflated: (1) **relevance decay** (a soft mechanism — older, rarely-retrieved memories accumulate a declining relevance score over time via a scheduled scoring job, naturally sinking below Memory Retrieval's threshold rather than being deleted outright — preserving them for the rare case they become relevant again, e.g., a seasonal business pattern); (2) **compliance-driven deletion** (a hard mechanism — explicitly triggered, never time-decayed): when a `User` is anonymized (`AUTH_ARCHITECTURE.md` §6.2's existing GDPR job) or a `Workspace` is hard-deleted, every associated Long-Term Memory entry is purged as part of that same, existing process, extended to cover this new store rather than left as a gap.

**Trade-offs & Rejected Alternatives:** **rejected** — pure TTL-based expiration for all Long-Term Memory (delete everything after N days regardless of relevance). Rejected as too blunt — a durable fact about a business ("we operate in the healthcare vertical") shouldn't expire on a fixed clock the way a specific stale episodic detail reasonably might; relevance-decay's continuous, retrieval-informed model handles both cases correctly without needing separate TTL configuration per memory type.

---

## Part 7 — RAG & Knowledge Architecture

*(Subsystems 40–48: RAG Architecture, Knowledge Pipeline, Document Pipeline, Embedding Strategy, Chunking Strategy, Semantic Search, Hybrid Search, Vector Database Abstraction, Retrieval Ranking.)*

### 7.1 RAG Architecture (Overview)

**Purpose & Responsibilities:** let AI responses ground themselves in content the business has explicitly provided (`File`s, `DATABASE.md` §5) — distinct from Memory (Part 6, which is about the AI's learned understanding *of* the user/business, not content the business handed it).

```mermaid
flowchart LR
    subgraph Ingestion["Knowledge Pipeline (§7.2)"]
        Upload["File uploaded (content module,\nBACKEND_ARCHITECTURE.md §12)"]
        Extract["Multi-modal extraction (Part 8)"]
        Chunk["Chunking (§7.4)"]
        Embed["Embedding (§7.3)"]
        Index["Index in Vector Store (§7.7, shared with §6.10)"]
    end
    subgraph Retrieval["Retrieval (request-time)"]
        Query["Incoming request context"]
        Semantic["Semantic Search (§7.5)"]
        Hybrid["Hybrid Search (§7.6, fuses with\nexisting Postgres FTS, BACKEND_ARCHITECTURE.md §7.4"]
        Rank["Retrieval Ranking (§7.8, shared with §4.3"]
    end

    Upload --> Extract --> Chunk --> Embed --> Index
    Query --> Semantic --> Rank
    Query --> Hybrid --> Rank
    Index -.-> Semantic
    Index -.-> Hybrid
    Rank --> ContextBuilder["Context Builder (Part 4)"]
```

**Trade-offs & Rejected Alternatives:** **rejected** — fine-tuning a model per workspace on its own content instead of RAG. Rejected as the general mechanism — per-workspace fine-tuning at BizPilot AI's multi-tenant scale is operationally expensive (one fine-tuned model artifact per tenant) and slower to update (a new document requires re-training rather than an incremental index write) — RAG's incremental-index nature matches the product's actual need (content changes constantly, files are added/removed routinely) far better; fine-tuning is retained as a distinct, future, opt-in capability (Part 15) for a different problem (adapting model *behavior/style*, not injecting *facts*).

### 7.2 Knowledge Pipeline & Document Pipeline

**Purpose & Responsibilities:** the ingestion half of §7.1 — extends `BACKEND_ARCHITECTURE.md` §12.1's existing `File` processing pipeline (`UPLOADING → PROCESSING → READY`) with a new processing branch specifically for AI-consumability, running in the same Worker process, triggered by the same `FileProcessing` job.

```mermaid
sequenceDiagram
    participant File as File (existing pipeline, BACKEND_ARCHITECTURE.md §12.1)
    participant Extract as Content Extraction (Part 8)
    participant Chunk as Chunker (§7.4)
    participant Embed as EmbeddingProviderPort (§2.3)
    participant VS as Vector Store (§7.7)

    File->>Extract: File.status = PROCESSING (existing trigger)
    Extract->>Extract: dispatch by FileKind (existing enum) to the\nappropriate extractor (Part 8)
    Extract->>Chunk: extracted text/structured content
    Chunk->>Chunk: structure-aware chunking (§7.4)
    Chunk->>Embed: chunk batch
    Embed-->>Chunk: embeddings (tagged with embedding-model version, §7.3)
    Chunk->>VS: index chunks + embeddings + File/workspace scoping
    VS-->>File: (via repository) File.status = READY (existing transition, now also\nmeans "AI-searchable", not just "thumbnail generated")
```

**Design Decisions:** knowledge indexing is additive to, not a replacement for, `BACKEND_ARCHITECTURE.md` §12.2's existing image-processing branch (thumbnail/dimension/dominant-color extraction) — a `File` goes through both branches in the same `PROCESSING` stage where applicable (an uploaded image gets both a thumbnail *and* a vision-model-derived text description indexed for search, Part 8).

**Failure Handling & Recovery:** an indexing failure does **not** block the file from being marked `READY` for ordinary use (download, display) — knowledge-indexing is tracked as a separate, sub-status concern (conceptually, an `indexedAt` marker, not a blocking gate on `File.status`) with its own retry policy (`BACKEND_ARCHITECTURE.md` §8.3), so a transient embedding-provider outage degrades AI-searchability of one file temporarily, never the file's basic availability.

### 7.3 Embedding Strategy

**Purpose & Responsibilities:** convert extracted text/content chunks into vector representations via `EmbeddingProviderPort` (§2.3).

**Architecture — the versioned-embedding-space design (a named, important risk mitigation):** every stored vector is tagged with the `(embeddingProvider, embeddingModel, version)` that produced it. This matters because embeddings from different models are **not comparable** — a similarity search must only compare vectors produced by the same embedding space. Changing the platform's default embedding model therefore does not require an all-at-once, blocking re-embedding of the entire corpus: old and new embedding spaces coexist, retrieval queries are embedded with (and compared against) the *current* model's space by default, and a background backfill job gradually re-embeds older content — a gradual migration path, not a cutover, for what would otherwise be a very disruptive change.

**Trade-offs & Rejected Alternatives:** **rejected** — assuming embedding-model stability and not tagging vectors with their producing model/version. Rejected as a latent, easy-to-miss production risk (identified here explicitly per the brief's "identify hidden risks" instruction) — an untagged corpus makes any future embedding-model upgrade require a disruptive full re-index with a correctness-critical cutover moment; the small, cheap cost of tagging every vector at write time buys a materially safer migration path later.

### 7.4 Chunking Strategy

**Purpose & Responsibilities:** split extracted content into embedding-sized units before indexing — **structure-aware, not fixed-size-naive**: respecting document structure (headings, paragraphs, table boundaries) where the extractor (Part 8) preserves it, with overlap between adjacent chunks to preserve context continuity at chunk boundaries, and target chunk size tuned to the active embedding model's effective input range (Capability Matrix, §2.4).

**Design Decisions — modality-specific chunking, a deliberate divergence worth stating explicitly:** prose documents chunk by structural unit (paragraph/section); **spreadsheets chunk by logical table region, never by naive text-length splitting** (Part 8.5) — a fixed-size chunker applied to tabular data would sever rows from their headers and destroy the very structure that makes the data meaningful, a real and easy-to-overlook failure mode this document flags explicitly rather than leaving implicit.

**Future Evolution:** chunk size/overlap are tunable, evaluated parameters (Part 12's Offline Evaluation is the mechanism for tuning them against retrieval-quality benchmarks, not a one-time hardcoded guess).

### 7.5 Semantic Search & 7.6 Hybrid Search

**Purpose & Responsibilities:** Semantic Search = pure vector-similarity retrieval against the Vector Store (§7.7). **Hybrid Search explicitly reuses the existing Search Engine** (`BACKEND_ARCHITECTURE.md` §7.4's Postgres full-text `SearchPort`/`PostgresFullTextSearchAdapter`, ADR-003) for its keyword half, fused with vector-similarity results via reciprocal-rank fusion (or an equivalent rank-combination method) — a deliberate reuse, not a parallel keyword-search implementation, extending an already-justified architectural decision rather than duplicating it.

**Trade-offs & Rejected Alternatives:** **rejected** — semantic-search-only (no keyword component). Rejected because pure vector similarity is known to under-perform on exact-match needs (a specific product code, a precise proper noun) that keyword search handles trivially — Hybrid Search's fusion is standard, well-justified practice specifically because the two methods' failure modes are complementary.

### 7.7 Vector Database Abstraction

**Fully specified in §6.10** (`VectorStorePort`, `pgvector` launch adapter, ADR-AI-003) — the identical store and port serve both Long-Term Memory (Part 6) and Knowledge/RAG (this Part), distinguished at the data level by a `sourceType` tag (`memory` vs. `knowledge`) and scoped identically (workspace, optionally user/file). **Trade-offs & Rejected Alternatives:** **rejected** — two separate vector stores, one for memory and one for knowledge. Rejected as needless operational duplication — both have identical scalability, security, and infrastructure requirements; the `sourceType` tag achieves the necessary logical separation (different retrieval defaults, different consolidation/ingestion triggers) without paying for two systems.

### 7.8 Retrieval Ranking

**Fully specified in §4.3** as a shared abstraction (`RetrievalRankingService`) used identically by Context Ranking (Part 4) and Knowledge retrieval (this Part) — restated here only to satisfy the brief's explicit numbering; no new design content beyond what §4.3 already specifies. The one RAG-specific ranking factor: **source authority weighting** — a workspace's own explicitly-uploaded `File` content ranks above any other retrieved source by design (it is the most authoritative, most intentionally-provided context available), a rule the Ranking service applies as a fixed, high-weight factor distinguishing RAG results from Memory results in the combined, ranked context set the Context Builder ultimately receives.

---

## Part 8 — Multi-Modal Understanding

*(Subsystems 49–55: File Understanding, Image Understanding, OCR Strategy, PDF Processing, Spreadsheet Understanding, Audio Understanding, Future Video Pipeline.)*

### 8.1 File Understanding (Orchestrating Umbrella)

**Purpose & Responsibilities:** dispatch extraction to the correct modality-specific extractor based on the existing `FileKind` enum (`DATABASE.md` §5) — the single entry point the Knowledge Pipeline (§7.2) and any direct "understand this file" AI capability both call.

```mermaid
flowchart TD
    F["File (FileKind, DATABASE.md §5, existing enum)"] --> Dispatch{"Dispatch by kind"}
    Dispatch -->|DOCUMENT, PDF| PDF["PDF Processing (§8.4)"]
    Dispatch -->|IMAGE| Img["Image Understanding (§8.2)"]
    Dispatch -->|"DOCUMENT, spreadsheet MIME type"| Sheet["Spreadsheet Understanding (§8.5)"]
    Dispatch -->|AUDIO| Audio["Audio Understanding (§8.6)"]
    Dispatch -->|VIDEO| Video["Future Video Pipeline (§8.7, deferred)"]
    PDF --> Extractor["Common ContentExtractorPort output:\nplain text + structural metadata"]
    Img --> Extractor
    Sheet --> Extractor
    Audio --> Extractor
    Extractor --> Downstream["→ Chunking (§7.4) or\ndirect Context Builder input"]
```

**Architecture:** every modality-specific extractor implements a common `ContentExtractorPort` (§2.3-style hexagonal pattern), producing a normalized output (text + structural metadata) regardless of source modality — this is what lets Chunking (§7.4) and the Context Builder (Part 4) remain modality-agnostic downstream of extraction.

**Scalability & Performance:** all extraction runs in the Worker process (`BACKEND_ARCHITECTURE.md` §12.1's existing rule, extended here to cover AI-specific extraction, not just thumbnailing) — never the API process, keeping large/slow multi-modal processing off the request-serving path entirely.

### 8.2 Image Understanding

**Purpose & Responsibilities:** produce a text description/analysis of image content, both for indexing (Knowledge Pipeline) and as a direct product capability ("AI Image Understanding" per the brief's named list — e.g., a user asks the Copilot about an uploaded product photo).

**Architecture:** routed through the **same Provider Abstraction Layer** (§2.3) as text generation — modern multimodal LLMs accept image input natively, so this is a Dynamic Model Selection concern (does the selected model support vision input? Capability Matrix, §2.4) rather than a separate integration; a dedicated vision-specific provider is an alternative adapter behind the same `AIProviderPort`, selected when cost/quality trade-offs favor it.

### 8.3 OCR Strategy

**Purpose & Responsibilities:** extract text from scanned/image-embedded text content (a scanned contract, a photographed whiteboard) — a specialized extraction step feeding the same normalized pipeline (§8.1).

**Trade-offs & Rejected Alternatives:** dedicated OCR engine vs. vision-LLM-based extraction — both are viable, and this document deliberately does **not** pick one, instead specifying it as a Capability-Matrix-driven cost/quality choice (a dedicated OCR engine is typically cheaper and faster for pure text extraction; a vision-LLM call is more robust to unusual layouts/handwriting) — the `ContentExtractorPort`'s OCR implementation is free to be either, or to try the cheaper option first and fall back, without changing any caller.

### 8.4 PDF Processing

**Purpose & Responsibilities:** structure-aware extraction of text, layout, and embedded images from PDFs — reusing Image Understanding (§8.2) for embedded images and OCR (§8.3) for scanned/image-only pages within the same document, composed into one normalized extraction output per file.

### 8.5 Spreadsheet Understanding

**Purpose & Responsibilities:** structure-**preserving** extraction of tabular data — explicitly **not** a naive text dump, which would destroy row/column/header semantics and make the extracted content nearly useless for accurate downstream reasoning (a concrete, named failure mode this document guards against by design, referenced already in §7.4's chunking discussion). Extraction preserves table structure (headers, row/column relationships) in the normalized output's structural metadata, and Chunking (§7.4) respects logical table regions rather than fixed-size text splitting.

### 8.6 Audio Understanding

**Purpose & Responsibilities:** transcription (speech-to-text) as the extraction step; transcribed content is thereafter treated as ordinary text by every downstream stage (Chunking, Context Builder, Conversation Engine). Directly reuses the existing `DATABASE.md` §4 `AIActionType.CALL_SUMMARY` product capability — this extraction pipeline is what makes that action type's input tractable.

### 8.7 Future Video Pipeline

**Purpose & Responsibilities (deferred):** frame sampling + audio-track transcription (reusing §8.6) + (further future) scene/object understanding via vision models (reusing §8.2, applied per sampled frame). Explicitly deferred, tied to `FileKind.VIDEO`'s already-reserved `DATABASE.md` enum value and `BACKEND_ARCHITECTURE.md` §12.2's identical forward note — this document adds the concrete decomposition (sampling + per-frame vision + audio transcription, all reusing already-specified components) so that when video support is prioritized, it is additive engineering against existing primitives, not a new integration from scratch.

---

## Part 9 — Agentic System

*(Subsystems 56–69: AI Agent Runtime, Multi-Agent System, Agent Registry, Agent Communication, Planner, Executor, Critic, Reflection Loop, Self Evaluation, Tool Calling, Tool Registry, Tool Permissions, Tool Security, Tool Sandboxing.)*

The architectural home of "AI Employees," "AI Teams," and "AI Agents" (the brief's named product capabilities). The single most important design thread running through this Part: **an agent is never a new authority — it is a new *actor* operating with the authority of the human (or system) that invoked it.** Every mechanism below exists to make that guarantee structural, not just documented.

### 9.1 AI Agent Runtime

**Purpose & Responsibilities:** the execution engine for multi-step, tool-using, potentially long-running AI tasks — engaged only when the AI Router (§2.6) classifies a request as agentic (as opposed to a single-turn generation). Owns the Plan→Execute→Critique→Reflect loop (§9.6) and enforces the run's resource budget (§9.9, §11.4).

**Architecture (state diagram):**

```mermaid
stateDiagram-v2
    [*] --> Planning: Agent Runtime invoked (Router decision, §2.6)
    Planning --> Executing: Plan produced (Planner, §9.5)
    Executing --> Critiquing: Step(s) complete (Executor, §9.6)
    Critiquing --> Reflecting: Critic flags deficiency (§9.7)
    Critiquing --> Completing: Critic approves
    Reflecting --> Planning: Revised plan requested\n(bounded iteration count, §9.8)
    Reflecting --> Completing: Iteration/budget cap reached\n(best-effort result returned, flagged)
    Completing --> [*]: Result → Post-Processing (§2.6)
```

**Scalability & Performance:** runs in the **Worker process**, not the API process (`BACKEND_ARCHITECTURE.md` §8/§13.2) — a multi-minute agent run must never be held open on a request-serving instance; the initiating API request either returns immediately with a run identifier (polled or subscribed to via the existing Notification mechanism, `BACKEND_ARCHITECTURE.md` §7.2) or, for interactive/shorter agent tasks, streams intermediate progress via an extended SSE event vocabulary (§9.13).

**Failure Handling & Recovery:** every agent run has a hard wall-clock timeout and a hard credit budget (§9.9, §11.4), checked before each loop iteration — an agent that would exceed either is terminated with a partial/best-effort result and a clear status, never allowed to run unbounded (Fail Fast applied to autonomous execution specifically, where the consequence of *not* bounding it is unbounded cost, not just a slow response).

**Trade-offs & Rejected Alternatives:** **rejected** — unbounded agent autonomy (no iteration cap, no budget cap, "let it run until it decides it's done"). Rejected outright as incompatible with Cost-Aware and Fail-Secure, two of the brief's own stated governing principles — an autonomous system without a hard resource ceiling is a production incident waiting to happen, regardless of how good its own self-termination judgment is claimed to be.

### 9.2 Agent Registry

**Purpose & Responsibilities:** the catalog of available agent personas ("AI Employees" — a Marketing Agent, a Data Analyst Agent, a Support Agent) — each entry a **manifest**: declared Tool access (§9.11), declared Permission requirements (reusing `AUTH_ARCHITECTURE.md` §4.4's atomic catalog, §9.10), a Registry prompt defining its persona/instructions (§3.3), and applicable model-routing hints (Capability Matrix, §2.4).

**Architecture:** structurally parallel to `BACKEND_ARCHITECTURE.md` §7.9's Plugin Registry — a deliberate reuse of that exact shape, since "an agent has a declared, least-privilege capability manifest granted at install/enable time" is the identical problem the Plugin Engine already solved for third-party extensions. An agent is, architecturally, a first-party (or future third-party, via the Plugin Engine, §9.14) manifest-declared actor.

### 9.3 Multi-Agent System & Agent Communication

**Purpose & Responsibilities:** coordination when a task benefits from multiple specialized agent personas (e.g., a Data Analyst Agent producing figures a Marketing Agent then drafts copy around).

**Architecture:**

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator as Orchestrating Agent Run
    participant Bus as Event Bus (BACKEND_ARCHITECTURE.md §13.1, reused)
    participant AgentA as Agent A Runtime instance
    participant AgentB as Agent B Runtime instance

    User->>Orchestrator: goal
    Orchestrator->>Orchestrator: Planner decomposes into\nsub-goals per specialized agent
    Orchestrator->>Bus: publish AgentTaskDelegated (sub-goal for Agent A)
    Bus->>AgentA: subscribed, picks up task
    AgentA->>AgentA: runs its own Plan→Execute→Critique loop (§9.1)
    AgentA->>Bus: publish AgentTaskCompleted (result)
    Bus->>Orchestrator: subscribed, receives result
    Orchestrator->>Bus: publish AgentTaskDelegated (sub-goal for Agent B, using A's result)
    Bus->>AgentB: subscribed, picks up task
    AgentB-->>Bus: AgentTaskCompleted
    Bus-->>Orchestrator: aggregate, produce final result
```

**Design Decisions:** agent-to-agent communication **reuses the Event Bus verbatim** (`BACKEND_ARCHITECTURE.md` §13.1) — the identical module-communication pattern already established for bounded-context decoupling, applied here to agent-to-agent decoupling for the same reason: an orchestrating agent delegating work should not hold a direct reference to the delegate agent's internals, exactly mirroring `BACKEND_ARCHITECTURE.md` ADR-002's module-boundary rule.

**Trade-offs & Rejected Alternatives:** **rejected** — direct, synchronous agent-to-agent function calls. Rejected for the same coupling/circular-dependency risk `BACKEND_ARCHITECTURE.md` §1.4 already identified for modules — an event-mediated design keeps agents independently composable and independently extractable (relevant to future multi-agent marketplace scenarios, Part 15/§9.14) without the two-way coupling a direct call graph would create.

### 9.4–9.5 Planner

**Purpose & Responsibilities:** decompose a high-level goal into an ordered/DAG sequence of steps, each either a direct-generation step or a tool-call step — itself an LLM call (a Registry prompt, §3.3, specialized for planning) routed through the standard Orchestration pipeline (Parts 2–4), producing a structured Plan the Executor (§9.6) consumes.

**Trade-offs & Rejected Alternatives:** **rejected** — a hardcoded, rule-based planner (fixed decision trees per task type) instead of an LLM-driven one. Rejected as insufficiently general for the breadth of tasks "AI Employees" implies — a rule-based planner would need a new rule set per task type, defeating the purpose of a general agentic system; an LLM-driven planner, constrained by a well-specified Registry prompt and the Tool Registry's declared capabilities (§9.11), generalizes across task types without per-type engineering.

### 9.6 Executor

**Purpose & Responsibilities:** runs the Plan's steps in sequence (or parallel, where the Plan's DAG allows), invoking Tools (§9.10) or sub-generations as needed, maintaining Working Memory (§6.2) of intermediate results, and applying a per-step failure policy (retry with backoff — reusing `BACKEND_ARCHITECTURE.md` §8.3's existing retry pattern; skip and continue; or escalate/abort the run) configurable per step type.

**Sequence:** see §9.1's state diagram — Executing is the state this component owns.

### 9.7 Critic & 9.8 Reflection Loop & 9.9 Self Evaluation

**Purpose & Responsibilities:** the Critic is a **separate LLM call** (often a smaller/cheaper model, per Dynamic Model Selection's cost-optimization, §2.5 — self-evaluation quality requirements are typically lower than generation-quality requirements) reviewing the Executor's step/final output against the original goal for correctness, completeness, and relevance. Self Evaluation is this mechanism's general name; the Reflection Loop is what happens when the Critic finds a deficiency — the Planner is re-invoked with the critique as additional context, producing a revised plan or step.

**Architecture:** see §9.1's state diagram (Critiquing/Reflecting states). **Bounded iteration**, stated as a hard rule: a configurable maximum reflection-iteration count (small — low single digits by default) and the run's overall wall-clock/credit budget (§9.9-as-runtime-concept, formalized in §11.4) are both checked by the Executor before allowing another Planning→Executing→Critiquing cycle; reaching either cap returns the best available result, clearly flagged as budget-exhausted rather than presented as a confident final answer — an honesty-preserving degradation, not a silent one.

**Trade-offs & Rejected Alternatives:** **rejected** — no Critic/Reflection step at all (accept the Executor's first-pass output unconditionally). Rejected as forgoing the single highest-leverage quality mechanism available to an agentic system at reasonable cost — a bounded, cheap self-review pass measurably improves output reliability for a small fraction of the cost of the generation it reviews, which is precisely why it's bounded rather than unconditional (cost-aware, not cost-blind).

### 9.10 Tool Calling, 9.11 Tool Registry & 9.12 Tool Permissions

**Purpose & Responsibilities:** Tools are the Agentic System's equivalent of API integrations — first-party (create a `Project`, send an email via the Notification Engine, query `AIUsage` analytics) and future third-party (via the Plugin Engine, §9.14). The **Tool Registry** catalogs available tools, each with a declared input/output schema (validated the same way request DTOs are, `BACKEND_ARCHITECTURE.md` §5.3) and a declared required `Permission.key` (`AUTH_ARCHITECTURE.md` §4.4's exact catalog — no parallel tool-specific permission system is introduced).

**The core security guarantee, stated precisely:** every tool invocation, whether triggered by a human-initiated agent run or an automated Workflow trigger (Part 10), is authorized through **the same permission pipeline** `AUTH_ARCHITECTURE.md` §4.5 already specifies, evaluated against **the invoking user's own resolved permissions** (or, for a Workflow with no live human request in flight, the permissions of the user who configured/owns the automation, resolved at execution time, not cached from configuration time — so a later permission downgrade takes effect on the very next automated run, consistent with that document's stated fail-secure freshness requirement). An agent **cannot** act with more authority than a direct API call from the same user could.

```mermaid
sequenceDiagram
    participant Agent as Agent Executor (§9.6)
    participant Registry as Tool Registry (§9.11)
    participant AuthZ as Permission Pipeline (AUTH_ARCHITECTURE.md §4.5, reused unchanged)
    participant Sandbox as Tool Sandboxing (§9.13, if third-party/code-executing)
    participant Core as Core module (via its public interface, BACKEND_ARCHITECTURE.md §3.3)

    Agent->>Registry: resolve tool + validate call schema
    Agent->>AuthZ: authorize(invokingUser, tool.requiredPermission, workspaceId)
    AuthZ-->>Agent: allow / deny (deny → step fails per Executor's failure policy, §9.6)
    alt first-party tool
        Agent->>Core: invoke via module public interface (no bypass)
    else third-party / code-executing tool
        Agent->>Sandbox: invoke via narrow RPC surface (§9.13)
    end
    Core-->>Agent: result
    Sandbox-->>Agent: result
```

**Trade-offs & Rejected Alternatives:** **rejected** — a separate, AI-specific elevated-privilege service account that agents act as, rather than the invoking user's own resolved permissions. Rejected as a severe Least-Privilege violation — this is precisely the "standing, silently-usable elevated flag" pattern `AUTH_ARCHITECTURE.md` §4.7 already rejected for internal staff access, and the reasoning transfers exactly: an agent acting with more authority than the human who invoked it is an unauditable, unbounded escalation vector.

### 9.13 Tool Security & Tool Sandboxing

**Purpose & Responsibilities:** for tools that execute code or reach systems outside the platform's own modules, apply the **identical sandboxing model** `BACKEND_ARCHITECTURE.md` §7.9 (ADR-005) already specified for the Plugin Engine — out-of-process execution (a separate worker process or WASM runtime), a narrow, versioned RPC surface exposing only the specific core-module public interfaces the tool's declared manifest was granted, and enforced CPU/memory/execution-time budgets. This document does not introduce a second sandboxing mechanism — a Tool *is*, architecturally, the same trust-boundary problem a Plugin is (code with bounded, declared access, potentially third-party-authored), and reuses that exact ADR rather than inventing a parallel one.

**Failure Handling & Recovery:** a tool that crashes, hangs, or exceeds its resource budget is terminated without affecting the host Agent Runtime process — isolation is the whole point, restated from `BACKEND_ARCHITECTURE.md` §7.9 because it applies here with identical force.

### 9.14 Relationship to the Plugin Engine & Marketplace

The Agentic System and the Plugin Engine (`BACKEND_ARCHITECTURE.md` §7.9) are two views of one mechanism: a Plugin *is*, in this document's model, a way of installing new Tools (and, in the future, new Agent Registry entries) into the platform via the marketplace (`PRD.md` §21). No new extension mechanism is designed here — this Part specifies how Agents *use* Tools; that document specifies how third-party Tools/Agents get safely *installed*. Stated explicitly so the two documents are read as one coherent extensibility story, not two competing ones.

---

## Part 10 — Workflow Automation

*(Subsystems 70–73: Workflow Engine, AI Automation, Task Scheduler, Event Processing.)*

### 10.1 Workflow Engine

**Purpose & Responsibilities:** durable, potentially long-running (hours to days) orchestration of a sequence of steps — some AI-driven (invoking the Agent Runtime, Part 9, or a single generation, Part 2), some deterministic (a time delay, a conditional branch on external state). This is architecturally distinct from a single Job (`BACKEND_ARCHITECTURE.md` §8) because a `WorkflowInstance`'s state must survive across many separate, time-dispersed job executions, not complete within one.

```mermaid
stateDiagram-v2
    [*] --> Triggered: Domain event (Event Processing, §10.4) or manual/scheduled start
    Triggered --> RunningStep: Dispatch current step as a Job\n(BACKEND_ARCHITECTURE.md §8, reused)
    RunningStep --> Waiting: Step is a deterministic delay/condition
    RunningStep --> RunningStep: Step complete, advance to next\n(AI step may invoke Agent Runtime, Part 9)
    Waiting --> RunningStep: Condition met / delay elapsed\n(Task Scheduler, §10.3)
    RunningStep --> Completed: Final step complete
    RunningStep --> Failed: Step exhausts retries (§8.3, reused)
    Failed --> [*]
    Completed --> [*]
```

**Architecture — new schema territory, flagged explicitly:** a `WorkflowInstance`'s durable state (current step, accumulated step outputs, wait conditions) requires persistence beyond what any existing `DATABASE.md` model provides — **(future schema extension, not required today)**, introduced here as a conceptual requirement, not a Prisma design (out of scope for this document per its Non-Goals, §0.3). The Workflow Engine is the **state-machine coordinator**; individual steps execute as ordinary Jobs on the existing Queue (`BACKEND_ARCHITECTURE.md` §8.2) — reuse, not replacement, of that infrastructure.

**Trade-offs & Rejected Alternatives:** **rejected** — modeling a Workflow as one long-running Job holding the process open for the workflow's entire duration. Rejected outright — a Worker process instance cannot correctly hold open a job across a multi-day wait condition (it must be restartable/rebalanced across deploys and instance restarts); the state-machine-plus-discrete-steps design is what makes a Workflow correctly resumable regardless of Worker process churn, directly reusing the Job system's own at-least-once/idempotent-handler guarantees (`BACKEND_ARCHITECTURE.md` §8.5) per step.

### 10.2 AI Automation

**Purpose & Responsibilities:** the product-facing framing of `PRD.md`'s "AI Workflow Automations" feature ("when X happens, do Y with AI") — implemented as Workflows whose trigger is a domain event (§10.4) and whose steps invoke the Orchestration Engine (Part 2) or Agent Runtime (Part 9). No new mechanism beyond the Workflow Engine (§10.1) — this section names the product capability that mechanism delivers.

### 10.3 Task Scheduler

**Purpose & Responsibilities:** the component resolving a Workflow's `Waiting` state (§10.1) back to `RunningStep` — either a time-based trigger (a delay elapses) or a condition-based trigger (external state changes, evaluated on the Event Processing pipeline, §10.4). **Fully reuses `BACKEND_ARCHITECTURE.md` §8.6's existing Scheduler** (BullMQ repeatable jobs, Phase 2) for time-based resumption — no second scheduling mechanism introduced.

### 10.4 Event Processing

**Purpose & Responsibilities:** Workflow triggers and condition evaluation both consume the **existing Event Bus** (`BACKEND_ARCHITECTURE.md` §13.1) — a Workflow's trigger definition is, architecturally, another Event Bus subscriber, exactly like the Notification/Webhook/Activity/Audit engines already are (`BACKEND_ARCHITECTURE.md` §7.2–§7.6). No new event-processing infrastructure is introduced; this section is the explicit statement that Workflow triggering is one more consumer of the platform's single, already-designed eventing backbone.

---

## Part 11 — AI Economics & Resilience

*(Subsystems 74–83: AI Credits, Token Accounting, Cost Forecasting, Budget Protection, Rate Limiting, Streaming, Retry Policy, Circuit Breakers, Provider Failover, Provider Health Monitoring.)*

### 11.1 AI Credits

**Fully specified — cited, not redesigned.** `DATABASE.md` §4 (`AICredit`/`AIUsage` schema), `BACKEND_ARCHITECTURE.md` §6.5 (`CreditLedgerService`, reserve/reconcile, row-lock concurrency control, ADR-AI-equivalent already recorded as `BACKEND_ARCHITECTURE.md` ADR-009). Everything in this Part extends that mechanism; nothing replaces it.

### 11.2 Token Accounting

**Purpose & Responsibilities:** the precise translation of raw provider usage (input tokens, output tokens — which the Capability Matrix, §2.4, records as priced independently and differently per model) into BizPilot AI credit units, computed by the Provider Abstraction Layer's response-parsing step immediately after a provider call returns, and fed directly into the existing `CreditLedgerService.reconcile()` call — a pure extension point, not a new ledger.

**Architecture:** `credits = f(inputTokens, outputTokens, modelCostMultiplier)`, where `modelCostMultiplier` is read from the Capability Matrix per the specific `(provider, model)` actually used (which, post-Dynamic-Selection, may differ request-to-request) — meaning credit cost is always computed from the *actual* servicing model, never a static per-`AIActionType` estimate, keeping billing accurate under dynamic routing.

### 11.3 Cost Forecasting

**Purpose & Responsibilities:** a new analytics capability projecting a workspace's likely month-end credit consumption from its trailing usage trend, surfacing proactively (extending the "you'll run out in N days" future note already flagged in `DATABASE.md`/`AUTH_ARCHITECTURE.md`'s billing discussion) — read-only, computed from existing `AICredit`/`AIUsage` data via a scheduled aggregation job (`BACKEND_ARCHITECTURE.md` §8), surfaced through `API_CONTRACT.md` §5.10's existing `GET /ai/usage/summary` endpoint shape, extended with a forecast field rather than a new endpoint.

### 11.4 Budget Protection

**Purpose & Responsibilities:** workspace-wide protection is **fully specified and unchanged** — `AIOverageMode`/`CreditOveragePolicy` (`BACKEND_ARCHITECTURE.md` §4.6, §6.5). This document's addition: **per-agent-run budget caps**, a distinct, tighter-scoped control layered on top — since an autonomous multi-step Agent Runtime execution (Part 9) can consume many generation calls within a single logical "request," it needs its own bounded ceiling (checked by the Executor before each loop iteration, §9.9) *in addition to* the workspace-wide credit balance check, so a single runaway agent task cannot silently consume a large fraction of a workspace's entire monthly allowance before the workspace-level `CreditOveragePolicy` would ever trigger. The per-run cap is a **new, agent-specific configuration** (a maximum credits-per-run ceiling, plan-tier-dependent, checked against the same `CreditLedgerService` reservation mechanism) — not a new accounting system, a second gate on the same ledger.

### 11.5 Rate Limiting (AI-Specific)

**Fully specified — cited, not redesigned.** `API_CONTRACT.md` §2.19's AI-generation-specific rate-limit tier (independent of general API limits and independent of, but compounding with, credit-balance gating) and `BACKEND_ARCHITECTURE.md` §9.3's internal token-bucket mechanism. This document's addition: agent-triggered tool calls (Part 9) count against the *same* AI-generation rate-limit tier as direct generation requests (an agent run that fires many tool-driven sub-generations must not be able to bypass the tier simply by routing through the Agent Runtime rather than the direct `/ai/generations` endpoint) — stated explicitly to close a potential rate-limit-bypass gap the introduction of the Agentic System (Part 9) would otherwise create.

### 11.6 Streaming

**Fully specified — cited, extended.** `BACKEND_ARCHITECTURE.md` §6.4's Streaming Engine (SSE, provider-format normalization, concurrent relay+accumulation, reconcile-to-actual-tokens on partial failure) is unchanged for single-turn generation. **Extension for the Agent Runtime:** the SSE event vocabulary gains new, additive frame types — `event: agent_step` (a plan step began), `event: tool_call` (a tool is being invoked, with the tool name but never its raw arguments if they contain sensitive input — a deliberate information-disclosure guard), `event: reflection` (a critique triggered re-planning) — alongside the existing `event: delta`/`event: done`/`event: error`, letting a client render live agent progress without any change to the underlying transport (`API_CONTRACT.md` §2.1's additive-change philosophy applied to the SSE contract specifically).

### 11.7 Retry Policy

**Fully specified — cited, not redesigned.** `BACKEND_ARCHITECTURE.md` §8.3 (exponential backoff with jitter, per-job-type configurable) governs every retry in this system — provider call retries, embedding retries, tool-call retries. No new retry mechanism.

### 11.8 Circuit Breakers

**Fully specified — cited, extended.** `BACKEND_ARCHITECTURE.md` §9.1's per-adapter circuit breaker pattern now explicitly covers the two new port families this document adds (`EmbeddingProviderPort`, `ModerationPort`, §2.3) with independent breaker state each — an embedding-provider outage trips only the embedding breaker (degrading RAG to keyword-only search, §2.3's table), never the completion-provider breaker.

### 11.9 Provider Failover

**Purpose & Responsibilities:** the operational realization of "zero vendor lock-in" — when a provider's circuit breaker opens, Dynamic Provider Selection (§2.5) automatically routes subsequent requests to the next-ranked healthy candidate per the Capability Matrix's fallback ordering, with no code change and no manual intervention required.

```mermaid
sequenceDiagram
    participant Router as Provider Router (§2.5)
    participant CB as Circuit Breaker (Provider A)
    participant A as Provider A
    participant B as Provider B (fallback)

    Router->>CB: check Provider A health
    CB-->>Router: OPEN (recent failure threshold exceeded)
    Router->>Router: filter Provider A out of candidates
    Router->>B: route to next-ranked healthy candidate
    B-->>Router: response
    Note over CB: Provider A breaker periodically\nhalf-opens to probe recovery (§9.1, reused)
```

**Trade-offs & Rejected Alternatives:** **rejected** — manual failover only (an on-call engineer switches providers via configuration during an incident). Rejected as too slow for a consumer-facing generation path — automatic failover, bounded by the existing circuit-breaker state machine, closes the gap between "provider degrades" and "traffic stops going to it" from minutes to seconds.

### 11.10 Provider Health Monitoring

**Purpose & Responsibilities:** a continuous background process (Worker-process scheduled job) issuing lightweight synthetic health checks per provider, feeding both the circuit breaker's state and the Capability Matrix's live latency/availability fields (§2.4) — the data source Dynamic Provider Selection's ranking step (§2.5) consults, so routing decisions reflect *current* observed health, not only reactive failure counts from real traffic.

---

## Part 12 — AI Observability & Quality

*(Subsystems 84–93: AI Telemetry, AI Metrics, AI Observability, AI Logging, AI Audit, AI Analytics, AI Benchmarking, AI Evaluation, Hallucination Detection, Output Validation.)*

### 12.1–12.4 AI Telemetry, Metrics, Observability & Logging

**Purpose & Responsibilities:** extends `BACKEND_ARCHITECTURE.md` §5.6–§5.7 (structured logging, OpenTelemetry, RED/USE) with AI-specific richness: every AI Request carries an `aiTraceId` (§2.1) threading through the *entire* Orchestration pipeline — Memory retrieval, Knowledge retrieval, Context Building, Prompt Compilation, Provider call, and (for agentic runs) every Plan/Execute/Critique/Reflect iteration — producing a single, queryable trace covering strictly more than a generic Use-Case-level span (`BACKEND_ARCHITECTURE.md` §5.7's stated one-span-per-Use-Case granularity is the floor; AI Requests get sub-spans per Orchestration stage on top of it).

**Metrics (RED/USE, AI-specific dimensions added):** request rate/error-rate/duration broken down by `AIActionType`, provider, model, and — critically — **routing path** (simple / RAG-augmented / agentic, §2.6), since these paths have structurally different latency/cost profiles and must be monitored/alerted on independently, not blended into one aggregate that would hide a regression in one path behind healthy numbers in another.

**Logging:** identical structured-JSON discipline as `BACKEND_ARCHITECTURE.md` §5.6 — AI-specific log fields (provider, model, `promptVersionId`, tokens, `aiTraceId`) attached via the same `AsyncLocalStorage`-based context propagation, never a parallel logging mechanism.

### 12.5 AI Audit

**Purpose & Responsibilities:** reuses `AuditLog` (`DATABASE.md` §6, `BACKEND_ARCHITECTURE.md` §7.6) with the identical synchronous/asynchronous split already established for sensitive actions — an Agent Runtime step that takes a **side-effecting action** (via a Tool, Part 9 — creating a resource, sending a communication) is written to `AuditLog` **synchronously, within the same transaction as the action itself**, per `AUTH_ARCHITECTURE.md` §4.5's "an action that isn't auditable shouldn't silently succeed unaudited" rule, restated here because agentic, autonomous actions are exactly the case that rule most needs to cover — a human reviewing "what did the AI do on my behalf" must get a complete, non-lossy record, never a best-effort one.

### 12.6–12.7 AI Analytics & AI Benchmarking

**AI Analytics:** fully specified via extension in §3.9 (Prompt Analytics) and §11.3 (Cost Forecasting) — no separate mechanism. **AI Benchmarking:** a curated, versioned set of representative tasks-with-expected-outcomes per `AIActionType`, maintained by BizPilot's internal team, used as the fixed input corpus for Offline Evaluation (§12.8) and Model Rollout gating (Part 14) — the benchmark set itself is versioned (mirroring the Prompt Versioning discipline, §3.2) so a benchmark's own evolution is tracked, not silently mutated.

### 12.8–12.9 AI Evaluation (Offline & Online)

**Offline Evaluation:** runs the Benchmarking corpus (§12.7) against a candidate prompt/model/routing-policy change **before** any real traffic sees it — a required gate ahead of Shadow Deployment (Part 14). **Online Evaluation:** live production quality signals from real traffic — implicit (regeneration rate: did the user immediately retry with different input, a strong negative signal, per §3.9's existing framing; agent-run completion-without-reflection-exhaustion rate) and explicit (user feedback where the product surface captures it, e.g. a thumbs up/down on a Copilot response — a **future product surface addition**, not built today, whose data this evaluation mechanism is designed to consume the moment it exists).

**Architecture:** both feed the same Evaluation data store (extending Prompt Analytics, §3.9, and Provider Health Monitoring's latency/quality data, §11.10, into one queryable corpus) consumed by the Optimizer (§3.5) and Model Rollout gating (Part 14) — one evaluation data model, multiple consumers, not a per-consumer parallel pipeline.

### 12.10 Hallucination Detection & Output Validation

**Purpose & Responsibilities:** a post-generation, pre-response gate — two distinct checks, run before Post-Processing hands a response back to the entry point (§2.6's Response Lifecycle): (1) **groundedness checking** for RAG-augmented responses (Part 7) — a lightweight verification that the output's factual claims trace back to retrieved source content, rather than being unsupported model invention; (2) **structured-output validation** for requests expecting a specific schema (e.g., a Tool's expected return shape, Part 9) — deterministic JSON-schema validation, not a probabilistic check.

**Architecture:** a `OutputValidationPort` with pluggable validators, policy-configurable per `AIActionType`/plan tier — `reject` (return an error, do not surface unvalidated output — Enterprise-tier default for structured-output/tool-result paths, where a malformed result could break a downstream automated action), `flag` (surface the output with a visible low-confidence indicator), or `pass-with-logging` (surface normally, but log the validation miss for Evaluation, §12.8, to improve over time) — the policy default is `reject` for anything a Tool or Workflow will act on programmatically (Deterministic where required, per the brief's stated principle) and `flag` for conversational/informational output (Eventually consistent quality acceptable, since a human reads and can judge it).

**Trade-offs & Rejected Alternatives:** **rejected** — no automated output validation, relying solely on human review of AI output. Rejected as incompatible with the platform's own Agentic System (Part 9) and Workflow Automation (Part 10) — an autonomous tool-calling agent or an unattended workflow step has no human in the loop to catch a malformed or ungrounded output before it causes a downstream effect, making automated validation a structural requirement, not a nice-to-have, for exactly the capabilities this document's own Parts 9–10 introduce.

---

## Part 13 — Safety, Privacy & Compliance

*(Subsystems 94–97: Safety Layer, Moderation, PII Protection, Compliance.)*

### 13.1 Safety Layer & 13.2 Moderation

**Purpose & Responsibilities:** the umbrella for pre- and post-generation checks preventing harmful or policy-violating content — the concrete mechanism producing `DATABASE.md` §4's existing `AIUsageStatus.BLOCKED_BY_GUARDRAIL` enum value (this document specifies what actually sets it).

```mermaid
flowchart TD
    In["User input (Gateway, §2.1)"] --> InMod["Input moderation\n(ModerationPort, §2.3/§13.2)"]
    InMod -->|flagged| BlockIn["BLOCKED_BY_GUARDRAIL — rejected pre-generation,\ncredit reservation released"]
    InMod -->|clean| InjectionCheck["Injection Defense (§3.7)"]
    InjectionCheck --> Generate["Provider call (Part 2)"]
    Generate --> OutMod["Output moderation (§13.2)"]
    OutMod -->|flagged| BlockOut["BLOCKED_BY_GUARDRAIL — response withheld,\ncredits reconciled to tokens actually generated\n(same rule as partial-stream failure, BACKEND_ARCHITECTURE.md §6.5"]
    OutMod -->|clean| Validation["Output Validation / Hallucination Detection (§12.10)"]
    Validation --> Deliver["Deliver to entry point"]
```

**Architecture:** Moderation is a `ModerationPort` (§2.3) — provider-agnostic by the same hexagonal principle as every other external capability in this document, using either the selected LLM provider's native moderation endpoint (Capability Matrix, §2.4, records this as an attribute) or a dedicated moderation model, decided per the same cost/quality/health-driven selection logic as completion providers (§2.5), not a bespoke selection mechanism.

**Trade-offs & Rejected Alternatives:** **rejected** — output-only moderation (skip the input check, rely solely on catching bad output). Rejected as strictly worse on both cost (a request that should never have been processed still consumes a full generation call before being caught) and safety-in-depth grounds (input moderation and injection defense, §3.7, are independent layers specifically so a gap in one doesn't leave the system with zero remaining protection).

### 13.3 PII Protection

**Purpose & Responsibilities:** detection and minimization of personally identifiable information flowing through the AI path — applied at two points: the **Context Builder** (Part 4, before content is sent to a third-party provider — minimizing what leaves the platform's own infrastructure at all) and **Memory Consolidation** (§6.12, before content is persisted long-term — minimizing what's retained, extending `AUTH_ARCHITECTURE.md`/`DATABASE.md`'s existing data-minimization principle into the AI-generated-content path specifically, as already flagged in §6.12).

**Architecture:** a `PIIDetectionPort` (regex/NER-based, or LLM-based for higher recall on unstructured text) — pluggable, since detection-quality/cost trade-offs here mirror every other provider-selection decision in this document.

### 13.4 Compliance

**Purpose & Responsibilities:** this document's additions to the AI-specific data path fit **within** `AUTH_ARCHITECTURE.md` §6.2–§6.3's existing GDPR/SOC 2 posture — restated, not re-derived: the Long-Term Memory Store (§6.10) and Knowledge/RAG index (Part 7) are both subject to the identical anonymization/deletion triggers as every other user- or workspace-attributable data (§6.13's Forgetting Strategy is the concrete extension point). **New, AI-specific compliance considerations this document surfaces explicitly (a named, hidden-risk category the brief asks to be identified):** third-party LLM/embedding/moderation provider **data-processing-agreement status** (does the provider train on submitted content by default, and has that been contractually disabled; what data-residency region does the selected provider process requests in) is now a **Capability Matrix attribute** (§2.4) specifically so provider selection can be constrained by compliance requirements (an Enterprise workspace with a data-residency requirement can be restricted, via Dynamic Provider Selection's filtering step, §2.5, to only providers/regions meeting that requirement) — compliance is therefore an *input to routing*, not a separate, unenforced policy document.

---

## Part 14 — Model Lifecycle & Experimentation

*(Subsystems 98–104: Model Rollout, Shadow Deployments, Canary Releases, A/B Testing, Feature Flags, Offline Evaluation, Online Evaluation.)*

### 14.1 Model Rollout (Lifecycle)

**Purpose & Responsibilities:** the governed process by which a change to a prompt version, model selection, or routing policy moves from "proposed" to "serving all traffic" — gated by quality evidence at each stage, never a direct cutover.

```mermaid
stateDiagram-v2
    [*] --> Proposed: New prompt version / model / routing policy candidate
    Proposed --> OfflineEval: Run against Benchmark corpus (§12.8)
    OfflineEval --> Rejected: Fails quality bar
    OfflineEval --> Shadow: Passes quality bar
    Shadow --> Canary: Shadow metrics (§14.2) show no regression\nover a defined observation window
    Shadow --> Rejected: Shadow metrics show regression
    Canary --> Widening: Canary metrics (§14.3) healthy,\ntraffic percentage increased stepwise
    Canary --> RolledBack: Canary metrics show regression\n(automatic rollback)
    Widening --> FullyRolledOut: 100% traffic, monitored\n(Online Evaluation, §12.8, continues indefinitely)
    Rejected --> [*]
    RolledBack --> [*]
    FullyRolledOut --> [*]
```

### 14.2 Shadow Deployments

**Purpose & Responsibilities:** a candidate runs **in parallel** with the production configuration for a sample of real traffic — its output is logged and evaluated (feeding Online Evaluation, §12.8) but **never shown to the user and never charged** — zero user-facing risk, the safest possible stage for gathering real-traffic-distribution quality signal before any live exposure.

**Architecture:** implemented as a second, non-blocking Provider Abstraction call issued alongside the production one (fire-and-forget, its result written to the Evaluation data store, never returned to the requester) — a deliberate cost trade-off (a shadow request duplicates the generation cost of the traffic sample it covers) accepted specifically because it is the only stage that gives zero-risk, real-distribution evidence before any live user is affected.

### 14.3 Canary Releases

**Purpose & Responsibilities:** the candidate *does* serve a small, real percentage of production traffic — implemented as a refinement of Dynamic Provider/Model Selection's ranking step (§2.5): the Router's selection function, for workspaces assigned to the canary cohort (a deterministic, sticky assignment so a given workspace sees consistent behavior across requests rather than a confusing random flicker), returns the candidate instead of the incumbent. Monitored closely via the same RED-method metrics (§12.1) at fine granularity; **automatic rollback** on regression (an error-rate or quality-signal threshold breach reverts the cohort to the incumbent without requiring manual intervention — Self-Healing Where Practical, one of the brief's stated principles, applied concretely here).

### 14.4 A/B Testing & 14.5 Feature Flags

**A/B Testing:** the general form of Canary's traffic-splitting mechanism, generalized beyond "incumbent vs. one candidate" to compare multiple variants (of a prompt, a routing policy, an agent persona) against Online Evaluation metrics (§12.8) to determine a winner — same underlying mechanism as Canary, different purpose (rollout safety vs. comparative optimization). **Feature Flags: fully reuses `BACKEND_ARCHITECTURE.md` §7.7's existing `FeatureFlagEngine`** and `DATABASE.md` §2's `FeatureFlagType.PERCENTAGE_ROLLOUT` enum value — this document introduces **no new feature-flag mechanism**; Canary/A-B traffic-splitting assignment is implemented *using* that existing engine, applied to AI-routing decisions specifically, exactly as it's already used for product-feature rollout elsewhere in the platform.

### 14.6 Offline Evaluation & 14.7 Online Evaluation

**Fully specified in §12.8** — restated here only because both are load-bearing *gates* in the Rollout lifecycle diagram (§14.1) above, not merely passive measurement: Offline Evaluation is a **hard gate** (a candidate that fails it cannot enter Shadow); Online Evaluation is a **continuous gate** (its metrics drive both the Shadow→Canary and Canary→Widening transitions, and remain the mechanism watching every fully-rolled-out configuration indefinitely afterward, since a provider-side model update — outside BizPilot AI's control — can silently change behavior and must be caught by the same live signal that caught the platform's own regressions).

---

## Part 15 — Future Research Directions

*(Subsystems 105–110: Future Fine-Tuning, Future Distillation, Future Local Models, Future Edge AI, Future Federated AI, Future Research Directions.)*

Each direction below is stated with **why this document's architecture already accommodates it** — the brief's explicit instruction that future items be "open for future research," not hand-waved.

### 15.1 Future Fine-Tuning

Workspace- or vertical-specific fine-tuned models, selectable via the **existing** Capability Matrix and Dynamic Model Selection (§2.4–§2.5) — a fine-tuned model is simply a new row in the matrix with its own cost/capability profile; no new selection mechanism is needed. Distinguished from RAG (Part 7, §7.1's explicit trade-off discussion) as solving a different problem: adapting model *behavior/style*, not injecting *facts* — the two are complementary, not competing, future directions.

### 15.2 Future Distillation

Using accumulated Online Evaluation data (§12.8/§14.7) as training signal for smaller, cheaper distilled models that approximate a larger model's behavior on BizPilot AI's own task distribution — a direct, natural consumer of the Evaluation data store this document already specifies as a first-class subsystem (§12.8), not a system that would need to be built from scratch to support this direction later.

### 15.3 Future Local Models & 15.4 Future Edge AI

Relevant for latency-sensitive interactions and for Enterprise customers with data-residency or air-gapped-deployment requirements the Compliance discussion (§13.4) already names as a routing input. The Provider Abstraction Layer's port design (§2.3) is precisely what makes a local/on-premises or edge-deployed model adapter possible without touching any calling code in Parts 2–14 — stated once here as the explicit payoff of that architectural investment, rather than repeated at every prior provider-abstraction mention.

### 15.5 Future Federated AI

The most speculative direction named in the brief — learning across workspaces without centralizing raw tenant data, in service of a platform-wide-improving model while preserving `DATABASE.md` §3.1's strict workspace-isolation guarantee. Explicitly framed as a genuine open research question, not a committed design: any future work here must be evaluated against the same workspace-isolation and explicit-permissioned-aggregation discipline `API_CONTRACT.md` §5.17 and this document's Organizational Memory section (§6.7) already established for every other cross-workspace capability — a federated-learning approach that respects those constraints (learning from gradients/aggregates, never raw content) is the class of solution this document's principles would permit; one that requires centralizing raw workspace content would not be, regardless of its technical merits.

### 15.6 Future Research Directions (General)

The unifying property across all five directions above, worth stating as this Part's conclusion: none of them require touching the architecture specified in Parts 1–14. Each is a new entry behind an existing port, a new consumer of an existing data store, or a new constraint on an existing selection/routing function. This is the concrete, verifiable form of "future-proof" and "open for future research" — not a claim, but a property that follows directly from the hexagonal, port-based design applied consistently across every external and evolving dependency in this document.

---

## Part 16 — Formal Architecture Decision Records

Each ADR follows Problem → Context → Decision → Alternatives Considered → Trade-offs → Consequences → Future Review. Full supporting reasoning lives in the cross-referenced section; this appendix is the structured, scannable index the brief explicitly requires, not a duplicate of the body.

### ADR-AI-001 — Intelligence Layer Is Internal to the Existing `ai-platform` Module

- **Problem:** where does the large amount of new architecture in this document live relative to the module system `BACKEND_ARCHITECTURE.md` already established?
- **Context:** `DATABASE.md` §1.1 already scoped one "AI Platform" bounded context; introducing a second, overlapping one would fragment ownership of clearly-related data and code.
- **Decision:** the Intelligence Layer is the `ai-platform` module's internal architecture, grown to full depth (§1.3).
- **Alternatives Considered:** a new, parallel top-level bounded context for "AI orchestration code" separate from "AI data."
- **Trade-offs:** a very large module (this document's entire scope lives inside one `BACKEND_ARCHITECTURE.md` module boundary) versus splitting bounded-context ownership across two contexts for data that is inherently one concern.
- **Consequences:** `ai-platform` becomes the largest single module in the platform by a wide margin; internally it must apply its own further sub-organization (Parts 2–14 each map to an internal sub-directory grouping) to stay navigable.
- **Future Review:** revisit if/when `ai-platform` itself becomes a microservice-extraction candidate (`BACKEND_ARCHITECTURE.md` §13.4) — at that point its internal sub-organization becomes the seam for a *second-order* split, if warranted by then.

### ADR-AI-002 — Single Mandatory AI Gateway for Every Entry Point

- **Problem:** how is "one unified intelligence architecture" (the brief's explicit requirement) enforced rather than merely documented?
- **Context:** ten-plus product surfaces (§0.1) will eventually call into AI capability; without a shared entry point, each is free to reimplement credit checks, moderation, and tracing independently, and inevitably will drift.
- **Decision:** every entry point converges on one AI Gateway (§2.1) before reaching the Orchestration Engine.
- **Alternatives Considered:** per-feature integration, each calling the Provider Abstraction Layer directly with its own pre-checks.
- **Trade-offs:** a small amount of added indirection for every request versus a structural (not merely conventional) guarantee that safety/cost/observability checks cannot be skipped by a new feature.
- **Consequences:** the Gateway becomes a highly-reused, must-not-regress component; its own test coverage and change-review bar is correspondingly the highest in the Intelligence Layer.
- **Future Review:** none anticipated — this is a foundational guarantee, not a scale-triggered decision.

### ADR-AI-003 — `pgvector` as the Launch Vector Store for Memory and Knowledge

- **Problem:** where do Long-Term Memory (Part 6) and Knowledge/RAG (Part 7) embeddings live?
- **Context:** `BACKEND_ARCHITECTURE.md` ADR-003 already established the platform's precedent for this exact class of decision (Postgres-native capability before dedicated infrastructure) for full-text search.
- **Decision:** `pgvector`, behind a `VectorStorePort`, shared by both Memory and Knowledge (distinguished by a `sourceType` tag), per §6.10/§7.7.
- **Alternatives Considered:** a dedicated vector database (Pinecone/Qdrant/Weaviate) from launch; two separate vector stores (one per use case).
- **Trade-offs:** simpler operations and transactional co-location with relational scoping data, versus the more advanced ANN-indexing features and horizontal-scaling characteristics a purpose-built vector database offers at very large scale.
- **Consequences:** vector search performance is bounded by what `pgvector` can deliver on the platform's existing Postgres primary; this is an explicit, monitored scalability bottleneck (Part 17).
- **Future Review:** triggered by per-workspace or platform-wide vector volume/query-latency crossing a defined threshold — the `VectorStorePort` makes the swap a contained adapter change when that trigger fires.

### ADR-AI-004 — Every Stored Vector Is Tagged with Its Producing Embedding Model/Version

- **Problem:** embeddings from different models are not comparable; how does the platform survive an embedding-model change without a disruptive full re-index?
- **Context:** identified as a hidden risk (§7.3) that would otherwise only surface at the moment of a painful, correctness-critical migration.
- **Decision:** tag every vector with `(embeddingProvider, embeddingModel, version)`; support multiple coexisting embedding spaces with gradual backfill.
- **Alternatives Considered:** no tagging, assuming embedding-model stability; forced synchronous re-embedding on any model change.
- **Trade-offs:** a small amount of extra metadata and query-side filtering complexity, versus a materially safer future migration path.
- **Consequences:** retrieval queries must always filter/compare within one embedding space; mixed-space comparison is a bug class this tagging structurally prevents.
- **Future Review:** exercised the first time the platform's default embedding model changes — success criteria: zero retrieval-quality regression during the gradual backfill window.

### ADR-AI-005 — Hybrid Search Reuses the Existing Postgres FTS Search Engine

- **Problem:** how does keyword search combine with vector similarity search without duplicating search infrastructure?
- **Decision:** Hybrid Search (§7.6) fuses `pgvector` similarity results with the existing `BACKEND_ARCHITECTURE.md` §7.4 `SearchPort`/`PostgresFullTextSearchAdapter`.
- **Alternatives Considered:** a second, RAG-specific keyword-search implementation.
- **Trade-offs:** minor fusion-logic complexity versus a fully duplicated search stack.
- **Consequences:** the existing Search Engine's scaling ceiling (`BACKEND_ARCHITECTURE.md` ADR-003) now also bounds Hybrid Search's keyword half — the two systems' future evolution triggers are linked.
- **Future Review:** tied to `BACKEND_ARCHITECTURE.md` ADR-003's own review trigger.

### ADR-AI-006 — Memory and Knowledge Are Conceptually Distinct, Infrastructurally Shared

- **Decision:** Parts 6 and 7 are separate document sections (distinct retrieval semantics, distinct ranking defaults) but share one Vector Store (ADR-AI-003).
- **Alternatives Considered:** treating "everything retrievable via similarity search" as one undifferentiated concept.
- **Consequences:** every retrieval call must specify which conceptual scope (memory vs. knowledge) it wants, via the `sourceType` tag — an easy-to-violate discipline if not enforced at the port level, so the `VectorStorePort`'s query interface makes `sourceType` a required parameter, not an optional filter.
- **Future Review:** none anticipated.

### ADR-AI-007 — Working Memory Has No Persistence Layer

- **Decision:** request-scoped agent/generation state (§6.2) is never written to any store as "memory" — only Session Memory (an existing, already-persisted `Message`) and consolidated Long-Term Memory (§6.12) are.
- **Alternatives Considered:** persisting every intermediate reasoning step as a form of memory.
- **Trade-offs:** loses fine-grained intermediate-step replayability for memory purposes (though not for audit purposes — see ADR-AI-014) versus avoiding unbounded, low-value storage growth.
- **Future Review:** none anticipated — intermediate agent steps are an *audit* concern (§12.5), never a *memory* concern, by design.

### ADR-AI-008 — User Memory Is a Deferred, Future Schema Extension

- **Decision:** no `DATABASE.md` model exists for User Memory (§6.4) today; it is designed conceptually, not implemented.
- **Alternatives Considered:** implementing it now as part of this document's scope.
- **Trade-offs:** the Copilot cannot yet remember individual-user preferences across sessions independent of the workspace/conversation; accepted as a scoped, near-term product limitation, not an architectural gap (the extension point is fully specified).
- **Future Review:** triggered by product prioritization, not a technical blocker — the Memory Retrieval/Consolidation mechanisms (§6.11–§6.12) are already shaped to accept it as a new scope with no redesign.

### ADR-AI-009 — Organizational Memory Deferred, Explicit-Aggregation-Only If Built

- **Decision:** matches `API_CONTRACT.md` §5.17's identical stance on cross-workspace search — no implicit cross-workspace memory sharing, ever.
- **Trade-offs:** agency users (Agency Alex, `PRD.md`) do not yet get cross-client learned-pattern benefits; accepted in favor of preserving `DATABASE.md` §3.1's workspace-isolation guarantee without exception.
- **Future Review:** if built, requires its own explicit authorization model, reviewed independently — not a default extension of per-workspace Memory Retrieval.

### ADR-AI-010 — Forgetting via Relevance Decay Plus Compliance-Triggered Hard Deletion, Not TTL-Only

- **Decision:** §6.13 — continuous relevance scoring for soft forgetting; explicit, event-triggered purge (extending `AUTH_ARCHITECTURE.md` §6.2's anonymization job) for compliance.
- **Alternatives Considered:** fixed TTL expiration for all Long-Term Memory.
- **Trade-offs:** more implementation complexity (a scoring job) versus a blunt mechanism that would incorrectly expire durable business facts on an arbitrary clock.
- **Consequences:** any future addition to the memory system (e.g., User Memory, ADR-AI-008) must explicitly wire into the compliance-deletion trigger at build time — flagged as a standing implementation checklist item, not assumed automatic.
- **Future Review:** audited whenever a new memory scope is added.

### ADR-AI-011 — Agent/Tool Authorization Reuses the Existing Permission Pipeline, No Elevated AI Service Account

- **Problem:** what authority does an autonomous agent act with?
- **Decision:** exactly the invoking user's own resolved permissions, via `AUTH_ARCHITECTURE.md` §4.5's unchanged pipeline (§9.10).
- **Alternatives Considered:** a dedicated, elevated AI/automation service account.
- **Trade-offs:** some agent tasks may be constrained by a user's own permission gaps (cannot do more than they could do themselves) versus the severe Least-Privilege violation an elevated account would represent.
- **Consequences:** agent capability is inherently bounded by the configuring/invoking user's role — a documented product constraint, not a bug, and one that must be communicated clearly in-product (an AI Employee is only as capable as the human account that owns it).
- **Future Review:** none anticipated — this is treated as a non-negotiable security invariant, not a scale- or product-triggered decision.

### ADR-AI-012 — Tool Sandboxing Reuses `BACKEND_ARCHITECTURE.md` ADR-005 (Plugin Sandboxing), Not a New Model

- **Decision:** §9.13 — identical out-of-process/WASM sandboxing, narrow RPC surface, resource budgets.
- **Alternatives Considered:** a separate, agent-specific sandboxing implementation.
- **Trade-offs:** none material — the trust-boundary problem is structurally identical, so a second implementation would be pure duplication with no corresponding benefit.
- **Future Review:** tied to `BACKEND_ARCHITECTURE.md` ADR-005's own review trigger.

### ADR-AI-013 — Agent-to-Agent Communication via the Existing Event Bus, Never Direct Synchronous Calls

- **Decision:** §9.3 — reuses `BACKEND_ARCHITECTURE.md` §13.1/ADR-002's module-boundary communication pattern for inter-agent coordination.
- **Trade-offs:** multi-agent workflows are eventually consistent (a small latency/complexity cost) versus a direct-call graph that would recreate the exact circular-dependency and coupling risk `BACKEND_ARCHITECTURE.md` §1.4 already solved for modules.
- **Future Review:** none anticipated.

### ADR-AI-014 — Bounded Agent Iteration Count and Wall-Clock/Credit Budget, No Unbounded Autonomy

- **Decision:** §9.1/§9.8 — hard caps checked before every Plan→Execute→Critique→Reflect cycle.
- **Alternatives Considered:** trusting the agent's own judgment to self-terminate.
- **Trade-offs:** some legitimately-complex tasks may hit the cap and return a best-effort, flagged-incomplete result versus the unbounded-cost/unbounded-runtime risk of no cap.
- **Consequences:** cap values are product-tunable configuration, not hardcoded constants — expected to be tuned as real usage data (Part 12) accumulates.
- **Future Review:** revisited as Online Evaluation data reveals whether current caps are frequently binding (too tight) or rarely reached (possibly too loose).

### ADR-AI-015 — Per-Agent-Run Credit Budget as an Additional Gate on the Existing Ledger

- **Decision:** §11.4 — a new, narrower-scoped check layered on the unchanged `CreditLedgerService` (`BACKEND_ARCHITECTURE.md` §6.5), not a second accounting system.
- **Trade-offs:** an additional configuration surface (per-run cap, plan-tier dependent) versus the risk of one runaway agent task consuming a large share of a workspace's monthly allowance before the workspace-level policy would ever trigger.
- **Future Review:** cap defaults tuned alongside ADR-AI-014's iteration caps, using the same evaluation data.

### ADR-AI-016 — Workflow Engine as State Machine Over the Existing Job Queue, Not a Held-Open Long-Running Job

- **Decision:** §10.1 — `WorkflowInstance` durable state (future schema extension) plus discrete Job dispatch per step, reusing `BACKEND_ARCHITECTURE.md` §8's Queue unchanged.
- **Alternatives Considered:** one long-running Job process per workflow instance.
- **Trade-offs:** more moving parts (a state machine plus a queue, rather than one process) versus correctness under Worker-process restarts/redeploys, which a held-open job cannot survive.
- **Future Review:** none anticipated at the architectural level; the `WorkflowInstance` schema itself is a near-term implementation task, not a re-review trigger.

### ADR-AI-017 — Output Validation Defaults to Reject for Programmatic Consumption, Flag for Conversational Output

- **Decision:** §12.10 — policy-configurable per `AIActionType`/plan tier, with a deterministic-by-default posture wherever a downstream Tool/Workflow acts on the output automatically.
- **Trade-offs:** occasionally rejecting a valid-but-malformed-looking output (a false positive) versus letting a genuinely malformed output trigger an unattended, incorrect downstream action.
- **Future Review:** validation false-positive/false-negative rates are an Online Evaluation metric (§12.8) feeding periodic policy tuning.

### ADR-AI-018 — Model Rollout Traffic-Splitting Reuses the Existing Feature Flag Engine, No New Flag Mechanism

- **Decision:** §14.4–§14.5 — Canary/A-B cohort assignment implemented via `BACKEND_ARCHITECTURE.md` §7.7's `FeatureFlagEngine` and `DATABASE.md` §2's `PERCENTAGE_ROLLOUT` type, applied to AI-routing decisions.
- **Trade-offs:** none material — this is a direct, intended reuse of a mechanism already general enough for this exact purpose.
- **Future Review:** none anticipated.

### ADR-AI-019 — Provider, Embedding, and Moderation Capabilities Share One Hexagonal Port Pattern

- **Decision:** §2.3 — three port families (`AIProviderPort` existing, `EmbeddingProviderPort` and `ModerationPort` new), one consistent adapter-swap philosophy across all of them.
- **Alternatives Considered:** a bespoke integration approach per capability type.
- **Trade-offs:** none material — consistency here directly reduces the system's total conceptual surface area for engineers working across capability types.
- **Future Review:** applied automatically to any future capability type (e.g., a future dedicated vision provider) by construction.

### ADR-AI-020 — RAG Is the Default Grounding Mechanism at Launch; Fine-Tuning Is Deferred

- **Decision:** §7.1 — per-workspace knowledge grounding via retrieval, not per-workspace model fine-tuning.
- **Alternatives Considered:** fine-tuning a model per workspace on its own content.
- **Trade-offs:** RAG's per-query retrieval cost versus fine-tuning's training/maintenance cost at multi-tenant scale — RAG wins decisively on operational simplicity and update latency (a new document is searchable within one ingestion cycle; a fine-tune requires a full retraining cycle).
- **Future Review:** fine-tuning (§15.1) is deferred, not rejected — revisited if a specific, high-value vertical use case (behavior/style adaptation RAG cannot address) justifies the operational cost.

---

## Part 17 — Consolidated Risks, Assumptions, Constraints & Migration Roadmap

### 17.1 Assumptions

| # | Assumption |
|---|---|
| A1 | At least one LLM provider (OpenAI, per `BACKEND_ARCHITECTURE.md` §1.3's launch adapter) offers function/tool calling, streaming, and vision input sufficient for Parts 2, 8, and 9's designs to function at launch. |
| A2 | `pgvector` performance at the workspace-content volumes expected through "100,000 users" (the brief's stated range) is acceptable without a dedicated vector database — monitored, not assumed indefinitely (ADR-AI-003). |
| A3 | The Worker process (`BACKEND_ARCHITECTURE.md` §8, ADR-006) is provisioned with sufficient capacity to run multi-modal extraction (Part 8) and Agent Runtime executions (Part 9) without starving other background work — a capacity-planning input for operations, not an architectural gap. |
| A4 | Product surfaces for explicit user feedback (thumbs up/down, §12.8) will exist eventually — Online Evaluation is designed to consume that signal the moment it does, but does not require it to function at a reduced (implicit-signal-only) level today. |

### 17.2 Constraints (Inherited, Not Renegotiated)

Every constraint already established in `DATABASE.md`, `AUTH_ARCHITECTURE.md`, `API_CONTRACT.md`, and `BACKEND_ARCHITECTURE.md` applies unchanged and is not re-litigated here — most centrally: strict workspace data isolation (`DATABASE.md` §3.1), no elevated/standing AI service-account authority (ADR-AI-011), Postgres as the sole source of truth with Redis/vector-store as cache-or-enhancement-only (extending `BACKEND_ARCHITECTURE.md` §8.1's "cache, never source of truth" principle to the new Vector Store, §6.10's explicit graceful-degradation statement), and no raw payment/card data ever touching this system (`API_CONTRACT.md` Decision #12, irrelevant to but consistent with this document's own no-new-PCI-surface posture).

### 17.3 Scalability Bottlenecks (Named Explicitly)

| Bottleneck | First to feel it | Mitigation already designed | Trigger for action |
|---|---|---|---|
| `pgvector` query latency at very large per-workspace vector counts | Memory Retrieval (§6.11), Knowledge retrieval (Part 7) | `VectorStorePort` swap to a dedicated vector database (ADR-AI-003) | Sustained p95 vector-query latency regression, monitored per §12.1 |
| Agent Runtime concurrency on the Worker process | Multi-step "AI Employee" tasks under high concurrent usage | Independent Worker scaling on queue depth (`BACKEND_ARCHITECTURE.md` §13.2, reused) | Queue depth / agent-run queue-wait-time alerting (extending `BACKEND_ARCHITECTURE.md` §10.2) |
| Single-provider throughput ceiling during a traffic spike | Provider Abstraction Layer (§2.3) | Dynamic Provider Selection + Failover (§2.5, §11.9) spreading load across healthy candidates | Sustained rate-limit rejections from a single provider |
| Memory Consolidation job backlog under very high conversation volume | §6.12 | Standard Queue backpressure/DLQ handling (`BACKEND_ARCHITECTURE.md` §8.4, reused) — consolidation is explicitly non-blocking for the response path | DLQ growth rate for the consolidation job type |

### 17.4 Operational & Long-Term Maintenance Implications

The Capability Matrix (§2.4) and the Evaluation data store (§12.8) are this document's two highest-maintenance-burden artifacts — both require ongoing, deliberate curation (new provider/model entries, benchmark corpus upkeep) rather than being "build once" components; this is stated explicitly as a standing operational commitment the platform takes on by adopting this architecture, not a one-time implementation cost. The ADR log (Part 16) and the section-level "Trade-offs & Rejected Alternatives" notes throughout are the intended first stop for any future engineer questioning "why does this work this way" — maintained as living references, expected to gain a "superseded by ADR-AI-0XX" annotation rather than silent edits when a decision is later revisited.

### 17.5 Migration Roadmap (Consolidated)

| Item | Depends on | Priority rationale |
|---|---|---|
| `EmbeddingProviderPort` + `ModerationPort` adapters, Vector Store (`pgvector`) | None | Foundational — Parts 6–8, 13 cannot function without these; highest priority |
| Long-Term Memory Store + Memory Consolidation job | Vector Store above | High — directly delivers the brief's "AI Memory" capability |
| Knowledge Pipeline (Document ingestion → chunking → embedding → indexing) | Vector Store above | High — directly delivers "AI Knowledge"/"AI Search" |
| Multi-modal extractors (Image/OCR/PDF/Spreadsheet/Audio) | None (extends existing `BACKEND_ARCHITECTURE.md` §12 pipeline) | High — required for Knowledge Pipeline to handle real-world file types |
| Agent Runtime, Tool Registry, Agent Registry | Tool sandboxing (reuses `BACKEND_ARCHITECTURE.md` ADR-005, already available) | High — delivers "AI Employees"/"AI Agents," the platform's most differentiated future capability |
| Workflow Engine (`WorkflowInstance` schema + state machine) | Existing Job Queue (`BACKEND_ARCHITECTURE.md` §8) | Medium-high — delivers "AI Automation" |
| Evaluation data store, Offline/Online Evaluation, Model Rollout gating | Basic Analytics (§3.9) already available at launch | Medium — becomes increasingly valuable as usage volume grows; not launch-blocking |
| User Memory, Organizational Memory | Long-Term Memory Store above | Lower — explicitly deferred, product-prioritization-driven |
| Future Fine-Tuning, Distillation, Local/Edge Models, Federated AI (Part 15) | Sufficient production Evaluation data / explicit Enterprise demand | Lowest, research-track — no current trigger condition met |

---

*End of AI Platform Architecture document.*










