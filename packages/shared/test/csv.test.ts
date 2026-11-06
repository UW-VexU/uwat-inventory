import { describe, expect, it } from 'vitest';
import { parseCsv, parseImportText } from '../src/csv';

describe('parseCsv', () => {
  it('handles quotes, commas, newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"1,2","say ""hi"""\n"two\nlines",x\n')).toEqual([
      ['a', 'b'],
      ['1,2', 'say "hi"'],
      ['two\nlines', 'x'],
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseImportText', () => {
  it('reads a DigiKey order export', () => {
    const csv = `Index,Quantity,Part Number,Manufacturer Part Number,Description,Customer Reference,Backorder,Unit Price
13,"1,000",LM323M-ND,LM324M,IC OPAMP GP 4 CIRCUIT 14SOIC,BMS/EMBEDDED,0,0.50`;
    expect(parseImportText(csv)).toEqual({
      problems: [],
      rows: [
        {
          line: 2,
          partNumber: 'LM323M-ND',
          mfrPartNumber: 'LM324M',
          description: 'IC OPAMP GP 4 CIRCUIT 14SOIC',
          quantity: 1000,
          project: 'BMS/EMBEDDED',
          boxCode: null,
        },
      ],
    });
  });

  it('reads the short headers from a bag label, plus a box', () => {
    const { rows } = parseImportText('P/N,Desc,Qty,Cust Ref,Box\nA-ND,RES 1K,5,,b-07');
    expect(rows[0]).toMatchObject({ partNumber: 'A-ND', quantity: 5, project: null, boxCode: 'B-07' });
  });

  it('reads pasted label text', () => {
    const { rows, problems } = parseImportText('P/N LM323M-ND\nDesc: IC OPAMP\nQTY: 5\nCUST REF: BMS\nIDX: 13');
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ partNumber: 'LM323M-ND', description: 'IC OPAMP', quantity: 5, project: 'BMS' });
  });

  it('uses the part number when there is no description', () => {
    expect(parseImportText('P/N,Qty\nA-ND,5').rows[0]?.description).toBe('A-ND');
  });

  it('reports bad rows by line and keeps the good ones', () => {
    const { rows, problems } = parseImportText('P/N,Desc,Qty\nA,x,5\nB,y,many\n,,2');
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([
      { line: 3, message: 'Quantity "many" isn\'t a whole number.' },
      { line: 4, message: 'Needs a description or part number.' },
    ]);
  });

  it('flags labels with no quantity', () => {
    const { rows, problems } = parseImportText('P/N A-ND\nDesc: x\nQTY: ?\nP/N B-ND\nDesc: y\nQTY: 2');
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([{ line: 1, message: 'A-ND has no quantity.' }]);
  });

  it('explains missing columns', () => {
    expect(parseImportText('Name,Colour\nA,red').problems[0]?.message).toContain('quantity');
    expect(parseImportText('').problems[0]?.message).toBe('The file is empty.');
  });
});
