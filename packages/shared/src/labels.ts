const GS = '\u001d';
const RS = '\u001e';
const EOT = '\u0004';

/** Longest first, so 10K isn't read as 1 + 0K. Anything else in a label is ignored. */
const IDENTIFIERS = ['30P', '10K', '11K', '11Z', '12Z', '13Z', '20Z', '1P', '1K', '1T', '9D', '4L', 'P', 'K', 'Q'] as const;
type Identifier = (typeof IDENTIFIERS)[number];
type Fields = Partial<Record<Identifier, string>>;

/**
 * Some phone scanners drop the control characters, which leaves one run of text.
 * DigiKey always writes the fields in this order, so they can still be recovered.
 * The [)>06 header is optional because some decoders leave it out too.
 */
const UNSEPARATED =
  /^(?:\[\)>)?(?:06)?P(.*?)1P(.*?)30P(.*?-ND|.*?)K(.*?)1K(\d*)10K(\d*)9D(\d*)1T(.*?)11K(\d*)4L([A-Z]{0,2})Q(\d+)(?:11Z|$)/;

/**
 * Newer labels leave out 30P, so the maker's number runs straight into K, the customer PO.
 * Greedy, because maker numbers often hold a K themselves (RC0603FR-1310KL). The cost is that
 * a K inside the PO gets read as part of the maker's number: with the separators gone, the
 * two can't be told apart.
 */
const UNSEPARATED_WITHOUT_DIGIKEY_NUMBER =
  /^(?:\[\)>)?(?:06)?P(.*?)1P(.*)K(.*?)1K(\d*)10K(\d*)9D(\d*)1T(.*?)11K(\d*)4L([A-Z]{0,2})Q(\d+)(?:11Z|$)/;

/** How online decoders and label tools write the separators out as text. */
const SEPARATOR_NAMES: Record<string, string> = { GS, RS, EOT };
const SEPARATOR_TEXT = /<(?:GS|RS|EOT)>|\{(?:GS|RS|EOT)\}|\[(?:GS|RS|EOT)\]/gi;

export interface BagLabel {
  partNumber: string | null;
  mfrPartNumber: string | null;
  quantity: number | null;
  project: string | null;
  labelKey: string | null;
}

/**
 * Barcode readers don't agree on how to hand back a label. Camera decoders can swap control
 * characters for their printable pictures (␝ for GS, ␠ for a space), online decoders write
 * them as <GS>, and some USB scanners start with a code naming the barcode type, like ]d2.
 * Undo all of them so they parse the same.
 */
function normaliseScan(raw: string): string {
  return raw
    .trim()
    .replace(/^\]d\d/, '')
    .replace(/[\u2400-\u241f]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x2400))
    .replaceAll('\u2420', ' ')
    .replace(SEPARATOR_TEXT, (text: string) => SEPARATOR_NAMES[text.slice(1, -1).toUpperCase()] ?? text);
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitFields(raw: string): Fields | null {
  const body = raw.replace(/^\[\)>/, '').replaceAll(RS, GS).replaceAll(EOT, '');
  const segments = body.split(GS).filter(Boolean);
  if (segments.length < 3) return null;
  const fields: Fields = {};
  for (const segment of segments) {
    const id = IDENTIFIERS.find((candidate) => segment.startsWith(candidate));
    if (id) fields[id] = segment.slice(id.length);
  }
  return fields;
}

function recoverFields(raw: string): Fields | null {
  const text = raw.replace(/[\u0000-\u001f]/g, '');
  const match = UNSEPARATED.exec(text);
  if (match) {
    return { P: match[1], '1P': match[2], '30P': match[3], K: match[4], '1K': match[5], '10K': match[6], Q: match[11] };
  }
  const short = UNSEPARATED_WITHOUT_DIGIKEY_NUMBER.exec(text);
  if (short) {
    return { P: short[1], '1P': short[2], K: short[3], '1K': short[4], '10K': short[5], Q: short[10] };
  }
  return null;
}

