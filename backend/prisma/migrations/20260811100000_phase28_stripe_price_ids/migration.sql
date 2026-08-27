-- Phase 28 Track B: real Stripe Price ID columns on subscription_plans.
-- Nullable by design — populated only once a real Stripe product/price
-- exists in a real Stripe account (never fabricated).
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB).

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "stripePriceIdAnnual" TEXT,
ADD COLUMN     "stripePriceIdMonthly" TEXT;
