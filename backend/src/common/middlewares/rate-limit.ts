import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../../config/env';

/**
 * API_CONTRACT.md Section 2.19: rate limits key on identity when
 * authenticated (so limits are per-user, not per-IP, matching
 * AUTH_ARCHITECTURE.md Section 5.4's dual-keyed rationale), falling back to
 * IP for anonymous requests (e.g. login attempts).
 *
 * CLOUD_INFRASTRUCTURE.md's production deployment specifies a Redis-backed
 * limiter for multi-instance correctness; this in-memory store is the
 * documented, correct choice for MVP single-instance operation (Part 48's
 * "materially simpler operational footprint" — see completion report).
 */
export const generalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit exceeded. Please slow down.',
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

/** Stricter limit for unauthenticated auth endpoints (login/register). */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many authentication attempts. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

/**
 * Phase 19 Section 19/20: a cost guardrail distinct from `generalRateLimit`.
 * The per-action AI credit ledger (billing/credit-ledger.service.ts) already
 * hard-blocks any single request once a workspace's balance is exhausted —
 * this limiter exists for the narrower case that credit check doesn't
 * cover: a workspace with a large or refilled balance still should not be
 * able to fire an unbounded burst of expensive workflow runs (each one
 * costs real AI-provider money once a real provider is connected) in a
 * short window. Keyed by workspaceId, not userId — the guardrail is a
 * property of the tenant/workspace, not of which member is calling it.
 */
export const workflowExecutionRateLimit = rateLimit({
  windowMs: env.WORKFLOW_RATE_LIMIT_WINDOW_MS,
  max: env.WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'This workspace has started too many workflow runs in a short period. Please slow down.',
      code: 'RATE_LIMIT_WORKFLOW_EXECUTION_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

/**
 * Phase 26 Section 15: distinct, narrower limits for invitation, admin, and
 * notification traffic — each is a smaller-blast-radius surface than the
 * general API (invitations cost a seat reservation; admin routes touch
 * cross-workspace data; notification polling is high-frequency but
 * low-cost, so it gets a higher ceiling than the other two, not a stricter one).
 */
export const invitationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.workspaceId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many invitations sent from this workspace in a short period. Please slow down.',
      code: 'RATE_LIMIT_INVITATION_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many admin requests in a short period. Please slow down.',
      code: 'RATE_LIMIT_ADMIN_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

export const notificationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many notification requests in a short period. Please slow down.',
      code: 'RATE_LIMIT_NOTIFICATION_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

/** Phase 29 Section 9: the client-facing product-event endpoint is a real, cheap write on every page view — generous but bounded, so a buggy frontend loop can't flood the events table. */
export const productEventRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many events reported in a short period. Please slow down.',
      code: 'RATE_LIMIT_PRODUCT_EVENT_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});

/** Phase 29 Section 24: feedback submission — infrequent by nature, tightly bounded to prevent spam. */
export const feedbackRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).contentType('application/problem+json').json({
      type: 'https://developers.bizpilot.ai/errors/rate_limit_exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too much feedback submitted in a short period. Please slow down.',
      code: 'RATE_LIMIT_FEEDBACK_EXCEEDED',
      requestId: res.locals.requestId as string | undefined,
    });
  },
});
