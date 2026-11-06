import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { addBag, bagQuantity, signIn } from './helpers';

describe('taking and adding', () => {
  it('changes the bag and records who did it', async () => {
    const client = await signIn('connor');
    const { bagId } = await addBag(client, 10);

    const response = await client.post(`/api/bags/${bagId}/take`, { amount: 3, note: 'BMS rev 2' });

    expect(response.status).toBe(200);
    expect(response.body.part.total).toBe(7);
    const event = await prisma.stockEvent.findFirstOrThrow({ where: { type: 'TAKE' } });
    expect(event).toMatchObject({ delta: -3, quantityAfter: 7, note: 'BMS rev 2', userId: client.user.id });
  });

  it('refuses to take more than the bag holds', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 2);

    const response = await client.post(`/api/bags/${bagId}/take`, { amount: 3 });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({ code: 'not_enough', available: 2 });
    expect(await bagQuantity(bagId)).toBe(2);
  });

  it('never oversells when people take at the same moment', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 5);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.post(`/api/bags/${bagId}/take`, { amount: 1 })),
    );

    expect(results.filter((result) => result.status === 200)).toHaveLength(5);
    expect(results.filter((result) => result.status === 409)).toHaveLength(5);
    expect(await bagQuantity(bagId)).toBe(0);
    expect(await prisma.stockEvent.count({ where: { type: 'TAKE' } })).toBe(5);
  });

  it('applies a retried request once', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    const body = { amount: 2, requestId: 'retry-0001' };

    await client.post(`/api/bags/${bagId}/take`, body);
    const retry = await client.post(`/api/bags/${bagId}/take`, body);

    expect(retry.status).toBe(200);
    expect(retry.body.part.total).toBe(8);
    expect(await prisma.stockEvent.count({ where: { type: 'TAKE' } })).toBe(1);
  });

  it('applies a double click once, even when both arrive together', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    const body = { amount: 2, requestId: 'double-click' };

    const results = await Promise.all([1, 2, 3].map(() => client.post(`/api/bags/${bagId}/take`, body)));

    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(await bagQuantity(bagId)).toBe(8);
  });

  it('rejects zero, negatives and fractions', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 5);
    for (const amount of [0, -1, 1.5]) {
      expect((await client.post(`/api/bags/${bagId}/take`, { amount })).status).toBe(422);
    }
    expect(await bagQuantity(bagId)).toBe(5);
  });

  it('has a database rule against negative stock as a backstop', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 1);
    await expect(prisma.bag.update({ where: { id: bagId }, data: { quantity: -1 } })).rejects.toThrow();
  });
});

describe('counting', () => {
  it('sets the real number and logs the difference', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);

    const response = await client.post(`/api/bags/${bagId}/count`, { counted: 7 });

    expect(response.body.part.total).toBe(7);
    expect(await prisma.stockEvent.findFirstOrThrow({ where: { type: 'COUNT' } })).toMatchObject({ delta: -3 });
  });

  it('records a count that matched', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.post(`/api/bags/${bagId}/count`, { counted: 10 });
    expect(await prisma.stockEvent.findFirstOrThrow({ where: { type: 'COUNT' } })).toMatchObject({ delta: 0 });
  });
});

