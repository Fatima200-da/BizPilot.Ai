# Phase 24 — AI Architecture Audit

Real-repository audit performed before any Phase 24 code changes, per the phase's own instruction ("do not immediately rewrite the AI layer"). Every claim below is grounded in a file actually read this session — file paths and line-level facts are cited, not inferred.

## 1. Current AI Flow

```
HTTP request (workflow trigger / marketing-autopilot run)
      → workflow-engine.service.ts runs steps in order via step-handler.registry.ts
      → AI-bearing steps (marketing-autopilot.steps.ts: build_strategy, generate_pillars, generate_calendar)
            → credit-ledger.service.ts.recordUsage()   [DEDUCTS CREDITS — see Section 6, this is currently BEFORE the provider call]
            → provider-router.ts.getAIProvider()        [selects mock or openai adapter, cached singleton]
                  → MeteredProviderPort wraps the concrete adapter (counts ai_requests_total succeeded/failed)
                        → MockProviderAdapter (deterministic fixtures) OR OpenAIAdapter (real `openai` SDK call)
            → Zod schema validation (marketing-autopilot.schemas.ts: strategyOutputSchema / pillarsOutputSchema / calendarOutputSchema)
      → step05ValidateOutput (pure code cross-checks, no AI)
      → step06PersistAssets (idempotent upsert into ContentAsset)
      → step07AwaitApproval (human gate)
```

## 2. Provider Abstraction

