import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { addBag, app, signIn, type Client } from './helpers';

const HEADER = (fn: string) => `%TF.GenerationSoftware,KiCad,Pcbnew,10.0.7*%
%TF.ProjectId,uwat-testBoard,75776174,B*%
%TF.FileFunction,${fn}*%
%FSLAX46Y46*%
G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*
%MOMM*%
%LPD*%
G01*
`;

const ROUND_RECT = `%AMRoundRect*
0 Rectangle with rounded corners*
4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*
1,1,$1+$1,$2,$3*
1,1,$1+$1,$4,$5*
1,1,$1+$1,$6,$7*
1,1,$1+$1,$8,$9*
20,1,$1+$1,$2,$3,$4,$5,0*
20,1,$1+$1,$4,$5,$6,$7,0*
20,1,$1+$1,$6,$7,$8,$9,0*
20,1,$1+$1,$8,$9,$2,$3,0*%
`;

const pad = (ref: string, pin: string, net: string, x: number, y: number) => `%TO.P,${ref},${pin}*%
%TO.N,${net}*%
X${x}000000Y${y}000000D03*
%TD*%
`;

const F_CU =
  HEADER('Copper,L1,Top') +
  ROUND_RECT +
  `%ADD10RoundRect,0.200000X-0.200000X-0.275000X0.200000X-0.275000X0.200000X0.275000X-0.200000X0.275000X0*%
%ADD11C,1.500000*%
G04 A comment that looks like a pad X1Y1D03 is ignored*
D10*
${pad('R1', '1', '+3V3', 110, -110)}%TO.P,R1,2*%
%TO.N,/SDA*%
X111650000Y-110000000D03*
%TD*%
${pad('R2', '1', '+3V3', 114, -110)}%TO.P,R2,2*%
%TO.N,/SCL*%
X115650000Y-110000000D03*
%TD*%
D11*
%TO.N,GND*%
X105000000Y-105000000D03*
%TD*%
M02*
`;

const B_CU = `${HEADER('Copper,L2,Bot')}%ADD10C,1.500000*%
D10*
${pad('TP1', '1', '/SDA', 105, -110)}M02*
`;

const OUTLINE = `${HEADER('Profile,NP')}%ADD10C,0.050000*%
D10*
X100000000Y-100000000D02*
X120000000Y-100000000D01*
X120000000Y-115000000D01*
X100000000Y-115000000D01*
X100000000Y-100000000D01*
M02*
`;

const silk = (fn: string, refs: string[]) => `${HEADER(fn)}%ADD10C,0.150000*%
D10*
${refs.map((ref) => `%TO.C,${ref}*%\nX100500000Y-100500000D02*\nX101000000Y-100500000D01*\n%TD*%\n`).join('')}M02*
`;

const FILES = [
  { name: 'test-F_Cu.gtl', text: F_CU },
  { name: 'test-B_Cu.gbl', text: B_CU },
  { name: 'test-Edge_Cuts.gm1', text: OUTLINE },
  { name: 'test-F_Silkscreen.gto', text: silk('Legend,Top', ['R1', 'R2']) },
  { name: 'test-B_Silkscreen.gbo', text: silk('Legend,Bot', ['TP1']) },
  { name: 'notes.txt', text: 'Not a gerber at all, and should be left out.' },
];

async function upload(client: Client, extra: object = {}) {
  const response = await client.post('/api/boards', { files: FILES, ...extra });
  return response;
}

async function uploaded(client: Client): Promise<string> {
  const response = await upload(client);
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body.board.id;
}