describe('undo', () => {
  async function lastEventId() {
    return (await prisma.stockEvent.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id;
  }

  it('reverses a take, once', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.post(`/api/bags/${bagId}/take`, { amount: 4 });
    const eventId = await lastEventId();

    expect((await client.post(`/api/events/${eventId}/undo`)).body.part.total).toBe(10);
    const again = await client.post(`/api/events/${eventId}/undo`);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_undone');
    expect(await bagQuantity(bagId)).toBe(10);
  });

  it('allows only one of two simultaneous undos', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.post(`/api/bags/${bagId}/take`, { amount: 4 });
    const eventId = await lastEventId();

    const results = await Promise.all([1, 2, 3].map(() => client.post(`/api/events/${eventId}/undo`)));

    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(await bagQuantity(bagId)).toBe(10);
  });

  it("won't undo an add once that stock has been used", async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 1);
    await client.post(`/api/bags/${bagId}/add`, { amount: 5 });
    const addId = await lastEventId();
    await client.post(`/api/bags/${bagId}/take`, { amount: 4 });

    const response = await client.post(`/api/events/${addId}/undo`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('not_enough');
    expect(await bagQuantity(bagId)).toBe(2);
  });

  it('removes a bag that was added by mistake', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);

    const response = await client.post(`/api/events/${await lastEventId()}/undo`);

    expect(response.body.part.bags).toEqual([]);
    expect((await prisma.bag.findUniqueOrThrow({ where: { id: bagId } })).archivedAt).not.toBeNull();
  });

  it('brings back a removed bag with its stock', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.delete(`/api/bags/${bagId}`);

    const response = await client.post(`/api/events/${await lastEventId()}/undo`);

    expect(response.body.part.total).toBe(10);
    expect(response.body.part.bags).toHaveLength(1);
  });

  it('brings back a deleted part through its bags', async () => {
    const client = await signIn();
    const { bagId, partId } = await addBag(client, 10);
    await client.delete(`/api/parts/${partId}`);
    expect((await client.get('/api/inventory')).body.parts).toEqual([]);

    await client.post(`/api/events/${await lastEventId()}/undo`);

    expect((await client.get('/api/inventory')).body.parts[0].total).toBe(10);
    expect(await bagQuantity(bagId)).toBe(10);
  });

  it("won't undo an undo, or a move", async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.post(`/api/bags/${bagId}/take`, { amount: 1 });
    await client.post(`/api/events/${await lastEventId()}/undo`);
    const undoId = (await prisma.stockEvent.findFirstOrThrow({ where: { type: 'UNDO' } })).id;
    expect((await client.post(`/api/events/${undoId}/undo`)).body.error.code).toBe('not_undoable');

    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    await client.patch(`/api/bags/${bagId}`, { boxId: box.id });
    const moveId = (await prisma.stockEvent.findFirstOrThrow({ where: { type: 'MOVE' } })).id;
    expect((await client.post(`/api/events/${moveId}/undo`)).body.error.code).toBe('not_undoable');
  });

  it('tells the client what can be undone', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    await client.post(`/api/bags/${bagId}/take`, { amount: 1 });
    await client.post(`/api/events/${await lastEventId()}/undo`);

    const { events } = (await client.get('/api/events')).body;

    const take = events.find((event: { type: string }) => event.type === 'TAKE');
    const undo = events.find((event: { type: string }) => event.type === 'UNDO');
    expect(take).toMatchObject({ undone: true, canUndo: false });
    expect(undo).toMatchObject({ canUndo: false });
  });
});

describe('history', () => {
  it('keeps the box a change happened in after the bag moves', async () => {
    const client = await signIn();
    const [first, second] = (await client.post('/api/boxes', { count: 2 })).body.boxes;
    const { bagId } = await addBag(client, 10, { boxId: first.id });
    await client.post(`/api/bags/${bagId}/take`, { amount: 1 });
    await client.patch(`/api/bags/${bagId}`, { boxId: second.id });

    const { events } = (await client.get('/api/events')).body;

    expect(events.find((event: { type: string }) => event.type === 'TAKE').boxCode).toBe(first.code);
    expect(events.find((event: { type: string }) => event.type === 'MOVE').note).toBe('B-01 → B-02');
  });

  it('pages newest first', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 10);
    for (let i = 0; i < 4; i += 1) await client.post(`/api/bags/${bagId}/take`, { amount: 1 });

    const first = (await client.get('/api/events?limit=3')).body;
    const second = (await client.get(`/api/events?limit=3&before=${first.nextCursor}`)).body;

    expect(first.events).toHaveLength(3);
    expect(first.events[0].quantityAfter).toBe(6);
    expect(second.events).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });
});
