import type { Board, Prisma } from '@prisma/client';
import {
  compareRefs,
  parseBom,
  type BoardDetail,
  type BoardPad,
  type BoardSummary,
  type PlacementGeometry,
  type PlacementView,
} from '@uwat/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { requireUser } from './auth';
import type { Config } from './config';
import { prisma } from './db';
import { parseGerbers, type ParsedBoard } from './gerber';
import { ApiError, notFound, parse } from './http';

const SCHEMATIC_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

const uploadBody = z.object({
  files: z
    .array(z.object({ name: z.string().max(300), text: z.string() }))
    .min(1)
    .max(64),
  replace: z.boolean().optional(),
});

const bomBody = z.object({ text: z.string().min(1) });
const linkBody = z.object({ refs: z.array(z.string().max(16)).min(1).max(500), partId: z.string().nullable() });

const counted = {
  _count: { select: { placements: true } },
  placements: { where: { partId: { not: null } }, select: { id: true } },
} satisfies Prisma.BoardInclude;

type CountedBoard = Omit<Board, 'topSvg' | 'bottomSvg' | 'schematic'> & {
  _count: { placements: number };
  placements: { id: string }[];
};

const summaryFields = {
  id: true,
  name: true,
  revision: true,
  widthMm: true,
  heightMm: true,
  schematicType: true,
  createdAt: true,
  ...counted,
} satisfies Prisma.BoardSelect;

function toSummary(board: CountedBoard): BoardSummary {
  return {
    id: board.id,
    name: board.name,
    revision: board.revision,
    widthMm: board.widthMm,
    heightMm: board.heightMm,
    hasSchematic: board.schematicType !== null,
    schematicType: board.schematicType,
    placementCount: board._count.placements,
    linkedCount: board.placements.length,
  };
}

async function loadSummary(id: string): Promise<BoardSummary> {
  const board = await prisma.board.findUnique({ where: { id }, select: summaryFields });
  if (!board) throw notFound('Board');
  return toSummary(board);
}

function placementData(placement: PlacementGeometry) {
  return {
    side: placement.side,
    x: placement.x,
    y: placement.y,
    pads: placement.pads as unknown as Prisma.InputJsonValue,
    packageGuess: placement.packageGuess,
  };
}

function boardData(parsed: ParsedBoard) {
  return {
    widthMm: parsed.widthMm,
    heightMm: parsed.heightMm,
    topSvg: parsed.topSvg,
    bottomSvg: parsed.bottomSvg,
  };
}

/** A new revision keeps links for spots that still exist, so nobody has to redo them. */
async function replaceBoard(id: string, parsed: ParsedBoard) {
  const refs = parsed.placements.map((placement) => placement.ref);
  await prisma.$transaction(async (tx) => {
    await tx.board.update({ where: { id }, data: boardData(parsed) });
    await tx.placement.deleteMany({ where: { boardId: id, ref: { notIn: refs } } });
    for (const placement of parsed.placements) {
      await tx.placement.upsert({
        where: { boardId_ref: { boardId: id, ref: placement.ref } },
        create: { boardId: id, ref: placement.ref, ...placementData(placement) },
        update: placementData(placement),
      });
    }
  });
}

/** Routes that take large bodies. Each signs the person in before reading the upload. */
export function boardFileRoutes(config: Config): Router {
  const router = Router();

  router.post('/boards', requireUser(config), express.json({ limit: '48mb' }), async (req, res) => {
    const { files, replace } = parse(uploadBody, req.body);
    const parsed = await parseGerbers(files);

    const existing = await prisma.board.findUnique({
      where: { name_revision: { name: parsed.name, revision: parsed.revision } },
      select: { id: true },
    });
    if (existing && !replace) {
      const label = parsed.revision ? `${parsed.name} rev ${parsed.revision}` : parsed.name;
      throw new ApiError(409, 'board_exists', `${label} is already uploaded.`, { boardId: existing.id });
    }

    if (existing) {
      await replaceBoard(existing.id, parsed);
      return res.json({ board: await loadSummary(existing.id) });
    }

    const board = await prisma.board.create({
      data: {
        name: parsed.name,
        revision: parsed.revision,
        ...boardData(parsed),
        placements: {
          create: parsed.placements.map((placement) => ({ ref: placement.ref, ...placementData(placement) })),
        },
      },
      select: { id: true },
    });
    res.status(201).json({ board: await loadSummary(board.id) });
  });

  router.put(
    '/boards/:id/schematic',
    requireUser(config),
    express.raw({ type: SCHEMATIC_TYPES, limit: '25mb' }),
    async (req, res) => {
      const id = String(req.params.id);
      const type = req.get('content-type')?.split(';')[0] ?? '';
      if (!SCHEMATIC_TYPES.includes(type) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new ApiError(415, 'bad_type', 'Schematics can be a PDF, PNG or JPEG.');
      }
      const updated = await prisma.board.updateMany({
        where: { id },
        data: { schematic: new Uint8Array(req.body), schematicType: type },
      });
      if (updated.count === 0) throw notFound('Board');
      res.json({ board: await loadSummary(id) });
    },
  );

  return router;
}

