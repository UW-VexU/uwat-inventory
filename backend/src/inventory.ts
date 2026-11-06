import type { Prisma } from '@prisma/client';
import {
  BOX_CODE_PATTERN,
  CATEGORIES,
  nextBoxCode,
  normaliseBoxCode,
  parseDescription,
  type BagSummary,
  type InventorySnapshot,
  type PartSummary,
  type StockEventView,
} from '@uwat/shared';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './db';
import { ApiError, isUniqueViolation, notFound, parse } from './http';
import { addStock, countStock, removeBag, removeBagInTx, takeStock, undoEvent, UNDOABLE_TYPES } from './stock';

type Tx = Prisma.TransactionClient;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish();

const requestId = z.string().min(8).max(64).optional();
const note = optionalText(500);

const amountBody = z.object({ amount: z.number().int().positive().max(1_000_000), note, requestId });
const countBody = z.object({ counted: z.number().int().min(0).max(10_000_000), note, requestId });

const intakeBody = z.object({
  partId: z.string().optional(),
  partNumber: optionalText(80),
  mfrPartNumber: optionalText(80),
  description: optionalText(300),
  category: z.enum(CATEGORIES).optional(),
  quantity: z.number().int().min(0).max(10_000_000),
  boxId: z.string().nullish(),
  project: optionalText(120),
  minQty: z.number().int().min(0).nullish(),
  labelKey: optionalText(200),
  force: z.boolean().optional(),
  requestId,
});

const partPatch = z.object({
  partNumber: optionalText(80),
  mfrPartNumber: optionalText(80),
  description: z.string().trim().min(1).max(300).optional(),
  category: z.enum(CATEGORIES).optional(),
  package: optionalText(40),
  minQty: z.number().int().min(0).nullish(),
  notes: optionalText(1000),
});

const bagPatch = z.object({ boxId: z.string().nullish(), project: optionalText(120) });

const boxBody = z.object({
  code: z.string().optional(),
  label: optionalText(120),
  count: z.number().int().min(1).max(100).optional(),
});

const boxPatch = z.object({ code: z.string().optional(), label: optionalText(120) });

const eventsQuery = z.object({
  partId: z.string().optional(),
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function validBoxCode(raw: string): string {
  const code = normaliseBoxCode(raw);
  if (!BOX_CODE_PATTERN.test(code)) {
    throw new ApiError(422, 'invalid', 'Box codes use letters, numbers and dashes, up to 16 characters.');
  }
  return code;
}

const activeBags = {
  where: { archivedAt: null },
  include: { box: { select: { id: true, code: true } } },
  orderBy: { createdAt: 'asc' },
} satisfies Prisma.Part$bagsArgs;

type PartRow = Prisma.PartGetPayload<{ include: { bags: typeof activeBags } }>;

function toSummary(part: PartRow): PartSummary {
  const bags: BagSummary[] = part.bags.map((bag) => ({
    id: bag.id,
    quantity: bag.quantity,
    box: bag.box,
    project: bag.project,
    tagUid: bag.tagUid,
    updatedAt: bag.updatedAt.toISOString(),
  }));
  const latest = part.bags.reduce((max, bag) => Math.max(max, bag.updatedAt.getTime()), part.updatedAt.getTime());
  return {
    id: part.id,
    partNumber: part.partNumber,
    mfrPartNumber: part.mfrPartNumber,
    description: part.description,
    category: part.category,
    package: part.package,
    minQty: part.minQty,
    notes: part.notes,
    total: part.bags.reduce((sum, bag) => sum + bag.quantity, 0),
    bags,
    updatedAt: new Date(latest).toISOString(),
  };
}

export async function loadSnapshot(): Promise<InventorySnapshot> {
  const [parts, boxes] = await Promise.all([
    prisma.part.findMany({ where: { archivedAt: null }, include: { bags: activeBags } }),
    prisma.box.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { bags: { where: { archivedAt: null } } } } },
    }),
  ]);
  return {
    parts: parts.map(toSummary),
    boxes: boxes.map((box) => ({ id: box.id, code: box.code, label: box.label, bagCount: box._count.bags })),
    generatedAt: new Date().toISOString(),
  };
}

async function partSummary(id: string): Promise<PartSummary> {
  const part = await prisma.part.findUnique({ where: { id }, include: { bags: activeBags } });
  if (!part) throw notFound('Part');
  return toSummary(part);
}

async function partForBag(bagId: string): Promise<PartSummary> {
  const bag = await prisma.bag.findUnique({ where: { id: bagId }, select: { partId: true } });
  if (!bag) throw notFound('Bag');
  return partSummary(bag.partId);
}

async function requireBox(tx: Tx, boxId: string) {
  const box = await tx.box.findUnique({ where: { id: boxId } });
  if (!box) throw notFound('Box');
  return box;
}

