-- AlterTable
ALTER TABLE "Placement" ADD COLUMN     "bomDescription" TEXT,
ADD COLUMN     "dnp" BOOLEAN NOT NULL DEFAULT false;
