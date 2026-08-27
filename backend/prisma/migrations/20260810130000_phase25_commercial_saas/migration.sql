-- Phase 25: commercial SaaS productization. Adds BillingCustomer (workspace
-- <-> external billing-provider customer mapping) and WebhookEvent (inbound
-- payment-provider webhook idempotency ledger, distinct from the existing
-- outbound-integration Webhook model), plus a pendingPlanId/pendingPlanNote
-- pair on Subscription so a downgrade that would violate the target plan's
-- limits blocks (compliance-pending) rather than silently deleting data.
-- Generated via `prisma migrate diff --from-url <real DB> --to-schema-datamodel
-- schema.prisma --script` rather than `migrate dev`, because the
-- least-privilege application role (bizpilot_app) intentionally lacks
-- CREATEDB and cannot provision Prisma's shadow database — applied via
-- `prisma migrate deploy`, the same production-safe path used in CI.
-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "pendingPlanId" UUID,
ADD COLUMN     "pendingPlanNote" TEXT;

-- CreateTable
CREATE TABLE "billing_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "PaymentProvider" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_workspaceId_provider_key" ON "billing_customers"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_provider_externalCustomerId_key" ON "billing_customers"("provider", "externalCustomerId");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_externalEventId_key" ON "webhook_events"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
