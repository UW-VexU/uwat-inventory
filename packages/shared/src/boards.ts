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
}

export interface LinkedPart {
  id: string;
  partNumber: string | null;
  description: string;
  total: number;
  boxes: string[];
}

export interface PlacementView extends PlacementGeometry {
  value: string | null;
  bomPartNumber: string | null;
  part: LinkedPart | null;
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
  linkedCount: number;
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
  const tokens = text.trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
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
const isRail = (net: string) => isGround(net) || isPowerRail(net);

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
    if (other.ref === self.ref || refKind(other.ref) !== 'R') return false;
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
