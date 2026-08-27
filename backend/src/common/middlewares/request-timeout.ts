import type { NextFunction, Request, Response } from 'express';

/**
 * Phase 19 Section 11: the API must fail predictably rather than hang a
 * connection indefinitely (a client-side or upstream-provider stall must
 * not tie up a server connection forever). Sets a hard ceiling on how long
 * any single request may run; on expiry, responds with a safe, generic
 * RFC 7807 body (never a raw timeout stack) if a response hasn't already
 * started, and lets Express's own connection handling close the socket.
 */
export function requestTimeout(ms: number) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      res.status(503).contentType('application/problem+json').json({
        type: 'https://developers.bizpilot.ai/errors/request_timeout',
        title: 'Request Timeout',
        status: 503,
        detail: 'The request took too long to process.',
        code: 'SERVER_REQUEST_TIMEOUT',
        requestId: res.locals.requestId as string | undefined,
      });
    }, ms);

    res.on('finish', () => { clearTimeout(timer); });
    res.on('close', () => { clearTimeout(timer); });
    next();
  };
}
