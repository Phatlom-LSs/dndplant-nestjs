-- CreateTable
CREATE TABLE "userdata" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR NOT NULL DEFAULT '',
    "password" VARCHAR NOT NULL DEFAULT '',

    CONSTRAINT "userdata_pkey" PRIMARY KEY ("id")
);
