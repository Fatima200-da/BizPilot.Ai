import type { NextFunction, Request, Response } from 'express';
import { AppError, MalformedJsonError, PayloadTooLargeError } from '../errors/app-error';
import { recordAuthFailure, recordDatabaseError } from '../observability/metrics';

/**
 * body-parser/raw-body throw plain `http-errors`-style objects (not
 * AppError) tagged with a stable `.type` string for each failure mode —
 * these must be recognized explicitly or they fall through to a generic,
 * wrong-status 500. Phase 19 found a live example of exactly this: a >2MB
 * request body produced a 500 instead of the correct 413, because only the
 * malformed-JSON case (Phase 18) had been mapped. Keyed by `type` rather
 * than error subclass so the next body-parser failure mode found this way
 * is a one-line addition, not a new special case.
 */
const BODY_PARSER_ERROR_TYPES: Record<string, () => AppError> = {
  'entity.parse.failed': () => new MalformedJsonError(),
  'entity.too.large': () => new PayloadTooLargeError(),
};

function resolveBodyParserError(err: unknown): AppError | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  const type = (err as { type?: unknown }).type;
  if (typeof type !== 'string') return undefined;
  return BODY_PARSER_ERROR_TYPES[type]?.();
}

/**
 * API_CONTRACT.md Section 1.7's Error Handling Pipeline: known AppErrors map
 * to their designated status + RFC 7807 body; anything unexpected maps to
 * 500 with full internal detail logged server-side only, never leaked in
 * the response body.
 */

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.locals.requestId as string | undefined;

  const resolvedErr = resolveBodyParserError(err) ?? err;

  if (resolvedErr instanceof AppError) {
    if (resolvedErr.code.startsWith('AUTH_')) recordAuthFailure();
    // Phase 30 Track E.10: correlates the structured access log
    // (request-logger.ts) with WHICH error actually fired — previously
    // the access log only ever recorded the HTTP status, never the real
    // error code, making "find every AUTH_INVALID_CREDENTIALS this hour"
    // impossible from logs alone without cross-referencing every
    // response body.
    res.locals.errorCode = resolvedErr.code;
    res.status(resolvedErr.status).contentType('application/problem+json').json({
      type: `https://developers.bizpilot.ai/errors/${resolvedErr.code.toLowerCase()}`,
      title: resolvedErr.name === 'AppError' ? resolvedErr.code : resolvedErr.name,
      status: resolvedErr.status,
      detail: resolvedErr.message,
      instance: req.originalUrl,
      code: resolvedErr.code,
      requestId,
      ...(resolvedErr.errors ? { errors: resolvedErr.errors } : {}),
    });
    return;
  }

  // Prisma errors always carry a `clientVersion` field — a reliable,
  // dependency-free (no Prisma import needed in this common/ module) way to
  // tell "the database layer produced this" apart from any other unhandled
  // bug for metrics purposes.
  if (typeof err === 'object' && err !== null && 'clientVersion' in err) recordDatabaseError();


  console.error('[unhandled-error]', { requestId, path: req.originalUrl, error: err });

  res.locals.errorCode = 'SERVER_ERROR';
  res.status(500).contentType('application/problem+json').json({
    type: 'https://developers.bizpilot.ai/errors/server_error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',
    instance: req.originalUrl,
    code: 'SERVER_ERROR',
    requestId,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  const requestId = res.locals.requestId as string | undefined;
  res.locals.errorCode = 'NOT_FOUND';
  res.status(404).contentType('application/problem+json').json({
    type: 'https://developers.bizpilot.ai/errors/not_found',
    title: 'Not Found',
    status: 404,
    detail: 'The requested route does not exist.',
    instance: req.originalUrl,
    code: 'NOT_FOUND',
    requestId,
  });
}
