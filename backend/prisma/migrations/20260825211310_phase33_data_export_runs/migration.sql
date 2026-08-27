-- CreateTable
CREATE TABLE "data_export_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "requestedByUserId" UUID,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "filePath" TEXT,
    "sizeBytes" INTEGER,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_export_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_export_runs_workspaceId_startedAt_idx" ON "data_export_runs"("workspaceId", "startedAt");

-- AddForeignKey
ALTER TABLE "data_export_runs" ADD CONSTRAINT "data_export_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
