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

  it('ignores the code some USB scanners put at the front, and the line ending at the back', () => {
    expect(parseBagBarcode(`]d2${encode(WITH_CUST_REF)}\r\n`)?.partNumber).toBe('732-8660-1-ND');
  });

  // A Stella Nova bag: the team's DigiKey upload puts the designators in the customer reference.
  const STELLA = ['PR3, R5, R6, R9 to R14', '1PRC0603FR-1310KL', '30P13-RC0603FR-1310KLCT-ND', 'K', '1K86761783', '10K104669300', '9D2444', '1TABC123', '11K1', '4LCN', 'Q50', '11ZPICK', '12Z5728615', '13Z999999', '20Z0000000'];
  const STELLA_NEWER = STELLA.filter((field) => !field.startsWith('30P'));

  it('reads separators that online decoders write out as text', () => {
    const want = parseBagBarcode(encode(STELLA));
    expect(want?.mfrPartNumber).toBe('RC0603FR-1310KL');
    expect(parseBagBarcode(`[)><RS>06<GS>${STELLA.join('<GS>')}<RS><EOT>`)).toEqual(want);
    expect(parseBagBarcode(`[)>{rs}06{gs}${STELLA.join('{gs}')}{rs}{eot}`)).toEqual(want);
  });

  it('reads a label whose decoder left off the [)>06 header', () => {
    expect(parseBagBarcode(STELLA.join(GS))).toEqual(parseBagBarcode(encode(STELLA)));
    expect(parseBagBarcode(`06${GS}${STELLA.join(GS)}`)).toEqual(parseBagBarcode(encode(STELLA)));
    expect(parseBagBarcode(STELLA.join(''))).toEqual(parseBagBarcode(encode(STELLA)));
  });

  it('recovers a newer label with the separators stripped, even with a K in the maker number', () => {
    expect(parseBagBarcode(flatten(STELLA_NEWER))).toEqual(parseBagBarcode(encode(STELLA_NEWER)));
    expect(parseBagBarcode(flatten(STELLA_NEWER))?.mfrPartNumber).toBe('RC0603FR-1310KL');
  });

  // Decoded by Apple Vision from photos of the team's own bags (DigiKey order 102610242, Oct 2026).
  const REAL_INA226 =
    '[)>\u001e06\u001dPU2, U3, U5\u001d1PINA226AIDGSR\u001d30P296-29034-1-ND\u001dK3000053812\u001d1K102610242\u001d10K135516409\u001d9D2627+5\u001d1T6046221ASH\u001d11K1\u001d4LUS\u001dQ12\u001d11ZPICK\u001d12Z2687118\u001d13Z999999\u001d20Z0000000000000000000000000000000000000000000000000000000000000000000000000000\u001e\u0004';
  const REAL_SHUNT =
    '[)>\u001e06\u001dPR12\u001d1PWSL1206R0500FEA\u001d30PWSLC-.05CT-ND\u001dK3000053812\u001d1K102610242\u001d10K135516409\u001d9D2622\u001d1TJZ26120034\u001d11K1\u001d4LMX\u001dQ12\u001d11ZPICK\u001d12Z713427\u001d13Z999999\u001d20Z000000000000000000000000000000000000000000000000000000000000000000000000000000000000\u001e\u0004';

  it('reads real labels from the team bags', () => {
    expect(parseBagBarcode(REAL_INA226)).toEqual({
      partNumber: '296-29034-1-ND',
      mfrPartNumber: 'INA226AIDGSR',
      quantity: 12,
      project: 'U2, U3, U5',
      labelKey: '296-29034-1-ND|135516409|12',
    });
    expect(parseBagBarcode(REAL_SHUNT)).toMatchObject({ partNumber: 'WSLC-.05CT-ND', mfrPartNumber: 'WSL1206R0500FEA', quantity: 12, project: 'R12' });
  });

  it('reads the real labels with the separators stripped, including a date code like 2627+5', () => {
    for (const real of [REAL_INA226, REAL_SHUNT]) {
      expect(parseBagBarcode(real.replace(/[\u0000-\u001f]/g, ''))).toEqual(parseBagBarcode(real));
    }
  });

  it('rejects things that are not bag labels', () => {
    expect(parseBagBarcode('https://example.com')).toBeNull();
    // The two long barcodes on a real bag: the shipping tote (oLPN) and a label number.
    expect(parseBagBarcode('022582493')).toBeNull();
    expect(parseBagBarcode('446396465')).toBeNull();
    expect(parseBagBarcode('[)>')).toBeNull();
    expect(parseBagBarcode(encode(['K123', 'Q5', '11ZPICK']))).toBeNull();
    expect(parseBagBarcode('022582494')).toBeNull();
    // A GS1 code also uses GS between fields, but has no header and none of the label's fields.
    expect(parseBagBarcode(`0109501101530003${GS}17140704${GS}10AB-123`)).toBeNull();
    expect(parseBagBarcode(`1PRC0603FR-1310KL${GS}Q50${GS}C1`)).toBeNull();
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
