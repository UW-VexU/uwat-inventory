import { describeRole, friendlyNet, parseRefList, refKind, refKindName, type PlacementView } from './boards';
import { stockStatus, type PartSummary, type StockStatus } from './types';

export interface PartFilters {
  query?: string;
  category?: string | null;
  package?: string | null;
  project?: string | null;
  /** A box id, or 'none' for bags that haven't been put in a box. */
  boxId?: string | null;
  stock?: 'low' | 'out' | null;
}

export type SortKey = 'name' | 'qty' | 'box' | 'recent';

const round = (value: number) => Number(value.toPrecision(6));

/** Lets people search the way they talk: 100n finds 0.1UF, 4k7 finds 4.7K, 470r finds 470 OHM. */
export function expandToken(token: string): string[] {
  const forms = [token];

  const capacitance = /^(\d*\.?\d+)(P|N|U|µ)F?$/.exec(token);
  const splitCapacitance = /^(\d+)(P|N|U|µ)(\d+)$/.exec(token);
  if (capacitance || splitCapacitance) {
    const value = capacitance
      ? Number(capacitance[1])
      : Number(`${splitCapacitance?.[1]}.${splitCapacitance?.[3]}`);
    const unit = (capacitance?.[2] ?? splitCapacitance?.[2]) as string;
    const picofarads = value * ({ P: 1, N: 1e3, U: 1e6, µ: 1e6 }[unit] ?? 1);
    forms.push(`${round(picofarads)}PF`, `${round(picofarads / 1e3)}NF`, `${round(picofarads / 1e6)}UF`);
  }

  const splitResistance = /^(\d+)([KM])(\d+)$/.exec(token);
  if (splitResistance) forms.push(`${splitResistance[1]}.${splitResistance[3]}${splitResistance[2]}`);

  const ohms = /^(\d*\.?\d+)R$/.exec(token);
  if (ohms) forms.push(`${ohms[1]} OHM`);

  return forms;
}

function occursWhere(haystack: string, token: string, accept: (index: number) => boolean): boolean {
  let index = haystack.indexOf(token);
  while (index !== -1) {
    if (accept(index)) return true;
    index = haystack.indexOf(token, index + 1);
  }
  return false;
}

const isWordCharacter = (char: string | undefined) => char !== undefined && /[A-Z0-9]/.test(char);

function containsToken(haystack: string, token: string): boolean {
  // Values must match from their start, so 10K doesn't hit 110K and 5V doesn't hit 25V.
  if (/^[\d.]/.test(token)) {
    return occursWhere(haystack, token, (index) => !/[\d.]/.test(haystack[index - 1] ?? ' '));
  }
  // A lone letter would match nearly everything, so "usb c" has to mean the word C.
  if (token.length === 1) {
    return occursWhere(
      haystack,
      token,
      (index) => !isWordCharacter(haystack[index - 1]) && !isWordCharacter(haystack[index + 1]),
    );
  }
  return haystack.includes(token);
}

function searchText(part: PartSummary): string {
  return [
    part.partNumber,
    part.mfrPartNumber,
    part.description,
    part.category,
    part.package,
    part.notes,
    ...part.bags.flatMap((bag) => [bag.box?.code, bag.project]),
    ...part.usedOn.flatMap((use) => [use.boardName, ...use.refs]),
  ]
    .filter(Boolean)
    .join(' | ')
    .toUpperCase();
}

function matchesQuery(part: PartSummary, tokens: string[][]): boolean {
  const haystack = searchText(part);
  return tokens.every((forms) => forms.some((form) => containsToken(haystack, form)));
}

function matchesFilters(part: PartSummary, filters: PartFilters): boolean {
  if (filters.category && part.category !== filters.category) return false;
  if (filters.package && part.package !== filters.package) return false;
  if (filters.project && !part.bags.some((bag) => bag.project === filters.project)) return false;
  if (filters.boxId === 'none' && !part.bags.some((bag) => bag.box === null)) return false;
  if (filters.boxId && filters.boxId !== 'none' && !part.bags.some((bag) => bag.box?.id === filters.boxId)) {
    return false;
  }
  const status: StockStatus = stockStatus(part);
  if (filters.stock === 'out' && status !== 'out') return false;
  if (filters.stock === 'low' && status === 'ok') return false;
  return true;
}

