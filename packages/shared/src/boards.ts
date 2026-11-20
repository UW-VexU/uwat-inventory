import { classifyScan } from './labels';

export interface BoardPad {
  pin: string;
  net: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BoardSide = 'top' | 'bottom';

export interface PlacementGeometry {
  ref: string;
  side: BoardSide;
  x: number;
  y: number;
  pads: BoardPad[];
  packageGuess: string | null;
  /** The BOM says to leave this spot empty. */
  dnp?: boolean;
}

export interface LinkedPart {
  id: string;
  partNumber: string | null;
  description: string;
  total: number;
  boxes: string[];
}

export interface PlacementView extends PlacementGeometry {
  dnp: boolean;
  value: string | null;
  bomDescription: string | null;
  bomPartNumber: string | null;
  bomMfrNumber: string | null;
  part: LinkedPart | null;
  /** Ticked off as soldered on the board. */
  placed?: boolean;
}

export interface BoardSummary {
  id: string;
  name: string;
  revision: string;
  widthMm: number;
  heightMm: number;
  hasSchematic: boolean;
  schematicType: string | null;
  placementCount: number;
  /** Distinct parts the board needs, leaving out spots the BOM says to leave empty. */
  lineCount: number;
  /** How many of those are in stock. */
  stockedCount: number;
  /** How many of those are ticked off as on the board. */
  placedCount: number;
}

export interface BoardDetail {
  board: BoardSummary;
  placements: PlacementView[];
}

const REF = /^[A-Z]{1,4}\d{1,4}$/;
const MAX_RANGE = 200;

function expandRange(token: string): string[] | null {
  const match = /^([A-Z]{1,4})(\d{1,4})-(?:\1)?(\d{1,4})$/.exec(token);
  if (!match) return null;
  const [, prefix, from, to] = match;
  const count = Number(to) - Number(from);
  if (count < 0 || count > MAX_RANGE) return null;
  return Array.from({ length: count + 1 }, (_, index) => `${prefix}${Number(from) + index}`);
}

/** Reads "C2, C3", "C1,C3,C5-7" or "R1-R4". Returns null if it's anything else, like a project name. */
export function parseRefList(text: string): string[] | null {
  const tokens = text
    .trim()
    .toUpperCase()
    .replace(/\s*(?:\bTO\b|\bTHROUGH\b|–|—)\s*/g, '-')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const refs: string[] = [];
  for (const token of tokens) {
    const expanded = REF.test(token) ? [token] : expandRange(token);
    if (!expanded) return null;
    refs.push(...expanded);
  }
  return [...new Set(refs)];
}

/** Natural order, so R2 comes before R10. */
export function compareRefs(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** "R1, R2, R3, R7" reads better as "R1–R3, R7". */
export function formatRefs(refs: readonly string[]): string {
  const sorted = [...refs].sort(compareRefs);
  const groups: string[][] = [];
  for (const ref of sorted) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    const match = /^([A-Z]+)(\d+)$/.exec(ref);
    const before = previous ? /^([A-Z]+)(\d+)$/.exec(previous) : null;
    if (last && match && before && match[1] === before[1] && Number(match[2]) === Number(before[2]) + 1) {
      last.push(ref);
    } else {
      groups.push([ref]);
    }
  }
  return groups
    .map((group) => (group.length > 2 ? `${group[0]}–${group.at(-1)}` : group.join(', ')))
    .join(', ');
}

export function refKind(ref: string): string {
  return /^[A-Z]+/.exec(ref)?.[0] ?? '';
}

const KIND_NAMES: Record<string, string> = {
  R: 'Resistors',
  C: 'Capacitors',
  L: 'Inductors',
  D: 'Diodes and LEDs',
  U: 'ICs',
  J: 'Connectors',
  SW: 'Switches',
  F: 'Fuses',
  TP: 'Test points',
  Q: 'Transistors',
  Y: 'Crystals',
};

export function refKindName(kind: string): string {
  return KIND_NAMES[kind] ?? 'Other';
}

/** What KiCad exports, turned into something a person would say. */
export function friendlyNet(net: string | null): string {
  if (!net || net.startsWith('unconnected-')) return 'Not connected';
  const local = /^Net-\(([A-Z]+\d+)-(.+)\)$/.exec(net);
  if (local) return `${local[1]} ${local[2]}`;
  return net.replace(/^\//, '');
}

const isGround = (net: string) => /^\/?(A|D|P)?(GND|VSS)$/i.test(net);
const isPowerRail = (net: string) => /^\/?(\+?\d+V\d*|VIN|VBUS|VCC|VDD|VBAT|VSYS|VOUT)/i.test(net);
export const isRail = (net: string) => isGround(net) || isPowerRail(net);

function twoNets(placement: Pick<PlacementGeometry, 'pads'>): [string, string] | null {
  const nets = [...new Set(placement.pads.map((pad) => pad.net).filter((net): net is string => Boolean(net)))];
  return nets.length === 2 ? (nets as [string, string]) : null;
}

function seriesPartner(nets: readonly string[]): string | null {
  for (const net of nets) {
    const match = /^Net-\(([A-Z]+\d+)-/.exec(net);
    if (match?.[1]) return match[1];
  }
  return null;
}

function resistorRole(self: PlacementGeometry, nets: [string, string], all: readonly PlacementGeometry[]): string {
  const partner = seriesPartner(nets);
  if (partner && !nets.some(isGround) && refKind(partner) === 'D') return `In series with ${partner}`;

  const rail = nets.find(isRail);
  const signal = nets.find((net) => !isRail(net));
  if (!rail || !signal) return `Between ${friendlyNet(nets[0])} and ${friendlyNet(nets[1])}`;

  const otherHalf = all.some((other) => {
    if (other.ref === self.ref || other.dnp || refKind(other.ref) !== 'R') return false;
    const otherNets = twoNets(other);
    return otherNets?.includes(signal) && otherNets.some((net) => isRail(net) && net !== rail);
  });
  if (otherHalf) return `Divider on ${friendlyNet(signal)}`;
  return `${isGround(rail) ? 'Pull-down' : 'Pull-up'} on ${friendlyNet(signal)}`;
}

function capacitorRole(nets: [string, string]): string {
  const ground = nets.find(isGround);
  const other = nets.find((net) => !isGround(net));
  if (ground && other) return `${isPowerRail(other) ? 'Decoupling' : 'Filter'} on ${friendlyNet(other)}`;
  return `Between ${friendlyNet(nets[0])} and ${friendlyNet(nets[1])}`;
}

/** A best guess from the wiring alone. Only says what the nets actually show. */
export function describeRole(placement: PlacementGeometry, all: readonly PlacementGeometry[]): string | null {
  const nets = twoNets(placement);
  if (!nets) return null;
  const kind = refKind(placement.ref);
  if (kind === 'R') return resistorRole(placement, nets, all);
  if (kind === 'C') return capacitorRole(nets);
  return null;
}

const CHIP_SIZES: ReadonlyArray<{ size: string; minGap: number; maxGap: number; maxLength: number }> = [
  { size: '0402', minGap: 0.85, maxGap: 1.2, maxLength: 0.8 },
  { size: '0603', minGap: 1.4, maxGap: 1.8, maxLength: 1.1 },
  { size: '0805', minGap: 1.8, maxGap: 2.1, maxLength: 1.6 },
  { size: '1206', minGap: 2.7, maxGap: 3.3, maxLength: 2.0 },
  { size: '1210', minGap: 2.7, maxGap: 3.3, maxLength: 2.9 },
];

/** Works out a chip size from the pad layout, to narrow down which part fits a spot. */
export function guessChipSize(pads: readonly BoardPad[]): string | null {
  const [first, second] = pads;
  if (pads.length !== 2 || !first || !second) return null;
  const horizontal = Math.abs(first.x - second.x) >= Math.abs(first.y - second.y);
  const gap = Math.hypot(first.x - second.x, first.y - second.y);
  const length = horizontal ? first.h : first.w;
  return CHIP_SIZES.find((chip) => gap >= chip.minGap && gap <= chip.maxGap && length <= chip.maxLength)?.size ?? null;
}

/** Which other pins share a net, so people can see what a pin really connects to. */
export function connectionsOf(net: string | null, self: string, all: readonly PlacementGeometry[]): string[] {
  if (!net || net.startsWith('unconnected-') || isGround(net)) return [];
  const others = all.flatMap((placement) => {
    if (placement.ref === self) return [];
    const pins = placement.pads.filter((pad) => pad.net === net).map((pad) => pad.pin);
    if (pins.length === 0) return [];
    return [placement.pads.length > 3 ? `${placement.ref} pin ${[...new Set(pins)][0]}` : placement.ref];
  });
  return [...new Set(others)].sort(compareRefs);
}

/** The bit of a DigiKey description that fits on a label: "RES 10K OHM 1% 0603" becomes "10K". */
export function shortPartName(description: string): string {
  const words = description.trim().toUpperCase().split(/\s+/);
  const first = words[0];

  if (first === 'RES') {
    const index = words.findIndex((word) => /^\d[\d.]*[KMR]?$/.test(word));
    const value = words[index];
    if (value) return /[KMR]$/.test(value) ? value : `${value}Ω`;
  }
  if (first === 'CAP') {
    const value = words.find((word) => /^[\d.]+[PNU]F$/.test(word));
    const voltage = words.find((word) => /^[\d.]+V$/.test(word));
    if (value) return voltage ? `${value} ${voltage}` : value;
  }
  if (first === 'FIXED' || first === 'IND') {
    const value = words.find((word) => /^[\d.]+[NUM]H$/.test(word));
    if (value) return value;
  }
  return words
    .filter((word) => word !== 'IC')
    .slice(0, 2)
    .join(' ');
}

export interface SpotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The area a spot's pads cover, as seen from the given side. The bottom view is mirrored. */
export function spotBox(placement: Pick<PlacementGeometry, 'pads'>, widthMm: number, side: BoardSide): SpotBox {
  const flip = (x: number) => (side === 'bottom' ? widthMm - x : x);
  const lefts = placement.pads.map((pad) => flip(pad.x) - pad.w / 2);
  const rights = placement.pads.map((pad) => flip(pad.x) + pad.w / 2);
  const tops = placement.pads.map((pad) => pad.y - pad.h / 2);
  const bottoms = placement.pads.map((pad) => pad.y + pad.h / 2);
  return {
    left: Math.min(...lefts),
    right: Math.max(...rights),
    top: Math.min(...tops),
    bottom: Math.max(...bottoms),
  };
}

export interface LabelRequest {
  ref: string;
  lines: string[];
  box: SpotBox;
  /** Higher goes first, and so wins any fight for space. */
  priority: number;
  /** Big parts can hold their own label. On small ones it would hide the pads you're looking for. */
  canCover?: boolean;
}

export interface PlacedLabel {
  ref: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

const LINE_PX = 15;
const CHAR_PX = 6.4;
const PADDING_PX = 8;
const GAP_PX = 2;

function overlaps(a: PlacedLabel, b: { x: number; y: number; w: number; h: number }, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Puts a label by each spot without any overlapping, the way a map does.
 * Labels stay the same size on screen, so zooming in makes room for more of them.
 * Whatever doesn't fit is left out until there's space.
 */
export function layoutLabels(
  requests: readonly LabelRequest[],
  pxPerMm: number,
  board: { widthMm: number; heightMm: number },
): PlacedLabel[] {
  const area = (box: SpotBox) => (box.right - box.left) * (box.bottom - box.top);
  const ordered = [...requests].sort((a, b) => b.priority - a.priority || area(a.box) - area(b.box));
  const gap = GAP_PX / pxPerMm;
  const placed: PlacedLabel[] = [];

  for (const request of ordered) {
    const longest = Math.max(...request.lines.map((line) => line.length));
    const w = (longest * CHAR_PX + PADDING_PX) / pxPerMm;
    const h = (request.lines.length * LINE_PX) / pxPerMm;
    const { box } = request;
    const middleX = (box.left + box.right) / 2 - w / 2;
    const middleY = (box.top + box.bottom) / 2 - h / 2;

    const spots = [
      ...(request.canCover && box.right - box.left >= w && box.bottom - box.top >= h
        ? [{ x: middleX, y: middleY }]
        : []),
      { x: middleX, y: box.top - h - gap },
      { x: middleX, y: box.bottom + gap },
      { x: box.right + gap, y: middleY },
      { x: box.left - w - gap, y: middleY },
    ];

    for (const spot of spots) {
      const label = {
        ref: request.ref,
        lines: request.lines,
        w,
        h,
        x: Math.min(Math.max(spot.x, 0), Math.max(board.widthMm - w, 0)),
        y: Math.min(Math.max(spot.y, 0), Math.max(board.heightMm - h, 0)),
      };
      if (!placed.some((other) => overlaps(other, label, gap))) {
        placed.push(label);
        break;
      }
    }
  }
  return placed;
}

const partKey = (text: string | null | undefined) => (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface ScannedBag {
  partNumber: string | null;
  mfrPartNumber: string | null;
}

function sameBag(bag: ScannedBag, spot: PlacementView): boolean {
  const digikey = partKey(bag.partNumber);
  const maker = partKey(bag.mfrPartNumber);
  const numbers = [spot.bomPartNumber, spot.part?.partNumber].map(partKey);
  // The same part comes as cut tape, reel and so on under different DigiKey numbers,
  // so the maker's number is what really says two bags hold the same thing.
  return (digikey !== '' && numbers.includes(digikey)) || (maker !== '' && partKey(spot.bomMfrNumber) === maker);
}

export interface BoardLine {
  key: string;
  value: string | null;
  description: string | null;
  partNumber: string | null;
  mfrPartNumber: string | null;
  refs: string[];
  /** How many are in stock. A line counts as found once this is above zero. */
  stock: number;
  /** The inventory part these spots are linked to, if any has arrived. */
  partId: string | null;
  /** Every spot for this part is ticked off as soldered. */
  placed: boolean;
}

export type LineStatus = 'needed' | 'in-stock' | 'placed';

/** Where a part stands for building the board. On the board wins, whatever the stock says. */
export function lineStatus(line: Pick<BoardLine, 'stock' | 'placed'>): LineStatus {
  if (line.placed) return 'placed';
  return line.stock > 0 ? 'in-stock' : 'needed';
}

export type ScanVerdict =
  | { kind: 'fits'; line: BoardLine }
  | { kind: 'leave-empty'; line: BoardLine }
  | { kind: 'not-here' };

function toLine(spots: readonly PlacementView[]): BoardLine | null {
  const first = spots[0];
  if (!first) return null;
  return {
    key: partKey(first.bomMfrNumber) || partKey(first.bomPartNumber) || partKey(first.part?.partNumber) || first.ref,
    value: first.value,
    description: first.bomDescription ?? first.part?.description ?? null,
    partNumber: first.bomPartNumber ?? first.part?.partNumber ?? null,
    mfrPartNumber: first.bomMfrNumber,
    refs: spots.map((spot) => spot.ref).sort(compareRefs),
    stock: Math.max(0, ...spots.map((spot) => spot.part?.total ?? 0)),
    partId: spots.find((spot) => spot.part)?.part?.id ?? null,
    placed: spots.every((spot) => spot.placed === true),
  };
}

/** The answer to "does the thing in my hand belong on this board?". */
export function checkBag(bag: ScannedBag, spots: readonly PlacementView[]): ScanVerdict {
  const matches = spots.filter((spot) => sameBag(bag, spot));
  const fitted = toLine(matches.filter((spot) => !spot.dnp));
  if (fitted) return { kind: 'fits', line: fitted };
  const empty = toLine(matches);
  return empty ? { kind: 'leave-empty', line: empty } : { kind: 'not-here' };
}

export interface ScanJudgement {
  /** The best name we have for what was scanned. */
  code: string;
  quantity: number | null;
  bag: ScannedBag;
  verdict: ScanVerdict;
}

/** Takes whatever a scanner or keyboard produced. Returns null if it wasn't a part code at all. */
export function judgeScan(raw: string, spots: readonly PlacementView[]): ScanJudgement | null {
  const read = classifyScan(raw);
  const typed = raw.trim();
  const bag: ScannedBag = read.kind === 'bag' ? read.label : { partNumber: typed, mfrPartNumber: typed };
  const verdict = checkBag(bag, spots);
  if (read.kind !== 'bag' && verdict.kind === 'not-here' && !/-ND$/i.test(typed)) return null;
  return {
    code: bag.partNumber ?? bag.mfrPartNumber ?? typed,
    quantity: read.kind === 'bag' ? read.label.quantity : null,
    bag,
    verdict,
  };
}

/** Everything that has to be found to build this board, one line per distinct part. */
export function boardLines(spots: readonly PlacementView[]): BoardLine[] {
  const groups = new Map<string, PlacementView[]>();
  for (const spot of spots) {
    if (spot.dnp || !(spot.bomPartNumber || spot.bomMfrNumber || spot.part)) continue;
    const key = partKey(spot.bomMfrNumber) || partKey(spot.bomPartNumber) || partKey(spot.part?.partNumber) || spot.ref;
    groups.set(key, [...(groups.get(key) ?? []), spot]);
  }
  return [...groups.values()]
    .flatMap((group) => toLine(group) ?? [])
    .sort((a, b) => compareRefs(a.refs[0] ?? '', b.refs[0] ?? ''));
}
