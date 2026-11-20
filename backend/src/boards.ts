import type { Board, Prisma } from '@prisma/client';
import {
  boardLines,
  compareRefs,
  parseBom,
  type BoardDetail,
  type BoardPad,
  type BoardSummary,
  type BoardUse,
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
const whichQuery = z.object({ partNumber: z.string().max(120).optional(), mfrPartNumber: z.string().max(120).optional() });
const linkBody = z.object({ refs: z.array(z.string().max(16)).min(1).max(500), partId: z.string().nullable() });
const placedBody = z.object({ refs: z.array(z.string().max(16)).min(1).max(500), placed: z.boolean() });

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

function toPlacementView(row: PlacementRow): PlacementView {
  return {
    ref: row.ref,
    side: row.side === 'bottom' ? 'bottom' : 'top',
    x: row.x,
    y: row.y,
    pads: row.pads as unknown as BoardPad[],
    packageGuess: row.packageGuess,
    dnp: row.dnp,
    value: row.value,
    bomDescription: row.bomDescription,
    bomPartNumber: row.bomPartNumber,
    bomMfrNumber: row.bomMfrNumber,
    placed: row.placedAt !== null,
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

const summaryFields = {
  id: true,
  name: true,
  revision: true,
  widthMm: true,
  heightMm: true,
  schematicType: true,
  createdAt: true,
  placements: { include: placementInclude },
} satisfies Prisma.BoardSelect;

type SummaryRow = Omit<Board, 'topSvg' | 'bottomSvg' | 'schematic'> & { placements: PlacementRow[] };

/** Counts parts the way the board page does: one line per distinct part, done once it's in stock. */
function toSummary(board: SummaryRow): BoardSummary {
  const lines = boardLines(board.placements.map(toPlacementView));
  return {
    id: board.id,
    name: board.name,
    revision: board.revision,
    widthMm: board.widthMm,
    heightMm: board.heightMm,
    hasSchematic: board.schematicType !== null,
    schematicType: board.schematicType,
    placementCount: board.placements.length,
    lineCount: lines.length,
    stockedCount: lines.filter((line) => line.stock > 0).length,
    placedCount: lines.filter((line) => line.placed).length,
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

  /** Where else a part is used, for telling someone which board a stray part belongs to. */
  router.get('/boards/which', async (req, res) => {
    const { partNumber, mfrPartNumber } = parse(whichQuery, req.query);
    const matches: Prisma.PlacementWhereInput[] = [];
    if (partNumber) matches.push({ bomPartNumber: { equals: partNumber, mode: 'insensitive' } });
    if (mfrPartNumber) matches.push({ bomMfrNumber: { equals: mfrPartNumber, mode: 'insensitive' } });
    if (matches.length === 0) return res.json({ boards: [] });

    const spots = await prisma.placement.findMany({
      where: { dnp: false, OR: matches },
      select: { ref: true, board: { select: { id: true, name: true, revision: true } } },
    });
    const boards = new Map<string, BoardUse>();
    for (const { ref, board } of spots) {
      const use = boards.get(board.id) ?? { boardId: board.id, boardName: board.name, revision: board.revision, refs: [] };
      use.refs.push(ref);
      boards.set(board.id, use);
    }
    res.json({ boards: [...boards.values()] });
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
    let leftEmpty = 0;

    await prisma.$transaction(async (tx) => {
      // A new BOM replaces the old one, so nothing stale is left on spots it no longer mentions.
      await tx.placement.updateMany({
        where: { boardId },
        data: { value: null, bomDescription: null, bomPartNumber: null, bomMfrNumber: null, dnp: false },
      });

      for (const row of rows) {
        const fitted = row.refs.filter((ref) => onBoard.has(ref));
        const empty = row.emptyRefs.filter((ref) => onBoard.has(ref));
        notOnBoard.push(...[...row.refs, ...row.emptyRefs].filter((ref) => !onBoard.has(ref)));

        const details = {
          value: row.value,
          bomDescription: row.description,
          bomPartNumber: row.partNumber,
          bomMfrNumber: row.mfrPartNumber,
        };
        await tx.placement.updateMany({
          where: { boardId, ref: { in: empty } },
          data: { ...details, dnp: true, partId: null },
        });
        leftEmpty += empty.length;

        if (fitted.length === 0) continue;
        const part = await findPart(row.partNumber, row.mfrPartNumber);
        await tx.placement.updateMany({
          where: { boardId, ref: { in: fitted } },
          data: { ...details, partId: part?.id ?? null },
        });
        if (part) linked += fitted.length;
        else notInStock.push({ partNumber: row.partNumber ?? row.mfrPartNumber, refs: fitted });
      }
    });
    res.json({ linked, leftEmpty, notInStock, notOnBoard: notOnBoard.sort(compareRefs), problems });
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

  /** Ticks spots off as soldered, or back. Leaves stock alone: the parts may come from an older bag. */
  router.post('/boards/:id/placed', async (req, res) => {
    const { refs, placed } = parse(placedBody, req.body);
    const updated = await prisma.placement.updateMany({
      // Spots the BOM leaves empty never get ticked.
      where: { boardId: req.params.id, ref: { in: refs }, dnp: false },
      data: { placedAt: placed ? new Date() : null },
    });
    if (updated.count === 0) throw notFound('Spot');
    res.json({ board: await loadSummary(req.params.id) });
  });

  router.delete('/boards/:id', async (req, res) => {
    await loadSummary(req.params.id);
    await prisma.board.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  });

  return router;
}
