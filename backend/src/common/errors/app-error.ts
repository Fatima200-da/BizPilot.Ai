/**
 * DomainError hierarchy implementing API_CONTRACT.md Section 3's error
 * taxonomy (RFC 7807 Problem Details, extended). Every thrown error that
 * should reach the client as a structured response extends AppError; any
 * other thrown value is treated as an unexpected 500 by the error handler
 * (common/middlewares/error-handler.ts) and never leaks its internals.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: Array<{ field: string; code: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    errors?: Array<{ field: string; code: string; message: string }>
  ) {
    super(message);
    // `new.target` is the actual constructor invoked (e.g. UpstreamProviderError),
    // not always AppError itself — every subclass must report its own real
    // name so `instanceof`-adjacent `.name` checks (e.g. workflow-engine.service.ts's
    // isTransientError) and the error-handler's RFC 7807 `title` field are both correct.
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export class ValidationError extends AppError {
  constructor(errors: Array<{ field: string; code: string; message: string }>) {
    super(422, 'VALIDATION_FAILED', 'One or more fields failed validation.', errors);
  }
}

export class MalformedJsonError extends AppError {
  constructor() {
    super(400, 'VALIDATION_MALFORMED_JSON', 'Request body is not valid JSON.');
  }
}

export class PayloadTooLargeError extends AppError {
  constructor() {
    super(413, 'VALIDATION_PAYLOAD_TOO_LARGE', 'Request body exceeds the maximum allowed size.');
  }
}

export class AuthRequiredError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'AUTH_REQUIRED', message);
  }
}

export class AuthTokenInvalidError extends AppError {
  constructor(message = 'Invalid authentication token.') {
    super(401, 'AUTH_TOKEN_INVALID', message);
  }
}

export class AuthTokenExpiredError extends AppError {
  constructor(message = 'Authentication token has expired.') {
    super(401, 'AUTH_TOKEN_EXPIRED', message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
}

/**
 * Deliberately generic (never NOT_FOUND_PROJECT vs NOT_FOUND_NO_ACCESS) per
 * API_CONTRACT.md Section 2.21's anti-enumeration note: also the correct
 * error for a cross-workspace access attempt (Section 1.5) — a caller must
 * never learn a resource exists in a workspace it cannot access.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class InsufficientPermissionError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'AUTHZ_INSUFFICIENT_PERMISSION', message);
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(message: string) {
    super(409, 'BUSINESS_INVALID_STATE_TRANSITION', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT_DUPLICATE') {
    super(409, code, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests.') {
    super(429, 'RATE_LIMIT_EXCEEDED', message);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(message = 'Workspace has insufficient AI credits for this action.') {
    super(402, 'BILLING_PLAN_LIMIT_REACHED', message);
  }
}

/** Phase 25: a plan-defined limit (seats, workspaces, feature gate) was reached — distinct from InsufficientCreditsError (AI credits specifically). */
export class PlanLimitReachedError extends AppError {
  constructor(message: string) {
    super(402, 'BILLING_PLAN_LIMIT_REACHED', message);
  }
}

/** Phase 25: a workspace is DOWNGRADE_PENDING and blocked from creating more of a resource until it becomes compliant with the target plan's limits. */
export class DowngradePendingBlockedError extends AppError {
  constructor(message: string) {
    super(409, 'BILLING_DOWNGRADE_PENDING_BLOCKED', message);
  }
}

export class UpstreamProviderError extends AppError {
  constructor(message = 'An upstream provider failed or is unreachable.') {
    super(502, 'SERVER_UPSTREAM_UNAVAILABLE', message);
  }
}
