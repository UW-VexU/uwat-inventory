import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { addBag, OPAMP, signIn } from './helpers';

describe('adding bags', () => {
  it('turns a label into a filed part', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', { code: 'b-07' })).body.boxes[0];

    const response = await client.post('/api/intake', {
      ...OPAMP,
      quantity: 5,
      project: 'BMS/EMBEDDED',
      boxId: box.id,
    });

    expect(response.status).toBe(201);
    expect(response.body.part).toMatchObject({
      partNumber: 'LM323M-ND',
      category: 'ICs',
      package: 'SOIC-14',
      total: 5,
      bags: [{ quantity: 5, project: 'BMS/EMBEDDED', box: { code: 'B-07' } }],
    });
  });

  it("names a scanned part after its maker's number when nothing describes it", async () => {
    const client = await signIn();
    const { body } = await client.post('/api/intake', {
      partNumber: '296-29034-1-ND',
      mfrPartNumber: 'INA226AIDGSR',
      quantity: 12,
      project: 'U2, U3, U5',
    });
    expect(body.part).toMatchObject({ description: 'INA226AIDGSR', partNumber: '296-29034-1-ND', total: 12 });
  });

  it('looks up one part with its bags, and lists the boxes, for the phone', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', { code: 'B-03' })).body.boxes[0];
    const { partId } = await addBag(client, 7, { boxId: box.id });

    expect((await client.get(`/api/parts/${partId}`)).body.part).toMatchObject({ total: 7, bags: [{ quantity: 7, box: { code: 'B-03' } }] });
    expect((await client.get('/api/parts/nope')).status).toBe(404);
    expect((await client.get('/api/boxes')).body.boxes).toEqual([{ id: box.id, code: 'B-03', label: null, bagCount: 1 }]);
  });

  it('adds up bags of the same part', async () => {
    const client = await signIn();
    await addBag(client, 5);
    await addBag(client, 20, { partNumber: 'lm323m-nd', description: undefined });

    const { parts } = (await client.get('/api/inventory')).body;

    expect(parts).toHaveLength(1);
    expect(parts[0].total).toBe(25);
    expect(parts[0].bags).toHaveLength(2);
  });

  it('matches newer labels on the manufacturer number', async () => {
    const client = await signIn();
    await addBag(client, 5, { mfrPartNumber: 'LM324M' });
    await client.post('/api/intake', { partNumber: null, mfrPartNumber: 'LM324M', quantity: 1 });

    expect((await client.get('/api/inventory')).body.parts).toHaveLength(1);
  });

  it('fills in a manufacturer number it learns later', async () => {
    const client = await signIn();
    await addBag(client, 5);
    await addBag(client, 1, { mfrPartNumber: 'LM324M' });
    expect((await client.get('/api/inventory')).body.parts[0].mfrPartNumber).toBe('LM324M');
  });

  it('warns about a bag scanned twice, and lets you add it anyway', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    await addBag(client, 5, { labelKey: 'LM323M-ND|104669300|5', boxId: box.id });

    const repeat = await client.post('/api/intake', { ...OPAMP, quantity: 5, labelKey: 'LM323M-ND|104669300|5' });
    expect(repeat.status).toBe(409);
    expect(repeat.body.error).toMatchObject({ code: 'duplicate_label' });
    expect(repeat.body.error.message).toContain('B-01');

    const forced = await client.post('/api/intake', {
      ...OPAMP,
      quantity: 5,
      labelKey: 'LM323M-ND|104669300|5',
      force: true,
    });
    expect(forced.status).toBe(201);
    expect(forced.body.part.total).toBe(10);
  });

  it('needs something to call a new part', async () => {
    const client = await signIn();
    expect((await client.post('/api/intake', { quantity: 5 })).status).toBe(422);
  });

  it('applies a retried intake once', async () => {
    const client = await signIn();
    const body = { ...OPAMP, quantity: 5, requestId: 'intake-0001' };
    await client.post('/api/intake', body);
    const retry = await client.post('/api/intake', body);

    expect(retry.status).toBe(200);
    expect(await prisma.bag.count()).toBe(1);
  });

  it('rejects a box that does not exist, without leaving a part behind', async () => {
    const client = await signIn();
    const response = await client.post('/api/intake', { ...OPAMP, quantity: 5, boxId: 'nope' });
    expect(response.status).toBe(404);
    expect(await prisma.part.count()).toBe(0);
  });

  it('brings an archived part back', async () => {
    const client = await signIn();
    const { partId } = await addBag(client, 5);
    await client.delete(`/api/parts/${partId}`);
    await addBag(client, 2);

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe(partId);
    expect(parts[0].total).toBe(2);
  });
});

