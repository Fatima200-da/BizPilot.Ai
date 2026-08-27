import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * API_CONTRACT.md Section 1.3 step 1 and Section 3.3: assigns/echoes
 * X-Request-Id on every request, always present as a response header even
 * on responses that fail before JSON serialization.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.header('X-Request-Id')) ?? `req_${randomUUID()}`;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
