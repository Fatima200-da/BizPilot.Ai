-- AlterTable
ALTER TABLE "backup_runs" ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restoreDurationMs" INTEGER,
ADD COLUMN     "restoreVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "restoreVerifiedOk" BOOLEAN,
ADD COLUMN     "restoreVerifyError" TEXT,
ADD COLUMN     "s3Bucket" TEXT,
ADD COLUMN     "s3UploadError" TEXT,
ADD COLUMN     "s3Uploaded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "s3UploadedAt" TIMESTAMP(3);