describe('editing parts', () => {
  it('saves changes', async () => {
    const client = await signIn();
    const { partId } = await addBag(client, 5);

    const response = await client.patch(`/api/parts/${partId}`, { minQty: 10, notes: ' reorder soon ', category: 'Sensors' });

    expect(response.body.part).toMatchObject({ minQty: 10, notes: 'reorder soon', category: 'Sensors' });
  });

  it('refuses a part number another part uses', async () => {
    const client = await signIn();
    const { partId } = await addBag(client, 5, { partNumber: 'A-ND' });
    await addBag(client, 5, { partNumber: 'B-ND' });

    const response = await client.patch(`/api/parts/${partId}`, { partNumber: 'B-ND' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('duplicate_part');
  });

  it('keeps a part with no bags left as out of stock', async () => {
    const client = await signIn();
    const { bagId } = await addBag(client, 5);
    await client.delete(`/api/bags/${bagId}`);

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts[0]).toMatchObject({ total: 0, bags: [] });
  });
});

describe('boxes', () => {
  it('numbers boxes in sequence', async () => {
    const client = await signIn();
    const first = (await client.post('/api/boxes', { count: 3 })).body.boxes;
    const next = (await client.post('/api/boxes', {})).body.boxes;

    expect(first.map((box: { code: string }) => box.code)).toEqual(['B-01', 'B-02', 'B-03']);
    expect(next[0].code).toBe('B-04');
  });

  it('rejects bad and repeated codes', async () => {
    const client = await signIn();
    await client.post('/api/boxes', { code: 'B-01' });

    expect((await client.post('/api/boxes', { code: 'b-01' })).status).toBe(409);
    expect((await client.post('/api/boxes', { code: 'has space' })).status).toBe(422);
  });

  it("won't delete a box with bags in it", async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    const { bagId } = await addBag(client, 5, { boxId: box.id });

    const refused = await client.delete(`/api/boxes/${box.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe('Move the bag out first.');

    await client.patch(`/api/bags/${bagId}`, { boxId: null });
    expect((await client.delete(`/api/boxes/${box.id}`)).status).toBe(200);
  });

  it('counts only bags still in use', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    const { bagId } = await addBag(client, 5, { boxId: box.id });
    await addBag(client, 5, { boxId: box.id });
    await client.delete(`/api/bags/${bagId}`);

    expect((await client.get('/api/inventory')).body.boxes[0].bagCount).toBe(1);
  });

  it('can delete a box whose only bags were removed, keeping history', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    const { bagId } = await addBag(client, 5, { boxId: box.id });
    await client.delete(`/api/bags/${bagId}`);

    expect((await client.delete(`/api/boxes/${box.id}`)).status).toBe(200);
    const { events } = (await client.get('/api/events')).body;
    expect(events[0].boxCode).toBe('B-01');
  });
});

describe('importing', () => {
  const CSV = `P/N,Desc,Qty,Cust Ref,Box
LM323M-ND,IC OPAMP GP 4 CIRCUIT 14SOIC,5,BMS/EMBEDDED,B-07
311-10KHRCT-ND,RES 10K OHM 1% 1/10W 0603,"1,000",,B-02
311-10KHRCT-ND,RES 10K OHM 1% 1/10W 0603,500,,B-03
BAD-ND,oops,lots,,`;

  it('previews without changing anything', async () => {
    const client = await signIn();
    const { rows, problems, newBoxes } = (await client.post('/api/import/preview', { text: CSV })).body;

    expect(rows).toHaveLength(3);
    expect(rows[0].status).toBe('new');
    expect(problems).toHaveLength(1);
    expect(newBoxes).toEqual(['B-07', 'B-02', 'B-03']);
    expect(await prisma.part.count()).toBe(0);
  });

  it('creates parts, bags and boxes, joining repeated part numbers', async () => {
    const client = await signIn();
    const response = await client.post('/api/import/commit', { text: CSV });
    expect(response.body).toEqual({ created: 3, skipped: 0 });

    const { parts, boxes } = (await client.get('/api/inventory')).body;
    expect(parts).toHaveLength(2);
    expect(boxes).toHaveLength(3);
    const resistor = parts.find((part: { partNumber: string }) => part.partNumber === '311-10KHRCT-ND');
    expect(resistor).toMatchObject({ total: 1500, category: 'Resistors', package: '0603' });
  });

  it("doesn't double up when the same file goes in twice", async () => {
    const client = await signIn();
    await client.post('/api/import/commit', { text: CSV });
    const again = await client.post('/api/import/commit', { text: CSV });

    expect(again.body).toEqual({ created: 0, skipped: 3 });
    expect(await prisma.bag.count()).toBe(3);
  });

  it('marks parts already in stock in the preview', async () => {
    const client = await signIn();
    await addBag(client, 5);
    const { rows } = (await client.post('/api/import/preview', { text: CSV })).body;
    expect(rows[0].status).toBe('in-stock');
  });

  it('adds to existing parts when asked', async () => {
    const client = await signIn();
    await addBag(client, 5);
    await client.post('/api/import/commit', { text: CSV, skipExisting: false });
    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts.find((part: { partNumber: string }) => part.partNumber === 'LM323M-ND').total).toBe(10);
  });

  it('reads pasted label text into a chosen box', async () => {
    const client = await signIn();
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    const text = 'P/N LM323M-ND\nDesc: IC OPAMP GP 4 CIRCUIT 14SOIC\nQTY: 5\nCUST REF: BMS/EMBEDDED\nIDX: 13';

    await client.post('/api/import/commit', { text, boxId: box.id });

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts[0].bags[0]).toMatchObject({ box: { code: 'B-01' }, project: 'BMS/EMBEDDED' });
  });

  it('exports what comes back in', async () => {
    const client = await signIn();
    await client.post('/api/import/commit', { text: CSV });
    const exported = (await client.get('/api/export.csv')).text;

    await prisma.$executeRawUnsafe('TRUNCATE "StockEvent", "Bag", "Part", "Box" CASCADE');
    await client.post('/api/import/commit', { text: exported });

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum: number, part: { total: number }) => sum + part.total, 0)).toBe(1505);
  });
});
