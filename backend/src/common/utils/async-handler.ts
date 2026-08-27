import type { NextFunction, Request, Response } from 'express';

/**
 * The runtime dependency is Express 4 (package.json), which does not
 * auto-forward rejected promises to the error handler the way Express 5
 * does — every async route handler must be wrapped so a thrown/rejected
 * error reaches common/middlewares/error-handler.ts instead of crashing
 * the process or hanging the request.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
