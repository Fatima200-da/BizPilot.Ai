import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../errors/app-error';

/**
 * API_CONTRACT.md Section 1.6's Validation Pipeline, schema-validation
 * stage. Business-rule validation (uniqueness, plan limits) is a distinct,
 * later stage that lives in each module's service layer, per that section's
 * explicit reasoning (it needs live data the schema layer doesn't have).
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        code: issue.code.toUpperCase(),
        message: issue.message,
      }));
      next(new ValidationError(errors));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(query)',
        code: issue.code.toUpperCase(),
        message: issue.message,
      }));
      next(new ValidationError(errors));
      return;
    }
    // Express 5 makes req.query a getter-only property — stash the parsed,
    // typed result separately rather than reassigning req.query directly.
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}