function toPlacementView(row: PlacementRow): PlacementView {
  return {
    ref: row.ref,
    side: row.side === 'bottom' ? 'bottom' : 'top',
    x: row.x,
    y: row.y,
    pads: row.pads as unknown as BoardPad[],
    packageGuess: row.packageGuess,
    value: row.value,
    bomPartNumber: row.bomPartNumber,
    part: row.part
      ? {
          id: row.part.id,
          partNumber: row.part.partNumber,
          description: row.part.description,
          total: row.part.bags.reduce((sum, bag) => sum + bag.quantity, 0),
          boxes: [...new Set(row.part.bags.flatMap((bag) => (bag.box ? [bag.box.code] : [])))].sort(compareRefs),
        }
      : null,
  };
}

const placementInclude = {
  part: {
    select: {
      id: true,
      partNumber: true,
      description: true,
      bags: { where: { archivedAt: null }, select: { quantity: true, box: { select: { code: true } } } },
    },
  },
} satisfies Prisma.PlacementInclude;

type PlacementRow = Prisma.PlacementGetPayload<{ include: typeof placementInclude }>;

async function findPart(partNumber: string | null, mfrPartNumber: string | null) {
  const part = partNumber
    ? await prisma.part.findFirst({
        where: { partNumber: { equals: partNumber, mode: 'insensitive' }, archivedAt: null },
      })
    : null;
  if (part || !mfrPartNumber) return part;
  return prisma.part.findFirst({
    where: { mfrPartNumber: { equals: mfrPartNumber, mode: 'insensitive' }, archivedAt: null },
  });
}

export function boardRoutes(): Router {
  const router = Router();

  router.get('/boards', async (_req, res) => {
    const boards = await prisma.board.findMany({ select: summaryFields, orderBy: { createdAt: 'desc' } });
    res.json({ boards: boards.map(toSummary) });
  });

  router.get('/boards/:id', async (req, res) => {
    const placements = await prisma.placement.findMany({
      where: { boardId: req.params.id },
      include: placementInclude,
    });
    const detail: BoardDetail = {
      board: await loadSummary(req.params.id),
      placements: placements.map(toPlacementView).sort((a, b) => compareRefs(a.ref, b.ref)),
    };
    res.json(detail);
  });

  for (const side of ['top', 'bottom'] as const) {
    router.get(`/boards/:id/${side}.svg`, async (req, res) => {
      const board = await prisma.board.findUnique({
        where: { id: req.params.id },
        select: { topSvg: true, bottomSvg: true },
      });
      if (!board) throw notFound('Board');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.send(side === 'top' ? board.topSvg : board.bottomSvg);
    });
  }

  router.get('/boards/:id/schematic', async (req, res) => {
    const board = await prisma.board.findUnique({
      where: { id: req.params.id },
      select: { schematic: true, schematicType: true },
    });
    if (!board?.schematic || !board.schematicType) throw notFound('Schematic');
    res.setHeader('Content-Type', board.schematicType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(Buffer.from(board.schematic));
  });

  router.post('/boards/:id/bom', async (req, res) => {
    const boardId = req.params.id;
    const { text } = parse(bomBody, req.body);
    const { rows, problems } = parseBom(text);
    await loadSummary(boardId);

    const onBoard = new Set(
      (await prisma.placement.findMany({ where: { boardId }, select: { ref: true } })).map((spot) => spot.ref),
    );
    const notOnBoard: string[] = [];
    const notInStock: { partNumber: string | null; refs: string[] }[] = [];
    let linked = 0;

    for (const row of rows) {
      const refs = row.refs.filter((ref) => onBoard.has(ref));
      notOnBoard.push(...row.refs.filter((ref) => !onBoard.has(ref)));
      if (refs.length === 0) continue;

      const part = await findPart(row.partNumber, row.mfrPartNumber);
      await prisma.placement.updateMany({
        where: { boardId, ref: { in: refs } },
        data: {
          partId: part?.id ?? null,
          value: row.value,
          bomPartNumber: row.partNumber,
          bomMfrNumber: row.mfrPartNumber,
        },
      });
      if (part) linked += refs.length;
      else notInStock.push({ partNumber: row.partNumber ?? row.mfrPartNumber, refs });
    }
    res.json({ linked, notInStock, notOnBoard: notOnBoard.sort(compareRefs), problems });
  });

  router.post('/boards/:id/link', async (req, res) => {
    const { refs, partId } = parse(linkBody, req.body);
    if (partId) {
      const part = await prisma.part.findUnique({ where: { id: partId }, select: { id: true } });
      if (!part) throw notFound('Part');
    }
    const updated = await prisma.placement.updateMany({
      where: { boardId: req.params.id, ref: { in: refs } },
      data: { partId },
    });
    if (updated.count === 0) throw notFound('Spot');
    res.json({ linked: updated.count });
  });

  router.delete('/boards/:id', async (req, res) => {
    await loadSummary(req.params.id);
    await prisma.board.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  });

  return router;
}
