-- Phase 28 Track A: recurring workflow schedules (ScheduledWorkflow/ScheduleIntervalUnit).
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB).

-- CreateEnum
CREATE TYPE "ScheduleIntervalUnit" AS ENUM ('MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "scheduled_workflows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "workflowDefinitionKey" TEXT NOT NULL,
    "businessProfileId" UUID,
    "createdByUserId" UUID,
    "name" TEXT NOT NULL,
    "intervalUnit" "ScheduleIntervalUnit" NOT NULL,
    "intervalValue" INTEGER NOT NULL DEFAULT 1,
    "timeOfDay" TEXT,
    "dayOfWeek" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "input" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_workflows_enabled_nextRunAt_idx" ON "scheduled_workflows"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "scheduled_workflows_workspaceId_idx" ON "scheduled_workflows"("workspaceId");

-- AddForeignKey
ALTER TABLE "scheduled_workflows" ADD CONSTRAINT "scheduled_workflows_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
