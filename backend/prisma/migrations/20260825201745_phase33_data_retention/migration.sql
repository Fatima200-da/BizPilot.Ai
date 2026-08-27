-- CreateEnum
CREATE TYPE "PurgeStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "data_retention_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "intervalHours" INTEGER NOT NULL DEFAULT 168,
    "timeOfDay" TEXT NOT NULL DEFAULT '04:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_retention_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_retention_purge_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "PurgeStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerType" TEXT NOT NULL,
    "jobId" UUID,
    "purgedCounts" JSONB,
    "totalPurged" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_retention_purge_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_retention_schedules_name_key" ON "data_retention_schedules"("name");

-- CreateIndex
CREATE INDEX "data_retention_schedules_enabled_nextRunAt_idx" ON "data_retention_schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "data_retention_purge_runs_status_startedAt_idx" ON "data_retention_purge_runs"("status", "startedAt");