export interface BagDetails {
  partId?: string | undefined;
  partNumber?: string | null | undefined;
  mfrPartNumber?: string | null | undefined;
  description?: string | null | undefined;
  category?: string | undefined;
  minQty?: number | null | undefined;
}

/** Matches on the DigiKey number first, then the manufacturer's. Creates the part if it's new. */
export async function findOrCreatePart(tx: Tx, details: BagDetails) {
  const { partId, partNumber, mfrPartNumber, description } = details;

  let part = partId ? await tx.part.findUnique({ where: { id: partId } }) : null;
  if (partId && !part) throw notFound('Part');
  if (!part && partNumber) {
    part = await tx.part.findFirst({ where: { partNumber: { equals: partNumber, mode: 'insensitive' } } });
  }
  if (!part && mfrPartNumber) {
    part = await tx.part.findFirst({
      where: { mfrPartNumber: { equals: mfrPartNumber, mode: 'insensitive' }, archivedAt: null },
    });
  }

  if (part) {
    const fillIn = {
      archivedAt: null,
      ...(!part.mfrPartNumber && mfrPartNumber ? { mfrPartNumber } : {}),
      ...(!part.partNumber && partNumber ? { partNumber } : {}),
    };
    return tx.part.update({ where: { id: part.id }, data: fillIn });
  }

  const text = description ?? partNumber ?? mfrPartNumber;
  if (!text) throw new ApiError(422, 'invalid', 'A new part needs a description or part number.');
  const parsed = parseDescription(text);
  return tx.part.create({
    data: {
      partNumber: partNumber ?? null,
      mfrPartNumber: mfrPartNumber ?? null,
      description: text,
      category: details.category ?? parsed.category,
      package: parsed.package,
      minQty: details.minQty ?? null,
    },
  });
}

function eventView(event: EventRow): StockEventView {
  return {
    id: event.id,
    type: event.type,
    delta: event.delta,
    quantityAfter: event.quantityAfter,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
    user: event.user,
    part: event.part,
    bagId: event.bagId,
    boxCode: event.boxCode,
    undoOfId: event.undoOfId,
    undone: event.undoneBy !== null,
    canUndo: UNDOABLE_TYPES.includes(event.type) && event.undoneBy === null,
  };
}

const eventInclude = {
  user: { select: { login: true, name: true, avatarUrl: true } },
  part: { select: { id: true, partNumber: true, description: true } },
  undoneBy: { select: { id: true } },
} satisfies Prisma.StockEventInclude;

type EventRow = Prisma.StockEventGetPayload<{ include: typeof eventInclude }>;