`backend/src/infrastructure/ai/ai-provider.port.ts` defines `AIProviderPort` (`complete(request): Promise<AICompletionResult>`) and `AICompletionRequest`/`AICompletionResult` shapes. Two implementations:
- `mock-provider.adapter.ts` — deterministic, hash-seeded fixture generator. **Cannot fail or time out by design** (no network call) — confirmed by reading its `complete()` body, which only does local computation and a bounded `sleep()`.
- `openai/openai.adapter.ts` — real `openai` npm SDK client, constructed only when `env.AI_PROVIDER === 'openai'` (constructor throws if `OPENAI_API_KEY` is unset, so the mock-only path never touches the OpenAI SDK's runtime).

`infrastructure/ai/provider-router.ts` is the single choke point (`getAIProvider()`) every caller uses — no module imports a concrete adapter directly except the router and the adapters themselves (confirmed via `Glob`/`Grep`, only 4 files exist under `infrastructure/ai` + `infrastructure/openai`). It wraps the concrete adapter in `MeteredProviderPort`, which increments `ai_requests_total{succeeded|failed}` — the only per-request observability currently emitted (see Section 9 gaps: no request ID, tenant ID, model, or latency in this metric, only a bare counter).

## 3. Request Flow

Per-step, in `marketing-autopilot.steps.ts`:
1. `recordUsage()` is called first — deducts credits synchronously.
2. `resolveProvider().complete({ actionType, promptKey, context, workspaceId, userId })` is called.
3. `JSON.parse(result.outputJson)` then `<schema>.safeParse(...)`.
4. On schema failure → `ValidationError` (a **permanent** failure class — `workflow-engine.service.ts`'s `isTransient()` never retries it).
5. On provider throw (`UpstreamProviderError`) → **transient** — retried by `runStepWithRetry` up to `MAX_STEP_ATTEMPTS = 3` with `2^attempt * 100ms` exponential backoff (confirmed: `workflow-engine.service.ts:67,219-252`).

Model selection: `env.OPENAI_MODEL` (Zod default `'gpt-4o-mini'`, configurable via env var, not hard-coded in call sites — confirmed only one reference to `env.OPENAI_MODEL` exists, in `openai.adapter.ts:36`). Response format: `{ type: 'json_object' }` (OpenAI's structured-JSON mode, not fragile string parsing — satisfies Section 5's requirement already).

**Gap found:** no `timeout` is passed to `new OpenAI({ apiKey })` or to the `chat.completions.create()` call — the adapter relies entirely on the SDK's own default timeout (600s) and default internal retry count (2), both undocumented in this codebase and not verified against the app's own `MAX_STEP_ATTEMPTS`/backoff policy. This means today there are **two uncoordinated retry layers** (SDK-internal + workflow-engine step retry) if a real key were active.

## 4. Response Flow

Output is validated by 3 dedicated Zod schemas (`marketing-autopilot.schemas.ts`) — never trusted raw. `step05ValidateOutput` adds a second, cross-step structural check (pillar-key references, non-empty captions) that is pure code, independent of which provider produced the data — matches the phase's "AI is never the source of structural truth" requirement already.

## 5. Database Flow

`step06PersistAssets` uses `prisma.contentAsset.upsert` keyed on the real domain-identity constraint `(workflowInstanceId, day, platform, contentType)` — a Phase 20 fix, already idempotent under step retry.

## 6. Credit Flow — **real defect found**

`credit-ledger.service.ts.recordUsage()` combines "check balance" and "write consumption" into one atomic transaction (locks the `Workspace` row `FOR UPDATE`, computes `sum(AICredit) - sum(AIUsage)`, and either writes a `SUCCEEDED` usage row with `creditsConsumed > 0` or a `BLOCKED_BY_CREDIT_LIMIT` row with `creditsConsumed: 0` then throws).

Each AI-bearing step handler calls `recordUsage()` **before** `provider.complete()`. Since `runStepWithRetry` retries the **entire step handler** (not just the provider call) on a transient `UpstreamProviderError`, a transient provider failure that succeeds on attempt 2 or 3 causes `recordUsage()` to run 2–3 times for what the business considers one logical action — deducting credits 2–3× instead of once. Confirmed by static trace of `runStepWithRetry`'s loop (`workflow-engine.service.ts:219-252`) calling `step.handler(ctx)` fresh on every attempt, and `step02BuildStrategy`/`step03GeneratePillars`/`step04GenerateCalendar` each unconditionally calling `recordUsage()` as their first line.

This directly violates this phase's own Section 12 requirement ("must not accidentally deduct credits twice") and is fixed in this phase (see certification doc Section 12/14) by splitting `recordUsage` into a pre-flight balance check (no write) and a post-success charge (write only after the provider call succeeds and output validates).

## 7. Auth Flow

Standard JWT bearer auth middleware (established in earlier phases, not re-audited in depth here since unchanged) gates every route including workflow-trigger routes. `req.auth.workspaceId`/`req.auth.userId` are the identity fields threaded into `recordUsage`/`AIProviderPort` calls.

## 8. Tenant Flow

`AICredit`/`AIUsage` are both scoped by `workspaceId` (Prisma schema, confirmed via `credit-ledger.service.ts`'s `where: { workspaceId }` on every query). No cross-tenant read path exists in the ledger service itself — isolation depends on the same workspace-scoping discipline already certified for other resources in Phases 18-20.

## 9. Error Flow

`UpstreamProviderError` (transient, retried) vs `ValidationError` (permanent, not retried) is the complete taxonomy for AI-related failures today. `OpenAIAdapter.complete()` catches all SDK errors and rewraps as `UpstreamProviderError` except an already-thrown `UpstreamProviderError` (empty-completion case) — meaning **every** OpenAI SDK failure (auth error, rate limit, 5xx, network error, malformed response) is currently treated as **transient and retried identically**, including a 401 invalid-API-key error, which is actually permanent and retrying it 3× wastes latency without ever succeeding. This is a real, if minor, gap: no error-code-based retryable/non-retryable classification exists inside the adapter (Section 9's requirement).

## 10. Current Risks

1. **Credit double/triple-charging on transient AI failure** (Section 6) — real defect, fixed this phase.
2. **No adapter-level timeout** — relies on SDK default; not verified against app's own retry budget.
3. **No retryable/non-retryable error classification inside `OpenAIAdapter`** — auth/permanent provider errors are retried identically to transient ones (wasted latency, not a correctness bug, since eventual `FAILED` state is still correct).
4. **`ai_requests_total` metric has no dimensions** (no tenant, model, latency, error category) — Section 24's observability requirement is only partially met today.
5. **No idempotency key sent to OpenAI** — if a request actually reaches OpenAI and the response is lost in transit before this app processes it, a retry creates a genuinely new completion (billed twice on OpenAI's side) rather than being deduplicated by the provider. Out of scope to fix without a real key to test against; documented as a residual risk.

## 11. Current Gaps (relative to Phase 24's 20 objectives)

| Objective | Gap |
|---|---|
| AI_TIMEOUT_HANDLING | No explicit timeout configured or previously measured |
| AI_RETRY_POLICY | Step-level retry exists and is tested (`workflow-failure.integration.test.ts`); adapter-level error classification does not |
| AI_MALFORMED_OUTPUT_HANDLING | Schema validation exists; never tested against genuinely malformed/empty/oversized provider output specifically (only ever exercised via synthetic `ValidationError` throws) |
| AI_CREDIT_ENFORCEMENT / FAILED AI REQUEST BILLING | Double-charge defect (Section 6) — fixed this phase |
| AI_AUDITABILITY | Only a bare success/fail counter; no structured per-request audit record with request ID |
| REAL_AI_PROVIDER | Never executed against the real OpenAI API in this or any prior phase — `AI_PROVIDER=openai` path is structurally complete but has zero real-execution evidence |

No production behavior was modified during this audit pass itself; the credit-charge-ordering defect identified in Section 6 is fixed as tracked, tested work in this phase's certification (not silently folded into the audit).
