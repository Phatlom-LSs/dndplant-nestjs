-- AlterTable
ALTER TABLE "userdata" ALTER COLUMN "hashedpassword" DROP DEFAULT,
ALTER COLUMN "hashedpassword" SET DATA TYPE TEXT;
