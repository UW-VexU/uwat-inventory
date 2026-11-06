import { parseImportText, type ImportRow } from '@uwat/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db';
import { parse } from './http';
import { findOrCreatePart, loadSnapshot } from './inventory';

const MAX_ROWS = 5000;

const previewBody = z.object({ text: z.string().min(1) });
const commitBody = previewBody.extend({
  skipExisting: z.boolean().default(true),
  boxId: z.string().nullish(),
});

type RowStatus = 'new' | 'adds-bag' | 'in-stock';

interface PartIndex {
  byNumber: Map<string, { bagCount: number }>;
}

async function loadPartIndex(): Promise<PartIndex> {
  const parts = await prisma.part.findMany({
    where: { partNumber: { not: null }, archivedAt: null },
    select: { partNumber: true, _count: { select: { bags: { where: { archivedAt: null } } } } },
  });
  return {
    byNumber: new Map(parts.map((part) => [(part.partNumber ?? '').toUpperCase(), { bagCount: part._count.bags }])),
  };
}

function rowStatus(row: ImportRow, index: PartIndex): RowStatus {
  const known = row.partNumber ? index.byNumber.get(row.partNumber.toUpperCase()) : undefined;
  if (!known) return 'new';
  return known.bagCount > 0 ? 'in-stock' : 'adds-bag';
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function importRoutes(): Router {
  const router = Router();

  router.post('/import/preview', async (req, res) => {
    const { text } = parse(previewBody, req.body);
    const { rows, problems } = parseImportText(text);
    const index = await loadPartIndex();
    const boxes = new Set((await prisma.box.findMany({ select: { code: true } })).map((box) => box.code));
    res.json({
      rows: rows.slice(0, MAX_ROWS).map((row) => ({ ...row, status: rowStatus(row, index) })),
      problems,
      newBoxes: [...new Set(rows.flatMap((row) => (row.boxCode && !boxes.has(row.boxCode) ? [row.boxCode] : [])))],
    });
  });

  router.post('/import/commit', async (req, res) => {
    const { text, skipExisting, boxId } = parse(commitBody, req.body);
    const { rows } = parseImportText(text);
    const index = await loadPartIndex();
    const userId = req.user!.id;
    const wanted = rows
      .slice(0, MAX_ROWS)
      .filter((row) => !(skipExisting && rowStatus(row, index) === 'in-stock'));

    const created = await prisma.$transaction(
      async (tx) => {
        const fallbackBox = boxId ? await tx.box.findUniqueOrThrow({ where: { id: boxId } }) : null;
        const boxes = new Map((await tx.box.findMany()).map((box) => [box.code, box]));

        for (const row of wanted) {
          let box = fallbackBox;
          if (row.boxCode) {
            box = boxes.get(row.boxCode) ?? (await tx.box.create({ data: { code: row.boxCode } }));
            boxes.set(row.boxCode, box);
          }
          const part = await findOrCreatePart(tx, row);
          const bag = await tx.bag.create({
            data: { partId: part.id, boxId: box?.id ?? null, quantity: row.quantity, project: row.project },
          });
          await tx.stockEvent.create({
            data: {
              type: 'INTAKE',
              bagId: bag.id,
              partId: part.id,
              userId,
              delta: row.quantity,
              quantityAfter: row.quantity,
              boxCode: box?.code ?? null,
              note: 'Imported',
            },
          });
        }
        return wanted.length;
      },
      { timeout: 120_000 },
    );
    res.json({ created, skipped: rows.length - created });
  });

  router.get('/export.csv', async (_req, res) => {
    const { parts } = await loadSnapshot();
    const header = ['P/N', 'Manufacturer P/N', 'Description', 'Category', 'Package', 'Box', 'Qty', 'Project'];
    const lines = [header.join(',')];
    for (const part of [...parts].sort((a, b) => a.description.localeCompare(b.description))) {
      const shared = [part.partNumber, part.mfrPartNumber, part.description, part.category, part.package];
      const bags = part.bags.length > 0 ? part.bags : [null];
      for (const bag of bags) {
        lines.push(
          [...shared, bag?.box?.code ?? null, bag?.quantity ?? 0, bag?.project ?? null].map(csvCell).join(','),
        );
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="uwat-inventory.csv"');
    res.send(`${lines.join('\n')}\n`);
  });

  return router;
}
