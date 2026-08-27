-- Phase 27 Section 2: coarse, server-authoritative onboarding status
-- (NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED), layered on top of the
-- existing fine-grained onboardingStep tuple (unchanged from Phase 26).
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB).

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS';