export function inventoryRoutes(): Router {
  const router = Router();
  const actor = (userId: string, body: { note?: string | null | undefined; requestId?: string | undefined }) => ({
    userId,
    note: body.note,
    requestId: body.requestId,
  });

  router.get('/inventory', async (_req, res) => {
    res.json(await loadSnapshot());
  });

  router.post('/intake', async (req, res) => {
    const body = parse(intakeBody, req.body);
    const userId = req.user!.id;

    if (body.requestId) {
      const earlier = await prisma.stockEvent.findUnique({ where: { requestId: body.requestId } });
      if (earlier) return res.json({ part: await partSummary(earlier.partId), bagId: earlier.bagId });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (body.labelKey && !body.force) {
        const repeat = await tx.bag.findFirst({
          where: { labelKey: body.labelKey, archivedAt: null },
          include: { box: true },
        });
        if (repeat) {
          const where = repeat.box ? ` in ${repeat.box.code}` : '';
          throw new ApiError(409, 'duplicate_label', `This looks like a bag already added${where}.`, {
            bagId: repeat.id,
            partId: repeat.partId,
          });
        }
      }

      const box = body.boxId ? await requireBox(tx, body.boxId) : null;
      const part = await findOrCreatePart(tx, body);
      const bag = await tx.bag.create({
        data: {
          partId: part.id,
          boxId: box?.id ?? null,
          quantity: body.quantity,
          project: body.project ?? null,
          labelKey: body.labelKey ?? null,
        },
      });
      await tx.stockEvent.create({
        data: {
          type: 'INTAKE',
          bagId: bag.id,
          partId: part.id,
          userId,
          delta: body.quantity,
          quantityAfter: body.quantity,
          boxCode: box?.code ?? null,
          requestId: body.requestId ?? null,
        },
      });
      return { partId: part.id, bagId: bag.id };
    });
    res.status(201).json({ part: await partSummary(result.partId), bagId: result.bagId });
  });

  router.patch('/parts/:id', async (req, res) => {
    const body = parse(partPatch, req.body);
    try {
      await prisma.part.update({ where: { id: req.params.id }, data: body });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'duplicate_part', 'Another part already uses that part number.');
      }
      throw error;
    }
    res.json({ part: await partSummary(req.params.id) });
  });

  router.delete('/parts/:id', async (req, res) => {
    const { id } = req.params;
    await prisma.$transaction(async (tx) => {
      const part = await tx.part.findUnique({ where: { id }, include: { bags: { where: { archivedAt: null } } } });
      if (!part) throw notFound('Part');
      for (const bag of part.bags) await removeBagInTx(tx, bag.id, { userId: req.user!.id, note: 'Part deleted' });
      await tx.part.update({ where: { id }, data: { archivedAt: new Date() } });
    });
    res.json({ ok: true });
  });

  router.post('/bags/:id/take', async (req, res) => {
    const body = parse(amountBody, req.body);
    const event = await takeStock(req.params.id, body.amount, actor(req.user!.id, body));
    res.json({ part: await partForBag(req.params.id), eventId: event.id });
  });

  router.post('/bags/:id/add', async (req, res) => {
    const body = parse(amountBody, req.body);
    const event = await addStock(req.params.id, body.amount, actor(req.user!.id, body));
    res.json({ part: await partForBag(req.params.id), eventId: event.id });
  });

  router.post('/bags/:id/count', async (req, res) => {
    const body = parse(countBody, req.body);
    const event = await countStock(req.params.id, body.counted, actor(req.user!.id, body));
    res.json({ part: await partForBag(req.params.id), eventId: event.id });
  });

  router.patch('/bags/:id', async (req, res) => {
    const body = parse(bagPatch, req.body);
    const { id } = req.params;
    await prisma.$transaction(async (tx) => {
      const bag = await tx.bag.findUnique({ where: { id }, include: { box: true } });
      if (!bag || bag.archivedAt) throw notFound('Bag');

      const moving = body.boxId !== undefined && body.boxId !== bag.boxId;
      const target = moving && body.boxId ? await requireBox(tx, body.boxId) : null;
      await tx.bag.update({
        where: { id },
        data: {
          ...(moving ? { boxId: target?.id ?? null } : {}),
          ...(body.project !== undefined ? { project: body.project } : {}),
        },
      });
      if (moving) {
        await tx.stockEvent.create({
          data: {
            type: 'MOVE',
            bagId: id,
            partId: bag.partId,
            userId: req.user!.id,
            delta: 0,
            quantityAfter: bag.quantity,
            boxCode: target?.code ?? null,
            note: `${bag.box?.code ?? 'No box'} → ${target?.code ?? 'No box'}`,
          },
        });
      }
    });
    res.json({ part: await partForBag(id) });
  });

  router.delete('/bags/:id', async (req, res) => {
    const event = await removeBag(req.params.id, { userId: req.user!.id });
    res.json({ part: await partForBag(req.params.id), eventId: event.id });
  });

  router.post('/boxes', async (req, res) => {
    const body = parse(boxBody, req.body);
    const boxes = await prisma.$transaction(async (tx) => {
      if (body.code) {
        return [await tx.box.create({ data: { code: validBoxCode(body.code), label: body.label ?? null } })];
      }
      const codes = (await tx.box.findMany({ select: { code: true } })).map((box) => box.code);
      const created = [];
      for (let i = 0; i < (body.count ?? 1); i += 1) {
        const code = nextBoxCode(codes);
        codes.push(code);
        created.push(await tx.box.create({ data: { code, label: body.label ?? null } }));
      }
      return created;
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ApiError(409, 'duplicate_box', 'That box code is already in use.');
      throw error;
    });
    res.status(201).json({ boxes });
  });

  router.patch('/boxes/:id', async (req, res) => {
    const body = parse(boxPatch, req.body);
    try {
      const box = await prisma.box.update({
        where: { id: req.params.id },
        data: {
          ...(body.code ? { code: validBoxCode(body.code) } : {}),
          ...(body.label !== undefined ? { label: body.label } : {}),
        },
      });
      res.json({ box });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'duplicate_box', 'That box code is already in use.');
      throw error;
    }
  });

  router.delete('/boxes/:id', async (req, res) => {
    const { id } = req.params;
    await prisma.$transaction(async (tx) => {
      await requireBox(tx, id);
      const bags = await tx.bag.count({ where: { boxId: id, archivedAt: null } });
      if (bags > 0) {
        throw new ApiError(409, 'box_not_empty', `Move the ${bags === 1 ? 'bag' : `${bags} bags`} out first.`);
      }
      await tx.box.delete({ where: { id } });
    });
    res.json({ ok: true });
  });

  router.get('/events', async (req, res) => {
    const { partId, before, limit } = parse(eventsQuery, req.query);
    const events = await prisma.stockEvent.findMany({
      where: partId ? { partId } : {},
      include: eventInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    });
    const page = events.slice(0, limit);
    res.json({ events: page.map(eventView), nextCursor: events.length > limit ? page.at(-1)?.id : null });
  });

  router.post('/events/:id/undo', async (req, res) => {
    const event = await undoEvent(req.params.id, { userId: req.user!.id });
    res.json({ part: await partSummary(event.partId) });
  });

  return router;
}
