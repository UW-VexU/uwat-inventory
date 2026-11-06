import { describe, expect, it } from 'vitest';
import {
  connectionsOf,
  describeRole,
  formatRefs,
  friendlyNet,
  guessChipSize,
  parseRefList,
  type BoardPad,
  type PlacementGeometry,
} from '../src/boards';
import { parseBom } from '../src/csv';

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
        { line: 2, refs: ['C2', 'C3', 'C16', 'C32'], partNumber: '1276-3387-1-ND', mfrPartNumber: 'CL32B106KBJNNNE', value: null },
        { line: 3, refs: ['D4'], partNumber: 'SMBJ16ALFCT-ND', mfrPartNumber: 'SMBJ16A', value: null },
      ],
    });
  });

  it('reads a KiCad BOM', () => {
    const { rows } = parseBom('Reference,Value,Footprint,MPN\n"R1,R2",10k,R_0603,RC0603FR-0710KL');
    expect(rows[0]).toMatchObject({ refs: ['R1', 'R2'], value: '10k', mfrPartNumber: 'RC0603FR-0710KL' });
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
