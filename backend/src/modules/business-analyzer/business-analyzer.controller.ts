import type { NextFunction, Request, Response } from 'express';
import { sendData } from '../../common/response';
import { ValidationError } from '../../common/errors/app-error';
import { computeSummary, parseCsvBuffer } from './business-analyzer.service';

// Fully synchronous (CSV parsing has no I/O) — Express 4 catches synchronous
// throws in route handlers natively, so this deliberately skips asyncHandler
// rather than wrapping a non-async operation in an unnecessary Promise.
export function analyzeHandler(req: Request, res: Response, _next: NextFunction): void {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    throw new ValidationError([{ field: 'file', code: 'REQUIRED', message: 'A CSV file is required (multipart field name: "file").' }]);
  }
  if (!file.originalname.toLowerCase().endsWith('.csv') && file.mimetype !== 'text/csv') {
    throw new ValidationError([
      { field: 'file', code: 'UNSUPPORTED_TYPE', message: 'Only .csv files are supported at this time (XLSX is a known gap — see docs).' },
    ]);
  }

  const rows = parseCsvBuffer(file.buffer);
  const summary = computeSummary(rows);
  sendData(res, summary, 200);
}
