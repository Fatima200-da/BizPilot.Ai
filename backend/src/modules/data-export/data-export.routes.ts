import { Router } from 'express';
import { authorize } from '../../common/middlewares/authorize';
import { downloadExportRunHandler, exportWorkspaceDataHandler, getExportRunHandler, listExportRunsHandler, triggerBackgroundExportHandler } from './data-export.controller';

export const dataExportRouter = Router({ mergeParams: true });
// Phase 32: the original real, synchronous full-export path — unchanged,
// still real-time for a caller that wants an immediate response.
dataExportRouter.get('/', authorize('workspace.manage'), exportWorkspaceDataHandler);
// Phase 33 Track L: the real background variant — never blocks the HTTP
// connection, safe for a large workspace, real job-queue-backed.
dataExportRouter.post('/background', authorize('workspace.manage'), triggerBackgroundExportHandler);
dataExportRouter.get('/runs', authorize('workspace.manage'), listExportRunsHandler);
dataExportRouter.get('/runs/:runId', authorize('workspace.manage'), getExportRunHandler);
dataExportRouter.get('/runs/:runId/download', authorize('workspace.manage'), downloadExportRunHandler);
