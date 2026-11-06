-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" TEXT NOT NULL DEFAULT '',
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "topSvg" TEXT NOT NULL,
    "bottomSvg" TEXT NOT NULL,
    "schematic" BYTEA,
    "schematicType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "pads" JSONB NOT NULL,
    "packageGuess" TEXT,
    "partId" TEXT,
    "value" TEXT,
    "bomPartNumber" TEXT,
    "bomMfrNumber" TEXT,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Board_name_revision_key" ON "Board"("name", "revision");

-- CreateIndex
CREATE INDEX "Placement_partId_idx" ON "Placement"("partId");

-- CreateIndex
CREATE INDEX "Placement_bomPartNumber_idx" ON "Placement"("bomPartNumber");

-- CreateIndex
CREATE INDEX "Placement_bomMfrNumber_idx" ON "Placement"("bomMfrNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Placement_boardId_ref_key" ON "Placement"("boardId", "ref");

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
