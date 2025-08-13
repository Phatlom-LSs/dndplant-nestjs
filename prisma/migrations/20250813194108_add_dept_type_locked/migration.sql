-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('DEPT', 'VOID');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" "DepartmentType" NOT NULL DEFAULT 'DEPT';
