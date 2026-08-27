-- Phase 27 Section 4: generic lease-based production job queue (Job/JobStatus).
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB --
-- this is the same production-safe workaround used every phase since Phase 25).

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_jobKey_status_nextRunAt_idx" ON "jobs"("jobKey", "status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_jobKey_dedupeKey_key" ON "jobs"("jobKey", "dedupeKey");