function matchRank(part: PartSummary, query: string): number {
  const numbers = [part.partNumber, part.mfrPartNumber].map((value) => value?.toUpperCase() ?? '');
  if (numbers.includes(query)) return 0;
  if (numbers.some((value) => value && value.startsWith(query))) return 1;
  return 2;
}

function firstBoxCode(part: PartSummary): string {
  const codes = part.bags.flatMap((bag) => (bag.box ? [bag.box.code] : []));
  return codes.sort()[0] ?? '￿';
}

const COMPARATORS: Record<SortKey, (a: PartSummary, b: PartSummary) => number> = {
  name: (a, b) => a.description.localeCompare(b.description),
  qty: (a, b) => a.total - b.total,
  box: (a, b) => firstBoxCode(a).localeCompare(firstBoxCode(b), undefined, { numeric: true }),
  recent: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
};

export function filterParts(
  parts: readonly PartSummary[],
  filters: PartFilters = {},
  sort: SortKey = 'name',
): PartSummary[] {
  const query = (filters.query ?? '').trim().toUpperCase();
  const tokens = query.split(/\s+/).filter(Boolean).map(expandToken);
  const compare = COMPARATORS[sort];

  return parts
    .filter((part) => matchesFilters(part, filters) && matchesQuery(part, tokens))
    .sort((a, b) => (query ? matchRank(a, query) - matchRank(b, query) : 0) || compare(a, b));
}

export interface Facet {
  value: string;
  count: number;
}

function tally(values: Iterable<string>): Facet[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function buildFacets(parts: readonly PartSummary[]) {
  return {
    categories: tally(parts.map((part) => part.category)),
    packages: tally(parts.flatMap((part) => (part.package ? [part.package] : []))),
    projects: tally(
      parts.flatMap((part) => [
        // CUST REF is sometimes a list of designators, which is no use as a project filter.
        ...new Set(part.bags.flatMap((bag) => (bag.project && !parseRefList(bag.project) ? [bag.project] : []))),
      ]),
    ),
  };
}

function spotText(spot: PlacementView, all: readonly PlacementView[]): string {
  return [
    spot.ref,
    refKindName(refKind(spot.ref)),
    describeRole(spot, all),
    spot.packageGuess,
    spot.value,
    spot.bomPartNumber,
    spot.part?.description,
    spot.part?.partNumber,
    ...(spot.part?.boxes ?? []),
    ...spot.pads.map((pad) => friendlyNet(pad.net)),
  ]
    .filter(Boolean)
    .join(' | ')
    .toUpperCase();
}

/**
 * Answers "I've got this in my hand, where does it go?".
 * Takes a designator, a value, a size, a type of part, a net, or a mix of those.
 * With no query but a kind chosen, it returns that whole kind.
 */
export function findSpots(spots: readonly PlacementView[], query: string, kind: string | null = null): string[] {
  const pool = kind ? spots.filter((spot) => refKindName(refKind(spot.ref)) === kind) : spots;
  const trimmed = query.trim();
  if (!trimmed) return kind ? pool.map((spot) => spot.ref) : [];

  // R1 has to mean R1 alone, not R10 and R11 too.
  const exact = parseRefList(trimmed);
  if (exact) return pool.filter((spot) => exact.includes(spot.ref)).map((spot) => spot.ref);

  const tokens = trimmed.toUpperCase().split(/\s+/).filter(Boolean).map(expandToken);
  return pool
    .filter((spot) => {
      const haystack = spotText(spot, spots);
      return tokens.every((forms) => forms.some((form) => containsToken(haystack, form)));
    })
    .map((spot) => spot.ref);
}
