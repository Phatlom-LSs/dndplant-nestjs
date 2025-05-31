/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `userdata` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updateAt` to the `userdata` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "userdata" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updateAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "userdata_username_key" ON "userdata"("username");
