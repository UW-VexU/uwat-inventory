import { describe, expect, it } from 'vitest';
import {
  boxQrPayload,
  classifyScan,
  looksLikeLabelText,
  nextBoxCode,
  parseBagBarcode,
  parseLabelText,
} from '../src/labels';

const GS = '\u001d';
const RS = '\u001e';
const EOT = '\u0004';

// Both strings are DigiKey's own worked examples, from their label decoding guide.
const WITH_CUST_REF = ['PC1,C3,C5-7', '1P860010672008', '30P732-8660-1-ND', 'K', '1K86761783', '10K104669300', '9D1437', '1T317510011436695', '11K1', '4LCN', 'Q1', '11ZPICK', '12Z5728615', '13Z999999', '20Z0000000'];
const WITHOUT_CUST_REF = ['PQ1045-ND', '1P364019-01', '30PQ1045-ND', 'K12432 TRAVIS FOSS P', '1K85732873', '10K103332956', '9D231013', '1TQJ13P', '11K1', '4LTW', 'Q3', '11ZPICK', '12Z7360988', '13Z999999', '20Z0000000'];

const encode = (fields: string[]) => `[)>${RS}06${GS}${fields.join(GS)}${RS}${EOT}`;
const flatten = (fields: string[]) => `[)>06${fields.join('')}`;

describe('parseBagBarcode', () => {
  it('reads the fields we keep', () => {
    expect(parseBagBarcode(encode(WITH_CUST_REF))).toEqual({
      partNumber: '732-8660-1-ND',
      mfrPartNumber: '860010672008',
      quantity: 1,
      project: 'C1,C3,C5-7',
      labelKey: '732-8660-1-ND|104669300|1',
    });
  });

  it('treats a customer reference equal to the part number as blank', () => {
    const label = parseBagBarcode(encode(WITHOUT_CUST_REF));
    expect(label?.partNumber).toBe('Q1045-ND');
    expect(label?.project).toBeNull();
    expect(label?.quantity).toBe(3);
  });

  it('recovers the same fields when a scanner strips the control characters', () => {
    expect(parseBagBarcode(flatten(WITH_CUST_REF))).toEqual(parseBagBarcode(encode(WITH_CUST_REF)));
    expect(parseBagBarcode(flatten(WITHOUT_CUST_REF))).toEqual(parseBagBarcode(encode(WITHOUT_CUST_REF)));
  });

  it('keeps a K inside the part number when separators are stripped', () => {
    const fields = WITH_CUST_REF.map((field) => (field.startsWith('30P') ? '30PBKAT-123-ND' : field));
    expect(parseBagBarcode(flatten(fields))?.partNumber).toBe('BKAT-123-ND');
  });

  it('handles newer labels that leave out the DigiKey part number', () => {
    const fields = WITH_CUST_REF.filter((field) => !field.startsWith('30P'));
    const label = parseBagBarcode(encode(fields));
    expect(label?.partNumber).toBeNull();
    expect(label?.mfrPartNumber).toBe('860010672008');
    expect(label?.project).toBe('C1,C3,C5-7');
  });

  it('ignores identifiers it does not know', () => {
    expect(parseBagBarcode(encode([...WITH_CUST_REF, '99XSOMETHING']))?.partNumber).toBe('732-8660-1-ND');
  });

  it('gives the same bag the same key, and a different quantity a different key', () => {
    const smaller = WITH_CUST_REF.map((field) => (field === 'Q1' ? 'Q9' : field));
    expect(parseBagBarcode(encode(WITH_CUST_REF))?.labelKey).toBe(parseBagBarcode(encode(WITH_CUST_REF))?.labelKey);
    expect(parseBagBarcode(encode(smaller))?.labelKey).not.toBe(parseBagBarcode(encode(WITH_CUST_REF))?.labelKey);
  });

  it('reads a label from a camera decoder, which returns printable pictures of the separators', () => {
    // Exactly what the browser's decoder gave back for a Data Matrix of this format.
    const decoded =
      '[)>␞06␝PR3,␠R5,␠R6,␠R9␠to␠R14␝1PRC0603FR-1310KL␝30P13-RC0603FR-1310KLCT-ND␝K␝1K86761783␝10K104669300␝9D2401␝1TABC123␝11K1␝4LTW␝Q50␝11ZPICK␝12Z5728615␝13Z999999␝20Z000000␞␄';
    expect(parseBagBarcode(decoded)).toEqual({
      partNumber: '13-RC0603FR-1310KLCT-ND',
      mfrPartNumber: 'RC0603FR-1310KL',
      quantity: 50,
      project: 'R3, R5, R6, R9 to R14',
      labelKey: '13-RC0603FR-1310KLCT-ND|104669300|50',
    });
  });

  it('ignores the code some USB scanners put at the front', () => {
    expect(parseBagBarcode(`]d2${encode(WITH_CUST_REF)}`)?.partNumber).toBe('732-8660-1-ND');
  });

  it('rejects things that are not bag labels', () => {
    expect(parseBagBarcode('https://example.com')).toBeNull();
    expect(parseBagBarcode('[)>')).toBeNull();
    expect(parseBagBarcode(encode(['K123', 'Q5', '11ZPICK']))).toBeNull();
  });
});

describe('parseLabelText', () => {
  const bag = `P/N LM323M-ND
Desc: IC OPAMP GP 4 CIRCUIT 14SOIC
QTY: 5
CUST REF: BMS/EMBEDDED
IDX: 13`;

  it('reads a printed label', () => {
    expect(parseLabelText(bag)).toEqual([
      {
        partNumber: 'LM323M-ND',
        description: 'IC OPAMP GP 4 CIRCUIT 14SOIC',
        quantity: 5,
        project: 'BMS/EMBEDDED',
      },
    ]);
  });

  it('splits several labels on each P/N line', () => {
    const labels = parseLabelText(`${bag}\n\nP/N: 311-10KHRCT-ND\nDESC: RES 10K OHM 1% 1/10W 0603\nQTY: 1,000\n`);
    expect(labels).toHaveLength(2);
    expect(labels[1]?.quantity).toBe(1000);
    expect(labels[1]?.project).toBeNull();
  });

  it('recognises label text', () => {
    expect(looksLikeLabelText(bag)).toBe(true);
    expect(looksLikeLabelText('Part Number,Quantity\nA,1')).toBe(false);
  });
});

describe('box codes', () => {
  it('continues from the highest code', () => {
    expect(nextBoxCode([])).toBe('B-01');
    expect(nextBoxCode(['B-01', 'B-09', 'SPARES'])).toBe('B-10');
    expect(nextBoxCode(['B-99'])).toBe('B-100');
  });
});

describe('classifyScan', () => {
  it('tells boxes, bags and everything else apart', () => {
    expect(classifyScan(boxQrPayload('B-07'))).toEqual({ kind: 'box', code: 'B-07' });
    expect(classifyScan(encode(WITH_CUST_REF)).kind).toBe('bag');
    expect(classifyScan('hello')).toEqual({ kind: 'unknown', raw: 'hello' });
  });
});
