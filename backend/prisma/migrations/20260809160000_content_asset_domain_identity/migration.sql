-- Phase 20 Section 8.1: enforce the real domain identity of a generated
-- ContentAsset — (workflowInstanceId, day, platform, contentType), not
-- (workflowInstanceId, day) alone (a real content calendar can legitimately
-- schedule more than one piece on the same day across different platforms).
-- This makes a retried persist_assets step (marketing-autopilot.steps.ts)
-- safely idempotent via upsert rather than able to create duplicate rows.
CREATE UNIQUE INDEX "content_assets_workflowInstanceId_day_platform_contentType_key" ON "content_assets"("workflowInstanceId", "day", "platform", "contentType");
