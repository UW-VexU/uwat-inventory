import { describe, expect, it } from 'vitest';
import { buildFacets, expandToken, filterParts } from '../src/search';
import type { PartSummary } from '../src/types';
import { stockStatus } from '../src/types';

let nextId = 0;
function part(overrides: Partial<PartSummary> & { description: string }): PartSummary {
  nextId += 1;
  return {
    id: `p${nextId}`,
    partNumber: null,
    mfrPartNumber: null,
    category: 'Other',
    package: null,
    minQty: null,
    notes: null,
    total: 10,
    bags: [],
    updatedAt: '2026-11-05T00:00:00.000Z',
    ...overrides,
  };
}

function bag(code: string | null, project: string | null = null) {
  return {
    id: `b${code}`,
    quantity: 5,
    box: code ? { id: `box-${code}`, code } : null,
    project,
    tagUid: null,
    updatedAt: '2026-11-05T00:00:00.000Z',
  };
}

const opamp = part({ partNumber: 'LM323M-ND', description: 'IC OPAMP GP 4 CIRCUIT 14SOIC', category: 'ICs', package: 'SOIC-14', bags: [bag('B-07', 'BMS/EMBEDDED')] });
const r10k = part({ partNumber: '311-10KHRCT-ND', description: 'RES 10K OHM 1% 1/10W 0603', category: 'Resistors', package: '0603', bags: [bag('B-02')], total: 900 });
const r110k = part({ description: 'RES 110K OHM 1% 1/10W 0603', category: 'Resistors', package: '0603', bags: [bag('B-12')] });
const r4k7 = part({ description: 'RES 4.7K OHM 5% 1/8W 0805', category: 'Resistors', package: '0805', bags: [bag(null)], total: 0 });
const r470 = part({ description: 'RES 470 OHM 1% 1/10W 0603', category: 'Resistors', package: '0603', minQty: 20, total: 12 });
const cap = part({ description: 'CAP CER 0.1UF 50V X7R 0603', category: 'Capacitors', package: '0603' });
const cap25 = part({ description: 'CAP CER 1UF 25V X5R 0603', category: 'Capacitors', package: '0603' });
const all = [opamp, r10k, r110k, r4k7, r470, cap, cap25];

const ids = (parts: PartSummary[]) => parts.map((p) => p.id);

describe('filterParts', () => {
  it('needs every word to match, in any order', () => {
    expect(ids(filterParts(all, { query: '0603 10k' }))).toEqual([r10k.id]);
  });

  it('matches P/N, box and project too', () => {
    expect(ids(filterParts(all, { query: 'lm323' }))).toEqual([opamp.id]);
    expect(ids(filterParts(all, { query: 'b-07' }))).toEqual([opamp.id]);
    expect(ids(filterParts(all, { query: 'bms' }))).toEqual([opamp.id]);
  });

  it('finds "op amp" written as two words', () => {
    expect(ids(filterParts(all, { query: 'op amp' }))).toEqual([opamp.id]);
  });

  it("doesn't let 10k match 110K, or 5v match 25V", () => {
    expect(ids(filterParts(all, { query: '10k' }))).not.toContain(r110k.id);
    expect(ids(filterParts(all, { query: '5v' }))).toEqual([]);
  });

  it('understands everyday value shorthand', () => {
    expect(ids(filterParts(all, { query: '100n' }))).toEqual([cap.id]);
    expect(ids(filterParts(all, { query: '100nf' }))).toEqual([cap.id]);
    expect(ids(filterParts(all, { query: '4k7' }))).toEqual([r4k7.id]);
    expect(ids(filterParts(all, { query: '470r' }))).toEqual([r470.id]);
  });

  it('puts an exact part number first', () => {
    const similar = part({ partNumber: 'LM323M-ND-OLD', description: 'A first alphabetically' });
    expect(filterParts([similar, opamp], { query: 'lm323m-nd' })[0]?.id).toBe(opamp.id);
  });

  it('filters by category, package, project and box', () => {
    expect(filterParts(all, { category: 'Capacitors' })).toHaveLength(2);
    expect(filterParts(all, { package: '0805' })).toHaveLength(1);
    expect(ids(filterParts(all, { project: 'BMS/EMBEDDED' }))).toEqual([opamp.id]);
    expect(ids(filterParts(all, { boxId: 'box-B-02' }))).toEqual([r10k.id]);
    expect(ids(filterParts(all, { boxId: 'none' }))).toEqual([r4k7.id]);
  });

  it('counts out of stock as low, but not the other way round', () => {
    expect(ids(filterParts(all, { stock: 'out' }))).toEqual([r4k7.id]);
    expect(ids(filterParts(all, { stock: 'low' })).sort()).toEqual([r4k7.id, r470.id].sort());
  });

  it('sorts boxes in number order', () => {
    const sorted = filterParts([r110k, r10k, opamp], {}, 'box');
    expect(sorted.map((p) => p.bags[0]?.box?.code)).toEqual(['B-02', 'B-07', 'B-12']);
  });

  it('puts parts with no box last when sorting by box', () => {
    expect(filterParts([r470, opamp], {}, 'box')[0]?.id).toBe(opamp.id);
  });

  it("doesn't change the list it was given", () => {
    const input = [r110k, r10k];
    filterParts(input, {}, 'name');
    expect(input[0]?.id).toBe(r110k.id);
  });
});

describe('expandToken', () => {
  it('converts between capacitor units', () => {
    expect(expandToken('4U7')).toContain('4.7UF');
    expect(expandToken('100PF')).toContain('0.1NF');
    expect(expandToken('1UF')).toContain('1000NF');
  });
});

describe('buildFacets', () => {
  it('counts each project once per part', () => {
    const twoBags = part({ description: 'x', bags: [bag('B-01', 'BMS'), bag('B-02', 'BMS')] });
    expect(buildFacets([twoBags]).projects).toEqual([{ value: 'BMS', count: 1 }]);
  });

  it('sorts by most common', () => {
    expect(buildFacets(all).categories[0]).toEqual({ value: 'Resistors', count: 4 });
  });
});

describe('stockStatus', () => {
  it('flags out and low', () => {
    expect(stockStatus({ total: 0, minQty: null })).toBe('out');
    expect(stockStatus({ total: 5, minQty: 5 })).toBe('low');
    expect(stockStatus({ total: 6, minQty: 5 })).toBe('ok');
    expect(stockStatus({ total: 6, minQty: null })).toBe('ok');
  });
});
