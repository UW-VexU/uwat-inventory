import { describe, expect, it } from 'vitest';
import {
  boardLines,
  lineStatus,
  checkBag,
  connectionsOf,
  describeRole,
  formatRefs,
  friendlyNet,
  guessChipSize,
  judgeScan,
  layoutLabels,
  parseRefList,
  shortPartName,
  spotBox,
  type BoardPad,
  type LabelRequest,
  type PlacementGeometry,
  type PlacementView,
} from '../src/boards';
import { parseBom } from '../src/csv';
import { findSpots } from '../src/search';

function pad(pin: string, net: string | null, x = 0, y = 0, w = 0.8, h = 0.95): BoardPad {
  return { pin, net, x, y, w, h };
}

function spot(ref: string, first: string | null, second: string | null): PlacementGeometry {
  return { ref, side: 'top', x: 0, y: 0, pads: [pad('1', first), pad('2', second)], packageGuess: null };
}

describe('parseRefList', () => {
  it('reads the formats people use', () => {
    expect(parseRefList('C2, C3, C16, C32')).toEqual(['C2', 'C3', 'C16', 'C32']);
    expect(parseRefList('C1,C3,C5-7')).toEqual(['C1', 'C3', 'C5', 'C6', 'C7']);
    expect(parseRefList('R1-R4')).toEqual(['R1', 'R2', 'R3', 'R4']);
    expect(parseRefList('r1 r2')).toEqual(['R1', 'R2']);
    expect(parseRefList('SW1')).toEqual(['SW1']);
  });

  it('reads ranges written with "to", as the Stella Nova upload file does', () => {
    expect(parseRefList('R3, R5, R6, R9 to R14')).toEqual(['R3', 'R5', 'R6', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14']);
    expect(parseRefList('R1 – R3')).toEqual(['R1', 'R2', 'R3']);
  });

  it('turns down anything that is really a project name', () => {
    expect(parseRefList('BMS/EMBEDDED')).toBeNull();
    expect(parseRefList('ODOM BOARD')).toBeNull();
    expect(parseRefList('SPARES')).toBeNull();
    expect(parseRefList('')).toBeNull();
    expect(parseRefList('R9-R2')).toBeNull();
  });
});

describe('formatRefs', () => {
  it('collapses runs and keeps number order', () => {
    expect(formatRefs(['R10', 'R9', 'R11', 'R12', 'R2'])).toBe('R2, R9–R12');
    expect(formatRefs(['C1', 'C2'])).toBe('C1, C2');
  });
});

describe('friendlyNet', () => {
  it('reads like a person wrote it', () => {
    expect(friendlyNet('/SD_CMD')).toBe('SD_CMD');
    expect(friendlyNet('+3V3')).toBe('+3V3');
    expect(friendlyNet('Net-(D6-A)')).toBe('D6 A');
    expect(friendlyNet('unconnected-(J2-SBU1-PadA8)')).toBe('Not connected');
    expect(friendlyNet(null)).toBe('Not connected');
  });
});

describe('describeRole', () => {
  // All of these wirings are straight from the Stella Nova board.
  const r5 = spot('R5', '+3V3', '/ESP_EN');
  const r7 = spot('R7', '/CC1', 'GND');
  const r4 = spot('R4', '/RS485_A', '/RS485_B');
  const r16 = spot('R16', '/LED_LINK', 'Net-(D7-A)');
  const r20 = spot('R20', '+3V3', '/FB');
  const r21 = spot('R21', '/FB', 'GND');
  const r22 = spot('R22', 'VBUS', 'GND');
  const c4 = spot('C4', '+3V3', 'GND');
  const c10 = spot('C10', '/ESP_EN', 'GND');
  const c3 = spot('C3', '/BST', '/SW');
  const all = [r5, r7, r4, r16, r20, r21, r22, c4, c10, c3];

  it.each([
    [r5, 'Pull-up on ESP_EN'],
    [r7, 'Pull-down on CC1'],
    [r4, 'Between RS485_A and RS485_B'],
    [r16, 'In series with D7'],
    [r20, 'Divider on FB'],
    [r21, 'Divider on FB'],
    [r22, 'Between VBUS and GND'],
    [c4, 'Decoupling on +3V3'],
    [c10, 'Filter on ESP_EN'],
    [c3, 'Between BST and SW'],
  ])('%#', (placement, role) => {
    expect(describeRole(placement, all)).toBe(role);
  });

  it('leaves spots that stay empty out of its reasoning', () => {
    const r1 = spot('R1', 'VIN', 'Net-(U2-EN)');
    const r2 = { ...spot('R2', 'Net-(U2-EN)', 'GND'), dnp: true };
    expect(describeRole(r1, [r1, r2])).toBe('Pull-up on U2 EN');
  });

  it('stays quiet about parts it cannot judge', () => {
    expect(describeRole(spot('L1', '/SW', '+3V3'), all)).toBeNull();
    expect(describeRole(spot('R99', '+3V3', '+3V3'), all)).toBeNull();
  });
});

describe('guessChipSize', () => {
  const pads = (gap: number, w: number, h: number) => [pad('1', 'A', 0, 0, w, h), pad('2', 'B', gap, 0, w, h)];

  it('tells common sizes apart', () => {
    expect(guessChipSize(pads(1.65, 0.8, 0.95))).toBe('0603');
    expect(guessChipSize(pads(1.0, 0.6, 0.65))).toBe('0402');
    expect(guessChipSize(pads(1.9, 1.0, 1.45))).toBe('0805');
    expect(guessChipSize(pads(3.0, 1.15, 1.8))).toBe('1206');
    expect(guessChipSize(pads(3.0, 1.15, 2.7))).toBe('1210');
  });

  it('works when the part is turned sideways', () => {
    const turned = [pad('1', 'A', 0, 0, 0.95, 0.8), pad('2', 'B', 0, 1.65, 0.95, 0.8)];
    expect(guessChipSize(turned)).toBe('0603');
  });

  it('gives no answer when unsure', () => {
    expect(guessChipSize(pads(9, 3, 3))).toBeNull();
    expect(guessChipSize([pad('1', 'A')])).toBeNull();
  });
});

describe('connectionsOf', () => {
  const module: PlacementGeometry = {
    ref: 'U1',
    side: 'top',
    x: 0,
    y: 0,
    packageGuess: null,
    pads: [pad('8', '/SDA'), pad('9', '/SCL'), pad('10', 'GND'), pad('11', 'GND')],
  };
  const pullUp = spot('R2', '+3V3', '/SDA');
  const other = spot('R10', '+3V3', '/SDA');

  it('names pins on big parts, and just the part on small ones', () => {
    expect(connectionsOf('/SDA', 'R2', [module, pullUp, other])).toEqual(['R10', 'U1 pin 8']);
  });

  it('skips ground, which connects to everything', () => {
    expect(connectionsOf('GND', 'R2', [module, pullUp])).toEqual([]);
  });
});

describe('parseBom', () => {
  it("reads the team's DigiKey upload files", () => {
    const csv = `Quantity,Manufacturer Part Number,Manufacturer,DigiKey Part Number,Customer Reference
50,CL32B106KBJNNNE,Samsung Electro-Mechanics,1276-3387-1-ND,"C2, C3, C16, C32"
10,SMBJ16A,Littelfuse,SMBJ16ALFCT-ND,D4`;
    expect(parseBom(csv)).toEqual({
      problems: [],
      rows: [
        { line: 2, refs: ['C2', 'C3', 'C16', 'C32'], emptyRefs: [], partNumber: '1276-3387-1-ND', mfrPartNumber: 'CL32B106KBJNNNE', value: null, description: null },
        { line: 3, refs: ['D4'], emptyRefs: [], partNumber: 'SMBJ16ALFCT-ND', mfrPartNumber: 'SMBJ16A', value: null, description: null },
      ],
    });
  });

  it('reads a KiCad BOM', () => {
    const { rows } = parseBom('Reference,Value,Footprint,MPN\n"R1,R2",10k,R_0603,RC0603FR-0710KL');
    expect(rows[0]).toMatchObject({ refs: ['R1', 'R2'], value: '10k', mfrPartNumber: 'RC0603FR-0710KL' });
  });

  // These lines are copied from the real Stella Nova BOM.
  const REAL_BOM = `Item,Qty per board,Designators,Do not populate,Value,Description,Manufacturer,MPN,DigiKey Canada PN
21,9,R3 R5 R6 R9 R10 R11 R12 R13 R14,,10k,10 k 1% 0603,Yageo,RC0603FR-1310KL,13-RC0603FR-1310KLCT-ND
20,0,,R2,37.4k,37.4 k 1% 0603,Yageo,RC0603FR-0737K4L,311-37.4KHRCT-ND
,,,,,Parts total per board,,,`;

  it('reads the Stella Nova BOM', () => {
    const { rows, problems } = parseBom(REAL_BOM);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      refs: ['R3', 'R5', 'R6', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14'],
      emptyRefs: [],
      value: '10k',
      description: '10 k 1% 0603',
      partNumber: '13-RC0603FR-1310KLCT-ND',
      mfrPartNumber: 'RC0603FR-1310KL',
    });
  });

  it('keeps do-not-populate spots apart from the ones that get a part', () => {
    expect(parseBom(REAL_BOM).rows[1]).toMatchObject({ refs: [], emptyRefs: ['R2'], value: '37.4k' });
  });

  it('reads a KiCad DNP column that just says yes', () => {
    const { rows } = parseBom('Reference,Value,DNP\n"R1,R2",10k,DNP\nR3,1k,');
    expect(rows[0]).toMatchObject({ refs: [], emptyRefs: ['R1', 'R2'] });
    expect(rows[1]).toMatchObject({ refs: ['R3'], emptyRefs: [] });
  });

  it('flags rows that have a project name instead of designators', () => {
    const { rows, problems } = parseBom('DigiKey Part Number,Customer Reference\nA-ND,BMS/EMBEDDED\nB-ND,R1');
    expect(rows).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
  });

  it('explains a file with no designators', () => {
    expect(parseBom('Part,Qty\nA,1').problems[0]?.message).toContain('designators');
  });
});

describe('shortPartName', () => {
  it.each([
    ['RES 10K OHM 1% 1/10W 0603', '10K'],
    ['RES SMD 4.7K OHM 5% 1/8W 0805', '4.7K'],
    ['RES 470 OHM 1% 1/10W 0603', '470Ω'],
    ['RES 0 OHM 1% 1/10W 0603', '0Ω'],
    ['CAP CER 0.1UF 50V X7R 0603', '0.1UF 50V'],
    ['CAP ALUM 100UF 20% 25V SMD', '100UF 25V'],
    ['FIXED IND 10UH 1A 200 MOHM SMD', '10UH'],
    ['IC OPAMP GP 4 CIRCUIT 14SOIC', 'OPAMP GP'],
    ['LED GREEN CLEAR 0603 SMD', 'LED GREEN'],
    ['Mystery thing', 'MYSTERY THING'],
  ])('%s', (description, short) => {
    expect(shortPartName(description)).toBe(short);
  });
});

describe('spotBox', () => {
  const part = { pads: [pad('1', 'A', 10, 5, 1, 2), pad('2', 'B', 12, 5, 1, 2)] };

  it('covers all the pads', () => {
    expect(spotBox(part, 40, 'top')).toEqual({ left: 9.5, right: 12.5, top: 4, bottom: 6 });
  });

  it('mirrors for the bottom view', () => {
    expect(spotBox(part, 40, 'bottom')).toEqual({ left: 27.5, right: 30.5, top: 4, bottom: 6 });
  });
});

describe('layoutLabels', () => {
  const board = { widthMm: 48, heightMm: 40 };
  const request = (ref: string, x: number, y: number, priority = 0, size = 1): LabelRequest => ({
    ref,
    lines: [ref],
    priority,
    box: { left: x, right: x + size, top: y, bottom: y + size },
  });

  it('never lets two labels overlap', () => {
    const crowd = Array.from({ length: 30 }, (_, index) => request(`R${index}`, 10 + (index % 6), 10 + Math.floor(index / 6)));
    const labels = layoutLabels(crowd, 20, board);
    for (const a of labels) {
      for (const b of labels) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('fits more labels the further you zoom in', () => {
    const crowd = Array.from({ length: 30 }, (_, index) => request(`R${index}`, 10 + (index % 6), 10 + Math.floor(index / 6)));
    const far = layoutLabels(crowd, 15, board).length;
    const close = layoutLabels(crowd, 80, board).length;
    expect(close).toBeGreaterThan(far);
    expect(close).toBe(30);
  });

  it('gives the matching spots first claim on the space', () => {
    const labels = layoutLabels([request('R1', 10, 10), request('R2', 10.1, 10, 5)], 8, board);
    expect(labels[0]?.ref).toBe('R2');
  });

  it('keeps labels on the board', () => {
    const [label] = layoutLabels([request('R1', 0, 0)], 20, board);
    expect(label?.x).toBeGreaterThanOrEqual(0);
    expect(label?.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps labels off the pads of small parts', () => {
    const [label] = layoutLabels([request('R1', 10, 10, 0, 2)], 40, board);
    const clear = (label?.y ?? 0) + (label?.h ?? 0) <= 10 || (label?.y ?? 0) >= 12;
    expect(clear).toBe(true);
  });

  it('puts a label inside a big part that can hold it', () => {
    const [label] = layoutLabels([{ ...request('U1', 10, 10, 0, 12), canCover: true }], 20, board);
    expect(label?.x).toBeGreaterThan(10);
    expect(label?.y).toBeGreaterThan(10);
    expect((label?.y ?? 0) + (label?.h ?? 0)).toBeLessThan(22);
  });
});

describe('findSpots', () => {
  const view = (
    ref: string,
    first: string,
    second: string,
    extra: Partial<PlacementView> = {},
  ): PlacementView => ({
    ...spot(ref, first, second),
    packageGuess: '0603',
    dnp: false,
    value: null,
    bomDescription: null,
    bomPartNumber: null,
    bomMfrNumber: null,
    part: null,
    ...extra,
  });

  const tenK = { id: 'p1', partNumber: '311-10K-ND', description: 'RES 10K OHM 1% 1/10W 0603', total: 800, boxes: ['B-08'] };
  const cap = { id: 'p2', partNumber: 'C-ND', description: 'CAP CER 0.1UF 50V X7R 0603', total: 40, boxes: ['B-02'] };
  const r1 = view('R1', 'VIN', 'Net-(U2-EN)');
  const r9 = view('R9', '+3V3', '/SD_CMD', { part: tenK });
  const r10 = view('R10', '+3V3', '/SD_D0', { part: tenK });
  const r11 = view('R11', '+3V3', '/SD_D1', { packageGuess: '0805' });
  const c4 = view('C4', '+3V3', 'GND', { part: cap });
  const all = [r1, r9, r10, r11, c4];

  it('finds spots from a value in your hand', () => {
    expect(findSpots(all, '10k')).toEqual(['R9', 'R10']);
    expect(findSpots(all, '100n')).toEqual(['C4']);
    expect(findSpots(all, '0.1uf')).toEqual(['C4']);
  });

  it('finds spots from just the type of part', () => {
    expect(findSpots(all, 'resistor')).toEqual(['R1', 'R9', 'R10', 'R11']);
    expect(findSpots(all, 'capacitor')).toEqual(['C4']);
  });

  it('combines words', () => {
    expect(findSpots(all, 'resistor 0805')).toEqual(['R11']);
  });

  it('takes a designator to mean exactly that one', () => {
    expect(findSpots(all, 'r1')).toEqual(['R1']);
    expect(findSpots(all, 'R9-R10')).toEqual(['R9', 'R10']);
  });

  it('finds spots by net, role, box and part number', () => {
    expect(findSpots(all, 'sd_cmd')).toEqual(['R9']);
    expect(findSpots(all, 'pull-up')).toEqual(['R1', 'R9', 'R10', 'R11']);
    expect(findSpots(all, 'b-08')).toEqual(['R9', 'R10']);
    expect(findSpots(all, '311-10k')).toEqual(['R9', 'R10']);
  });

  it('shows a whole kind when one is picked, and narrows it with a query', () => {
    expect(findSpots(all, '', 'Capacitors')).toEqual(['C4']);
    expect(findSpots(all, '10k', 'Capacitors')).toEqual([]);
    expect(findSpots(all, '0805', 'Resistors')).toEqual(['R11']);
  });

  it('matches nothing when nothing is asked', () => {
    expect(findSpots(all, '   ')).toEqual([]);
  });

  it('finds spots from BOM values when no stock is linked yet', () => {
    const bomOnly = view('R20', '+3V3', '/FB', { value: '93.1k', bomDescription: 'FB divider top, 1% 0603' });
    expect(findSpots([bomOnly], '93.1k')).toEqual(['R20']);
  });

  it('never offers a spot that stays empty as somewhere a part goes', () => {
    const empty = view('R2', 'Net-(U2-EN)', 'GND', { dnp: true, value: '37.4k' });
    expect(findSpots([empty, r1], '37.4k')).toEqual([]);
    expect(findSpots([empty, r1], 'resistor')).toEqual(['R1']);
    expect(findSpots([empty, r1], '', 'Resistors')).toEqual(['R1']);
  });

  it('still finds an empty spot when you ask for it by name', () => {
    const empty = view('R2', 'Net-(U2-EN)', 'GND', { dnp: true });
    expect(findSpots([empty, r1], 'r2')).toEqual(['R2']);
  });
});

describe('checkBag', () => {
  const line = (ref: string, extra: Partial<PlacementView>): PlacementView => ({
    ...spot(ref, 'A', 'B'),
    dnp: false,
    value: null,
    bomDescription: null,
    bomPartNumber: null,
    bomMfrNumber: null,
    part: null,
    ...extra,
  });
  const tenK = { value: '10k', bomDescription: '10 k 1% 0603', bomPartNumber: '13-RC0603FR-1310KLCT-ND', bomMfrNumber: 'RC0603FR-1310KL' };
  const spots = [
    line('R10', tenK),
    line('R3', tenK),
    line('R2', { dnp: true, value: '37.4k', bomPartNumber: '311-37.4KHRCT-ND', bomMfrNumber: 'RC0603FR-0737K4L' }),
    line('D2', { value: 'PMEG6020ER', bomPartNumber: '1727-5217-1-ND', bomMfrNumber: 'PMEG6020ER,115' }),
    line('SW1', { bomMfrNumber: 'PTS810 SJM 250 SMTR LFS' }),
    line('TP1', {}),
  ];

  it('says a part belongs, and every spot it goes in', () => {
    const verdict = checkBag({ partNumber: '13-RC0603FR-1310KLCT-ND', mfrPartNumber: null }, spots);
    expect(verdict).toMatchObject({ kind: 'fits', line: { refs: ['R3', 'R10'], value: '10k' } });
  });

  it('matches the same part sold on a different DigiKey number', () => {
    const verdict = checkBag({ partNumber: '13-RC0603FR-1310KLTR-ND', mfrPartNumber: 'RC0603FR-1310KL' }, spots);
    expect(verdict.kind).toBe('fits');
  });

  it("isn't thrown by punctuation in maker numbers", () => {
    expect(checkBag({ partNumber: null, mfrPartNumber: 'PMEG6020ER115' }, spots).kind).toBe('fits');
    expect(checkBag({ partNumber: null, mfrPartNumber: 'pts810sjm250smtrlfs' }, spots).kind).toBe('fits');
  });

  it('warns when a part is for a spot that stays empty', () => {
    const verdict = checkBag({ partNumber: '311-37.4KHRCT-ND', mfrPartNumber: null }, spots);
    expect(verdict).toMatchObject({ kind: 'leave-empty', line: { refs: ['R2'] } });
  });

  it('says so when a part is for another board', () => {
    expect(checkBag({ partNumber: 'LM323M-ND', mfrPartNumber: 'LM324M' }, spots)).toEqual({ kind: 'not-here' });
  });

  it("doesn't match a blank label to a blank spot", () => {
    expect(checkBag({ partNumber: null, mfrPartNumber: null }, spots)).toEqual({ kind: 'not-here' });
  });

  it('judges a full barcode, a typed number, and text that is neither', () => {
    const barcode = `[)>\u001e06\u001dP\u001d1PRC0603FR-1310KL\u001d30P13-RC0603FR-1310KLCT-ND\u001dK\u001d1K1\u001d10K2\u001dQ50\u001d11ZPICK\u001e\u0004`;
    expect(judgeScan(barcode, spots)).toMatchObject({ quantity: 50, verdict: { kind: 'fits' } });
    expect(judgeScan('13-RC0603FR-1310KLCT-ND', spots)).toMatchObject({ quantity: null, verdict: { kind: 'fits' } });
    expect(judgeScan('LM323M-ND', spots)).toMatchObject({ code: 'LM323M-ND', verdict: { kind: 'not-here' } });
    expect(judgeScan('10k', spots)).toBeNull();
  });

  it('checks a linked part when the spot has no BOM data', () => {
    const linked = line('R1', {
      part: { id: 'p', partNumber: 'X-ND', description: 'RES 1K', total: 5, boxes: [] },
    });
    expect(checkBag({ partNumber: 'x-nd', mfrPartNumber: null }, [linked]).kind).toBe('fits');
  });
});

describe('boardLines', () => {
  const line = (ref: string, extra: Partial<PlacementView>): PlacementView => ({
    ...spot(ref, 'A', 'B'),
    dnp: false,
    value: null,
    bomDescription: null,
    bomPartNumber: null,
    bomMfrNumber: null,
    part: null,
    ...extra,
  });

  it('lists each part to find once, leaving out empty spots and bare test pads', () => {
    const lines = boardLines([
      line('R10', { bomPartNumber: 'A-ND', bomMfrNumber: 'A', value: '10k' }),
      line('R3', { bomPartNumber: 'A-ND', bomMfrNumber: 'A', value: '10k' }),
      line('R2', { bomPartNumber: 'B-ND', dnp: true }),
      line('C1', { bomPartNumber: 'C-ND' }),
      line('TP1', {}),
    ]);
    expect(lines.map((item) => item.refs)).toEqual([['C1'], ['R3', 'R10']]);
  });

  it('counts a part as on the board only once every one of its spots is ticked off', () => {
    const stocked = { id: 'p1', partNumber: 'A-ND', description: '10k', total: 50, boxes: [] };
    const [half] = boardLines([
      line('R1', { bomPartNumber: 'A-ND', part: stocked, placed: true }),
      line('R2', { bomPartNumber: 'A-ND', part: stocked }),
    ]);
    expect(half).toMatchObject({ partId: 'p1', stock: 50, placed: false });
    expect(lineStatus(half!)).toBe('in-stock');

    const [whole] = boardLines([
      line('R1', { bomPartNumber: 'A-ND', placed: true }),
      line('R2', { bomPartNumber: 'A-ND', placed: true }),
    ]);
    // Soldered from an old bag, so it's done even with nothing in stock.
    expect(lineStatus(whole!)).toBe('placed');
    expect(lineStatus({ stock: 0, placed: false })).toBe('needed');
  });
});
