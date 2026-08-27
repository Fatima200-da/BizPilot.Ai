-- Phase 29 Section 9: real dead-letter job admin operations — CANCELLED is a
-- distinct terminal state from FAILED (exhausted retries) so reliability
-- metrics never conflate 'the system gave up' with 'an operator cancelled it'.
-- Generated via: prisma migrate diff --from-url <real DATABASE_URL> --to-schema-datamodel
-- ./prisma/schema.prisma --script, then hand-placed here and applied via 'prisma migrate
-- deploy' (bizpilot_app lacks CREATEDB, so 'migrate dev' cannot create a shadow DB).

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';