describe('uploading gerbers', () => {
  it('builds a board from the files', async () => {
    const client = await signIn();
    const response = await upload(client);

    expect(response.status).toBe(201);
    expect(response.body.board).toMatchObject({
      name: 'Test Board',
      revision: 'B',
      placementCount: 3,
      lineCount: 0,
      stockedCount: 0,
      hasSchematic: false,
    });
    expect(response.body.board.widthMm).toBeCloseTo(20, 0);
    expect(response.body.board.heightMm).toBeCloseTo(15, 0);
  });

  it('places each part relative to the top-left corner, with its nets', async () => {
    const client = await signIn();
    const id = await uploaded(client);

    const { placements } = (await client.get(`/api/boards/${id}`)).body;

    const r1 = placements.find((placement: { ref: string }) => placement.ref === 'R1');
    expect(r1.side).toBe('top');
    expect(r1.x).toBeCloseTo(10.825, 1);
    expect(r1.y).toBeCloseTo(10, 1);
    expect(r1.packageGuess).toBe('0603');
    expect(r1.pads).toHaveLength(2);
    expect(r1.pads[0]).toMatchObject({ pin: '1', net: '+3V3' });
    expect(r1.pads[0].w).toBeCloseTo(0.8);
    expect(r1.pads[0].h).toBeCloseTo(0.95);
    expect(r1.pads[1]).toMatchObject({ pin: '2', net: '/SDA' });
  });

  it('puts bottom-side parts on the bottom', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(placements.find((placement: { ref: string }) => placement.ref === 'TP1').side).toBe('bottom');
  });

  it('skips pads that belong to no part, like vias', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(placements.map((placement: { ref: string }) => placement.ref)).toEqual(['R1', 'R2', 'TP1']);
  });

  it('serves the drawings as safe images', async () => {
    const client = await signIn();
    const id = await uploaded(client);

    for (const side of ['top', 'bottom']) {
      const response = await client.get(`/api/boards/${id}/${side}.svg`);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(String(response.body)).toContain('<svg');
    }
  });

  it('explains gerbers plotted without component data', async () => {
    const client = await signIn();
    const stripped = FILES.map((file) => ({ ...file, text: file.text.replace(/%TO\.[^%]*%\n/g, '') }));

    const response = await client.post('/api/boards', { files: stripped });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('no_component_data');
    expect(response.body.error.message).toContain('KiCad');
    expect(await prisma.board.count()).toBe(0);
  });

  it('rejects files with no copper layer', async () => {
    const client = await signIn();
    const response = await client.post('/api/boards', { files: [{ name: 'readme.txt', text: 'hello' }] });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('no_copper');
  });

  it('survives a damaged file', async () => {
    const client = await signIn();
    const damaged = FILES.map((file) =>
      file.name.endsWith('.gm1') ? { ...file, text: '%%%not a gerber\u0000' } : file,
    );
    const response = await client.post('/api/boards', { files: damaged });
    expect([201, 422]).toContain(response.status);
    expect((await client.get('/api/boards')).status).toBe(200);
  });

  it("won't read a big upload from someone who isn't signed in", async () => {
    const response = await request(app).post('/api/boards').send({ files: FILES });
    expect(response.status).toBe(401);
    expect(await prisma.board.count()).toBe(0);
  });

  it('asks before replacing a board, then keeps links for spots that still exist', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 100);
    await client.post(`/api/boards/${id}/link`, { refs: ['R1', 'R2'], partId });

    const refused = await upload(client);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'board_exists', boardId: id });

    const changed = FILES.map((file) =>
      file.name.endsWith('.gtl') ? { ...file, text: file.text.replaceAll('R2,', 'R7,') } : file,
    );
    const replaced = await client.post('/api/boards', { files: changed, replace: true });
    expect(replaced.status).toBe(200);

    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    const refs = placements.map((placement: { ref: string }) => placement.ref);
    expect(refs).toEqual(['R1', 'R7', 'TP1']);
    expect(placements[0].part.id).toBe(partId);
    expect(placements[1].part).toBeNull();
  });
});

