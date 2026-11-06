import { parseRefList } from './boards';
import { looksLikeLabelText, parseLabelText } from './labels';

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export interface ImportRow {
  line: number;
  partNumber: string | null;
  mfrPartNumber: string | null;
  description: string;
  quantity: number;
  project: string | null;
  boxCode: string | null;
}

export interface ImportProblem {
  line: number;
  message: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  problems: ImportProblem[];
}

type ImportField = 'partNumber' | 'mfrPartNumber' | 'description' | 'quantity' | 'project' | 'boxCode';

const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  partNumber: ['pn', 'partnumber', 'partno', 'digikeypartnumber', 'digikeypartno', 'digikeypn', 'dkpartnumber', 'dkpn'],
  mfrPartNumber: ['mpn', 'manufacturerpartnumber', 'manufacturerpn', 'mfrpartnumber', 'mfgpartnumber', 'mfrpn'],
  description: ['description', 'desc', 'productdescription', 'partdescription'],
  quantity: ['quantity', 'qty', 'quantityshipped', 'quantityordered', 'count'],
  project: ['custref', 'customerreference', 'customerref', 'project', 'reference'],
  boxCode: ['box', 'boxcode', 'location', 'bin'],
};

const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

function mapHeaders(headers: readonly string[]): Partial<Record<ImportField, number>> {
  const columns: Partial<Record<ImportField, number>> = {};
  headers.forEach((header, index) => {
    const key = headerKey(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, readonly string[]][]) {
      if (columns[field] === undefined && aliases.includes(key)) columns[field] = index;
    }
  });
  return columns;
}

function parseQuantity(text: string): number | null {
  const compact = text.replaceAll(',', '').trim();
  return /^\d+$/.test(compact) ? Number(compact) : null;
}

function parseCsvImport(text: string): ParsedImport {
  const [headers, ...body] = parseCsv(text);
  if (!headers) return { rows: [], problems: [{ line: 1, message: 'The file is empty.' }] };

  const columns = mapHeaders(headers);
  if (columns.quantity === undefined || (columns.description === undefined && columns.partNumber === undefined)) {
    return {
      rows: [],
      problems: [{ line: 1, message: 'Needs a quantity column, plus a description or part number column.' }],
    };
  }

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  body.forEach((cells, index) => {
    const line = index + 2;
    const read = (field: ImportField) => {
      const column = columns[field];
      return column === undefined ? '' : (cells[column] ?? '').trim();
    };
    const partNumber = read('partNumber');
    const description = read('description');
    const quantity = parseQuantity(read('quantity'));

    if (quantity === null) {
      problems.push({ line, message: `Quantity "${read('quantity')}" isn't a whole number.` });
    } else if (!description && !partNumber) {
      problems.push({ line, message: 'Needs a description or part number.' });
    } else {
      rows.push({
        line,
        partNumber: partNumber || null,
        mfrPartNumber: read('mfrPartNumber') || null,
        description: description || partNumber,
        quantity,
        project: read('project') || null,
        boxCode: read('boxCode').toUpperCase() || null,
      });
    }
  });
  return { rows, problems };
}

function parseLabelImport(text: string): ParsedImport {
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  parseLabelText(text).forEach((label, index) => {
    const line = index + 1;
    const name = label.partNumber ?? `label ${line}`;
    if (label.quantity === null) {
      problems.push({ line, message: `${name} has no quantity.` });
    } else if (!label.description && !label.partNumber) {
      problems.push({ line, message: `Label ${line} needs a description or part number.` });
    } else {
      rows.push({
        line,
        partNumber: label.partNumber,
        mfrPartNumber: null,
        description: label.description ?? label.partNumber ?? '',
        quantity: label.quantity,
        project: label.project,
        boxCode: null,
      });
    }
  });
  return { rows, problems };
}

/** Accepts a CSV, or label text pasted straight from the bags. */
export function parseImportText(text: string): ParsedImport {
  return looksLikeLabelText(text) ? parseLabelImport(text) : parseCsvImport(text);
}

export interface BomRow {
  line: number;
  refs: string[];
  partNumber: string | null;
  mfrPartNumber: string | null;
  value: string | null;
}

export interface ParsedBom {
  rows: BomRow[];
  problems: ImportProblem[];
}

const BOM_ALIASES = {
  refs: ['customerreference', 'custref', 'reference', 'references', 'designator', 'designators', 'refdes'],
  partNumber: HEADER_ALIASES.partNumber,
  mfrPartNumber: [...HEADER_ALIASES.mfrPartNumber, 'lcscpartnumber'],
  value: ['value', 'description', 'desc', 'comment'],
} as const;

/** Reads a DigiKey upload file, where Customer Reference holds the designators, or a KiCad BOM. */
export function parseBom(text: string): ParsedBom {
  const [headers, ...body] = parseCsv(text);
  if (!headers) return { rows: [], problems: [{ line: 1, message: 'The file is empty.' }] };

  const find = (aliases: readonly string[]) => headers.findIndex((header) => aliases.includes(headerKey(header)));
  const columns = {
    refs: find(BOM_ALIASES.refs),
    partNumber: find(BOM_ALIASES.partNumber),
    mfrPartNumber: find(BOM_ALIASES.mfrPartNumber),
    value: find(BOM_ALIASES.value),
  };
  if (columns.refs === -1) {
    return {
      rows: [],
      problems: [{ line: 1, message: 'Needs a column of designators, like Customer Reference or Reference.' }],
    };
  }

  const rows: BomRow[] = [];
  const problems: ImportProblem[] = [];
  body.forEach((cells, index) => {
    const line = index + 2;
    const read = (column: number) => (column === -1 ? '' : (cells[column] ?? '').trim());
    const refText = read(columns.refs);
    const refs = parseRefList(refText);
    if (!refs) {
      problems.push({ line, message: `"${refText}" isn't a list of designators.` });
      return;
    }
    rows.push({
      line,
      refs,
      partNumber: read(columns.partNumber) || null,
      mfrPartNumber: read(columns.mfrPartNumber) || null,
      value: read(columns.value) || null,
    });
  });
  return { rows, problems };
}
