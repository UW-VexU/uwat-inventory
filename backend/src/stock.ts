import type { EventType, Prisma, StockEvent } from '@prisma/client';
import { prisma } from './db';
import { ApiError, isUniqueViolation, notFound } from './http';

type Tx = Prisma.TransactionClient;

interface LockedBag {
  id: string;
  partId: string;
  quantity: number;
  archivedAt: Date | null;
  boxCode: string | null;
}

export const UNDOABLE_TYPES: readonly EventType[] = ['TAKE', 'ADD', 'COUNT', 'INTAKE', 'REMOVE'];

/** Holds the row until the transaction ends, so two people can't both spend the same stock. */
async function lockBag(tx: Tx, bagId: string): Promise<LockedBag> {
  const rows = await tx.$queryRaw<LockedBag[]>`
    SELECT b."id", b."partId", b."quantity", b."archivedAt",
           (SELECT x."code" FROM "Box" x WHERE x."id" = b."boxId") AS "boxCode"
    FROM "Bag" b WHERE b."id" = ${bagId} FOR UPDATE`;
  const bag = rows[0];
  if (!bag) throw notFound('Bag');
  return bag;
}

function requireActive(bag: LockedBag) {
  if (bag.archivedAt) throw new ApiError(409, 'bag_removed', 'This bag has been removed.');
}

interface Actor {
  userId: string;
  note?: string | null | undefined;
  requestId?: string | undefined;
}

/** Runs a change once. A repeat of the same requestId returns the first result. */
async function once(requestId: string | undefined, run: () => Promise<StockEvent>): Promise<StockEvent> {
  if (requestId) {
    const earlier = await prisma.stockEvent.findUnique({ where: { requestId } });
    if (earlier) return earlier;
  }
  try {
    return await run();
  } catch (error) {
    if (requestId && isUniqueViolation(error)) {
      const earlier = await prisma.stockEvent.findUnique({ where: { requestId } });
      if (earlier) return earlier;
    }
    throw error;
  }
}

async function applyDelta(
  tx: Tx,
  bag: LockedBag,
  type: EventType,
  delta: number,
  actor: Actor,
  extra: { undoOfId?: string; archivedAt?: Date | null } = {},
): Promise<StockEvent> {
  const quantityAfter = bag.quantity + delta;
  await tx.bag.update({
    where: { id: bag.id },
    data: {
      quantity: quantityAfter,
      ...(extra.archivedAt !== undefined ? { archivedAt: extra.archivedAt } : {}),
    },
  });
  return tx.stockEvent.create({
    data: {
      type,
      bagId: bag.id,
      partId: bag.partId,
      userId: actor.userId,
      delta,
      quantityAfter,
      boxCode: bag.boxCode,
      note: actor.note ?? null,
      requestId: actor.requestId ?? null,
      undoOfId: extra.undoOfId ?? null,
    },
  });
}

export function takeStock(bagId: string, amount: number, actor: Actor) {
  return once(actor.requestId, () =>
    prisma.$transaction(async (tx) => {
      const bag = await lockBag(tx, bagId);
      requireActive(bag);
      if (amount > bag.quantity) {
        throw new ApiError(409, 'not_enough', `Only ${bag.quantity} left in this bag.`, { available: bag.quantity });
      }
      return applyDelta(tx, bag, 'TAKE', -amount, actor);
    }),
  );
}

export function addStock(bagId: string, amount: number, actor: Actor) {
  return once(actor.requestId, () =>
    prisma.$transaction(async (tx) => {
      const bag = await lockBag(tx, bagId);
      requireActive(bag);
      return applyDelta(tx, bag, 'ADD', amount, actor);
    }),
  );
}

/** A count of zero difference is still recorded, as proof someone checked. */
export function countStock(bagId: string, counted: number, actor: Actor) {
  return once(actor.requestId, () =>
    prisma.$transaction(async (tx) => {
      const bag = await lockBag(tx, bagId);
      requireActive(bag);
      return applyDelta(tx, bag, 'COUNT', counted - bag.quantity, actor);
    }),
  );
}

export function removeBag(bagId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const bag = await lockBag(tx, bagId);
    requireActive(bag);
    return applyDelta(tx, bag, 'REMOVE', -bag.quantity, actor, { archivedAt: new Date() });
  });
}

export async function removeBagInTx(tx: Tx, bagId: string, actor: Actor) {
  const bag = await lockBag(tx, bagId);
  if (!bag.archivedAt) await applyDelta(tx, bag, 'REMOVE', -bag.quantity, actor, { archivedAt: new Date() });
}

export function undoEvent(eventId: string, actor: Actor) {
  return prisma
    .$transaction(async (tx) => {
      const event = await tx.stockEvent.findUnique({ where: { id: eventId }, include: { undoneBy: true } });
      if (!event) throw notFound('Change');
      if (!UNDOABLE_TYPES.includes(event.type)) {
        throw new ApiError(409, 'not_undoable', "This change can't be undone.");
      }
      if (event.undoneBy) throw new ApiError(409, 'already_undone', 'This change was already undone.');

      const bag = await lockBag(tx, event.bagId);
      if (event.type !== 'REMOVE') requireActive(bag);

      const delta = -event.delta;
      const quantityAfter = bag.quantity + delta;
      if (quantityAfter < 0) {
        throw new ApiError(409, 'not_enough', `Can't undo: only ${bag.quantity} left in this bag.`, {
          available: bag.quantity,
        });
      }

      // Undoing an intake that left the bag empty means the bag was never really there.
      let archivedAt: Date | null | undefined;
      if (event.type === 'REMOVE') archivedAt = null;
      if (event.type === 'INTAKE' && quantityAfter === 0) archivedAt = new Date();
      if (event.type === 'REMOVE') {
        await tx.part.update({ where: { id: bag.partId }, data: { archivedAt: null } });
      }

      return applyDelta(tx, bag, 'UNDO', delta, actor, { undoOfId: event.id, archivedAt });
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ApiError(409, 'already_undone', 'This change was already undone.');
      throw error;
    });
}