describe('linking parts to spots', () => {
  it('shows the board on the part, and the part on the board', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const box = (await client.post('/api/boxes', {})).body.boxes[0];
    const { partId } = await addBag(client, 40, { boxId: box.id });

    const linked = await client.post(`/api/boards/${id}/link`, { refs: ['R2', 'R1'], partId });
    expect(linked.body.linked).toBe(2);

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts[0].usedOn).toEqual([{ boardId: id, boardName: 'Test Board', revision: 'B', refs: ['R1', 'R2'] }]);

    const { board, placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(board).toMatchObject({ lineCount: 1, stockedCount: 1 });
    expect(placements[0].part).toMatchObject({ id: partId, total: 40, boxes: ['B-01'] });
  });

  it('can be undone', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 40);
    await client.post(`/api/boards/${id}/link`, { refs: ['R1'], partId });
    await client.post(`/api/boards/${id}/link`, { refs: ['R1'], partId: null });
    expect((await client.get('/api/inventory')).body.parts[0].usedOn).toEqual([]);
  });

  it('rejects unknown spots and parts', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 1);
    expect((await client.post(`/api/boards/${id}/link`, { refs: ['R99'], partId })).status).toBe(404);
    expect((await client.post(`/api/boards/${id}/link`, { refs: ['R1'], partId: 'nope' })).status).toBe(404);
  });

  it('keeps the part when a board is deleted', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 40);
    await client.post(`/api/boards/${id}/link`, { refs: ['R1'], partId });

    await client.delete(`/api/boards/${id}`);

    const { parts } = (await client.get('/api/inventory')).body;
    expect(parts[0]).toMatchObject({ total: 40, usedOn: [] });
    expect(await prisma.placement.count()).toBe(0);
  });
});