/** Reads the 2D barcode on a distributor bag (ISO/IEC 15434). Returns null if it isn't one. */
export function parseBagBarcode(scanned: string): BagLabel | null {
  const raw = normaliseScan(scanned);
  const fields = raw.includes(GS) ? splitFields(raw) : recoverFields(raw);
  if (!fields) return null;
  // Without the [)> header, only trust it if it reads like a whole label, not a stray code.
  if (!raw.startsWith('[)>') && Object.keys(fields).length < 4) return null;

  // P is the customer reference, but DigiKey fills it with its own part number when blank.
  const customerField = clean(fields.P);
  const digikeyNumber = clean(fields['30P']);
  const customerIsPartNumber = customerField !== null && /-ND$/.test(customerField);
  const partNumber = digikeyNumber ?? (customerIsPartNumber ? customerField : null);
  const project = customerField === partNumber || customerIsPartNumber ? null : customerField;

  const mfrPartNumber = clean(fields['1P']);
  const quantityText = clean(fields.Q);
  const quantity = quantityText !== null && /^\d+$/.test(quantityText) ? Number(quantityText) : null;
  if (!partNumber && !mfrPartNumber) return null;

  const order = clean(fields['10K']) ?? clean(fields['1K']);
  const labelKey = order ? [partNumber ?? mfrPartNumber, order, quantity ?? ''].join('|') : null;
  return { partNumber, mfrPartNumber, quantity, project, labelKey };
}

export interface LabelText {
  partNumber: string | null;
  description: string | null;
  quantity: number | null;
  project: string | null;
}

const LABEL_LINE = /^\s*(P\/?N|DESC(?:RIPTION)?|QTY|QUANTITY|CUST\.?\s*REF(?:ERENCE)?|IDX|INDEX)\s*[:#]?\s*(.*)$/i;

/** True when the text looks like printed label lines rather than a CSV. */
export function looksLikeLabelText(text: string): boolean {
  return /^\s*P\/?N\b/im.test(text) && /^\s*(QTY|QUANTITY)\b/im.test(text);
}

/** Reads the printed lines from one or more labels. Each new P/N line starts a new bag. */
export function parseLabelText(text: string): LabelText[] {
  const labels: LabelText[] = [];
  let current: LabelText | null = null;

  for (const line of text.split(/\r?\n/)) {
    const match = LABEL_LINE.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').toUpperCase();
    const value = clean(match[2]);

    if (key.startsWith('P')) {
      current = { partNumber: value, description: null, quantity: null, project: null };
      labels.push(current);
    } else if (!current) {
      continue;
    } else if (key.startsWith('DESC')) {
      current.description = value;
    } else if (key.startsWith('Q')) {
      const quantity = value?.replaceAll(',', '') ?? '';
      current.quantity = /^\d+$/.test(quantity) ? Number(quantity) : null;
    } else if (key.startsWith('CUST')) {
      current.project = value;
    }
  }
  return labels;
}

const BOX_PREFIX = 'UWAT-BOX:';

export function boxQrPayload(code: string): string {
  return `${BOX_PREFIX}${code}`;
}

export const BOX_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

export function normaliseBoxCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Picks the next free B-nn code, filling from the highest number in use. */
export function nextBoxCode(existing: readonly string[]): string {
  const highest = existing.reduce((max, code) => {
    const match = /^B-(\d+)$/.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `B-${String(highest + 1).padStart(2, '0')}`;
}

export type ScanResult =
  | { kind: 'box'; code: string }
  | { kind: 'bag'; label: BagLabel }
  | { kind: 'unknown'; raw: string };

export function classifyScan(raw: string): ScanResult {
  const text = raw.trim();
  if (text.startsWith(BOX_PREFIX)) {
    return { kind: 'box', code: normaliseBoxCode(text.slice(BOX_PREFIX.length)) };
  }
  const label = parseBagBarcode(raw);
  return label ? { kind: 'bag', label } : { kind: 'unknown', raw: text };
}
