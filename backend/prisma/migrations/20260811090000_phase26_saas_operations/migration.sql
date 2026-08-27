-- Phase 26: production SaaS operations. Adds Notification.type (the
-- specific addressable event, distinct from the existing coarse
-- `category`) plus a unique (workspaceId, type, relatedEntityId)
-- constraint for idempotent notification creation; ScheduledJobRun, an
-- observable, idempotent job ledger for the monthly-credit-grant scheduler
-- and usage-alert engine (unique (jobKey, dedupeKey) is the real
-- concurrency guarantee, mirroring Phase 25's WebhookEvent pattern);
-- resumable onboarding state on the existing Settings model. Generated via
-- `prisma migrate diff --from-url <real DB> --to-schema-datamodel
-- schema.prisma --script` and applied via `prisma migrate deploy` — the
-- least-privilege application role lacks CREATEDB and cannot provision
-- Prisma's shadow database (same reasoning as Phase 25's migration).
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WELCOME', 'ONBOARDING_REMINDER', 'INVITATION_RECEIVED', 'INVITATION_ACCEPTED', 'SUBSCRIPTION_CHANGED', 'SUBSCRIPTION_CANCELED', 'SUBSCRIPTION_REACTIVATED', 'PLAN_LIMIT_WARNING', 'CREDITS_LOW', 'CREDITS_EXHAUSTED', 'WORKFLOW_COMPLETED', 'WORKFLOW_FAILED', 'APPROVAL_REQUIRED', 'SECURITY_EVENT');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "type" "NotificationType" NOT NULL;

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" TEXT NOT NULL DEFAULT 'workspace_created';

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_job_runs_jobKey_status_idx" ON "scheduled_job_runs"("jobKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_job_runs_jobKey_dedupeKey_key" ON "scheduled_job_runs"("jobKey", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_workspaceId_type_relatedEntityId_key" ON "notifications"("workspaceId", "type", "relatedEntityId");
