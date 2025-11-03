-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "x" DROP NOT NULL,
ALTER COLUMN "y" DROP NOT NULL,
ALTER COLUMN "width" DROP NOT NULL,
ALTER COLUMN "height" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Layout" ADD COLUMN     "corelapInput" JSONB,
ADD COLUMN     "gridHeight" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gridWidth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "obstacles" JSONB;

-- CreateTable
CREATE TABLE "AldepRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gridWidth" INTEGER NOT NULL,
    "gridHeight" INTEGER NOT NULL,
    "lowerBound" TEXT NOT NULL DEFAULT 'A',
    "stripWidth" INTEGER NOT NULL DEFAULT 1,
    "seeds" INTEGER NOT NULL DEFAULT 8,
    "cellSizeMeters" DOUBLE PRECISION,
    "inputJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AldepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AldepRun_projectId_createdAt_idx" ON "AldepRun"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AldepRun" ADD CONSTRAINT "AldepRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
