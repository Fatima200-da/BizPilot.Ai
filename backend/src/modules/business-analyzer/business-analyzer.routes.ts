import { Router } from 'express';
import multer from 'multer';
import { authorize } from '../../common/middlewares/authorize';
import { env } from '../../config/env';
import { analyzeHandler } from './business-analyzer.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

export const businessAnalyzerRouter = Router();

// Authentication/workspace-context are already enforced by the parent
// `workspaceScoped` router (app.ts) this is mounted under.
businessAnalyzerRouter.post('/analyze', authorize('business_profile.manage'), upload.single('file'), analyzeHandler);