describe('uploading a BOM', () => {
  const BOM = `Quantity,Manufacturer Part Number,Manufacturer,DigiKey Part Number,Customer Reference
50,RC0603FR-0710KL,Yageo,311-10.0KHRCT-ND,"R1, R2"
10,TP-5000,Keystone,36-5000-ND,"TP1, TP9"`;

  it("links spots from the team's DigiKey upload file", async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 100, { partNumber: '311-10.0KHRCT-ND', description: 'RES 10K OHM 1% 1/10W 0603' });

    const { body } = await client.post(`/api/boards/${id}/bom`, { text: BOM });

    expect(body.linked).toBe(2);
    expect(body.notInStock).toEqual([{ partNumber: '36-5000-ND', refs: ['TP1'] }]);
    expect(body.notOnBoard).toEqual(['TP9']);
    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(placements[0].part.id).toBe(partId);
  });

  it('matches on the manufacturer number when the DigiKey number differs', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await addBag(client, 100, { partNumber: 'OTHER-ND', mfrPartNumber: 'RC0603FR-0710KL', description: 'RES 10K' });
    const { body } = await client.post(`/api/boards/${id}/bom`, { text: BOM });
    expect(body.linked).toBe(2);
  });

  it('links a spot by itself when its part turns up later', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await client.post(`/api/boards/${id}/bom`, { text: BOM });

    const before = (await client.get(`/api/boards/${id}`)).body.placements[2];
    expect(before).toMatchObject({ part: null, bomPartNumber: '36-5000-ND' });

    await addBag(client, 25, { partNumber: '36-5000-ND', description: 'TEST POINT PC' });

    const after = (await client.get(`/api/boards/${id}`)).body.placements[2];
    expect(after.part).toMatchObject({ partNumber: '36-5000-ND', total: 25 });
  });

  it('counts a part as in stock once a bag of it arrives, and not after it runs out', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await client.post(`/api/boards/${id}/bom`, { text: BOM });
    const counts = async () => (await client.get('/api/boards')).body.boards[0];
    expect(await counts()).toMatchObject({ lineCount: 2, stockedCount: 0 });

    const { bagId } = await addBag(client, 100, { partNumber: '311-10.0KHRCT-ND', description: 'RES 10K OHM 1% 1/10W 0603' });
    expect(await counts()).toMatchObject({ lineCount: 2, stockedCount: 1 });
    expect((await client.get(`/api/boards/${id}`)).body.board.stockedCount).toBe(1);

    await client.post(`/api/bags/${bagId}/take`, { amount: 100 });
    expect(await counts()).toMatchObject({ stockedCount: 0 });
  });

  it('names a part scanned in later from its BOM line, since bag labels carry no description', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await client.post(`/api/boards/${id}/bom`, {
      text: `Reference,Value,Description,Manufacturer Part Number,DigiKey Part Number
"R1, R2",30.1k,"FB divider bottom, 1% 0603",RC0603FR-0730K1L,311-30.1KHRCT-ND`,
    });

    const { body } = await client.post('/api/intake', {
      partNumber: '311-30.1KHRCT-ND',
      mfrPartNumber: 'RC0603FR-0730K1L',
      quantity: 50,
    });

    expect(body.part).toMatchObject({
      description: '30.1k, FB divider bottom, 1% 0603',
      category: 'Resistors',
      usedOn: [{ boardId: id, refs: ['R1', 'R2'] }],
    });
  });

  it('marks do-not-populate spots, and never links a part to them', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { partId } = await addBag(client, 40, { partNumber: 'E-ND', description: 'RES 37.4K' });
    await client.post(`/api/boards/${id}/link`, { refs: ['R2'], partId });

    const text = `Designators,Do not populate,Value,Description,MPN,DigiKey Canada PN
R1,,10k,10 k 1% 0603,RC-10K,A-ND
,R2,37.4k,37.4 k 1% 0603,RC-37K,E-ND`;
    const { body } = await client.post(`/api/boards/${id}/bom`, { text });

    expect(body.leftEmpty).toBe(1);
    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(placements[1]).toMatchObject({ ref: 'R2', dnp: true, part: null, value: '37.4k' });
    expect(placements[0]).toMatchObject({ ref: 'R1', dnp: false, value: '10k', bomDescription: '10 k 1% 0603', bomMfrNumber: 'RC-10K' });
  });

  it('replaces the old BOM rather than piling on top of it', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await client.post(`/api/boards/${id}/bom`, { text: 'Designators,Do not populate,Value\nR1,,10k\n,R2,1k' });
    await client.post(`/api/boards/${id}/bom`, { text: 'Designators,Do not populate,Value\nR2,,22' });

    const { placements } = (await client.get(`/api/boards/${id}`)).body;
    expect(placements[0]).toMatchObject({ ref: 'R1', value: null });
    expect(placements[1]).toMatchObject({ ref: 'R2', value: '22', dnp: false });
  });

  it('names which board a stray part belongs to', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    await client.post(`/api/boards/${id}/bom`, { text: BOM });

    const byNumber = await client.get('/api/boards/which?partNumber=311-10.0khrct-nd');
    expect(byNumber.body.boards).toEqual([{ boardId: id, boardName: 'Test Board', revision: 'B', refs: ['R1', 'R2'] }]);

    const byMaker = await client.get('/api/boards/which?partNumber=OTHER-ND&mfrPartNumber=RC0603FR-0710KL');
    expect(byMaker.body.boards).toHaveLength(1);

    expect((await client.get('/api/boards/which?partNumber=NOPE-ND')).body.boards).toEqual([]);
    expect((await client.get('/api/boards/which')).body.boards).toEqual([]);
  });

  it('reports rows it could not read', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const { body } = await client.post(`/api/boards/${id}/bom`, {
      text: 'DigiKey Part Number,Customer Reference\nA-ND,BMS/EMBEDDED',
    });
    expect(body.problems).toHaveLength(1);
    expect(body.linked).toBe(0);
  });
});

describe('schematics', () => {
  const PDF = Buffer.from('%PDF-1.7 pretend schematic');

  it('stores a PDF and serves it back', async () => {
    const client = await signIn();
    const id = await uploaded(client);

    const saved = await client.put(`/api/boards/${id}/schematic`).set('Content-Type', 'application/pdf').send(PDF);
    expect(saved.status).toBe(200);
    expect(saved.body.board).toMatchObject({ hasSchematic: true, schematicType: 'application/pdf' });

    const served = await client.get(`/api/boards/${id}/schematic`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(served.headers['content-type']).toContain('application/pdf');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PDF)).toBe(0);
  });

  it('turns down other file types, including SVG', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const response = await client.put(`/api/boards/${id}/schematic`).set('Content-Type', 'image/svg+xml').send('<svg/>');
    expect(response.status).toBe(415);
  });

  it('needs a sign-in', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    const response = await request(app).put(`/api/boards/${id}/schematic`).set('Content-Type', 'application/pdf').send(PDF);
    expect(response.status).toBe(401);
  });

  it('says so when there is no schematic', async () => {
    const client = await signIn();
    const id = await uploaded(client);
    expect((await client.get(`/api/boards/${id}/schematic`)).status).toBe(404);
  });
});
