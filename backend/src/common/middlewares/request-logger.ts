import type { NextFunction, Request, Response } from 'express';
import { recordHttpRequest } from '../observability/metrics';

/**
 * Phase 16 Section 17: lightweight MVP observability — not a platform.
 * One structured JSON line per request: requestId (Section request-context.ts,
 * already correlates with the RFC 7807 error body), method, route, status,
 * duration, and the authenticated workspace/user identifiers where present
 * (never before authentication resolves, and never any request/response
 * body content — bodies may contain passwords, tokens, or business data).
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordHttpRequest(res.statusCode, durationMs);
    const entry = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: res.locals.requestId as string | undefined,
      method: req.method,
      route: req.route ? `${req.baseUrl}${(req.route as { path: string }).path}` : req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      workspaceId: req.auth?.workspaceId || undefined,
      userId: req.auth?.userId || undefined,
      workflowInstanceId: res.locals.workflowInstanceId as string | undefined,
      errorCode: res.locals.errorCode as string | undefined,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(entry));
  });

  next();
}
