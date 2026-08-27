import type { Response } from 'express';

/**
 * API_CONTRACT.md Section 2.20's standard response envelope.
 */
export function sendData(
  res: Response,
  data: unknown,
  status = 200,
  extra?: { links?: Record<string, string> }
): void {
  const requestId = res.locals.requestId as string | undefined;
  res.status(status).json({
    data,
    ...(extra?.links ? { links: extra.links } : {}),
    meta: { requestId },
  });
}

export function sendCollection(
  res: Response,
  data: unknown[],
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number }
): void {
  const requestId = res.locals.requestId as string | undefined;
  res.status(200).json({
    data,
    pagination,
    meta: { requestId },
  });
}

export function sendNoContent(res: Response): void {
  res.status(204).send();
}
