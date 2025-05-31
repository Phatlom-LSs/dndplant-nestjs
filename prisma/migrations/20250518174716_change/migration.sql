/*
  Warnings:

  - You are about to drop the column `password` on the `userdata` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "userdata" DROP COLUMN "password",
ADD COLUMN     "hashedpassword" VARCHAR NOT NULL DEFAULT '';
