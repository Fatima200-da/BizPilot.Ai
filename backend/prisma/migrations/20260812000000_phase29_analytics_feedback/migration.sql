-- Phase 29: product analytics (ProductEvent) + customer feedback (Feedback) + 3 new
-- NotificationType values (WORKFLOW_RETRYING, SCHEDULED_WORKFLOW_COMPLETED, PAYMENT_FAILED).
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB).

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('BUG', 'IDEA', 'QUESTION', 'GENERAL');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'WORKFLOW_RETRYING';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_WORKFLOW_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';

-- CreateTable
CREATE TABLE "product_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID,
    "userId" UUID,
    "eventName" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_events_workspaceId_eventName_createdAt_idx" ON "product_events"("workspaceId", "eventName", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_eventName_createdAt_idx" ON "product_events"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_userId_createdAt_idx" ON "product_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_workspaceId_createdAt_idx" ON "feedback"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_status_createdAt_idx" ON "feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "feedback_type_createdAt_idx" ON "feedback"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
