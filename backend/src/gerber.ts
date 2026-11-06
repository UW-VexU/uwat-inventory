import { guessChipSize, type BoardPad, type BoardSide, type PlacementGeometry } from '@uwat/shared';
import stackup from 'pcb-stackup';
import { ApiError } from './http';

export interface GerberFile {
  name: string;
  text: string;
}

export interface ParsedBoard {
  name: string;
  revision: string;
  widthMm: number;
  heightMm: number;
  topSvg: string;
  bottomSvg: string;
  placements: PlacementGeometry[];
}

const LAYER_FILE = /\.(gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gm\d*|gko|gml|drl|xln|exc)$/i;

/** Gold stays free for marking parts, so the bare board is kept to greys. */
const BOARD_COLOURS = {
  fr4: '#1b1b1b',
  cu: '#343434',
  cf: '#9c9c9c',
  sm: 'rgba(20, 20, 20, 0.93)',
  ss: '#f4f4f4',
  sp: '#9c9c9c',
  out: '#000000',
};

const DEFAULT_PAD_MM = 0.6;

interface Flash {
  ref: string;
  pin: string;
  net: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

function apertureSize(template: string, params: string): { w: number; h: number } {
  const values = params.split('X').map(Number);
  const [first = DEFAULT_PAD_MM, second = first] = values;
  if (template === 'C') return { w: first, h: first };
  if (template === 'R' || template === 'O') return { w: first, h: second };
  if (template === 'RoundRect') {
    // Corner radius, then the four corner centres. The pad reaches one radius past them.
    const xs = [values[1], values[3], values[5], values[7]].map(Number);
    const ys = [values[2], values[4], values[6], values[8]].map(Number);
    return { w: Math.max(...xs) - Math.min(...xs) + 2 * first, h: Math.max(...ys) - Math.min(...ys) + 2 * first };
  }
  return { w: DEFAULT_PAD_MM, h: DEFAULT_PAD_MM };
}

function parseApertures(text: string, scale: number): Map<number, { w: number; h: number }> {
  const sizes = new Map<number, { w: number; h: number }>();
  for (const match of text.matchAll(/%ADD(\d+)([A-Za-z0-9_]+)(?:,([^*]*))?\*%/g)) {
    const size = apertureSize(match[2] ?? '', match[3] ?? '');
    sizes.set(Number(match[1]), { w: size.w * scale, h: size.h * scale });
  }
  return sizes;
}

/** Walks a copper layer and keeps every pad tagged with a component, in the file's coordinates. */
function readPads(text: string): Flash[] {
  const format = /%FSLAX\d(\d)Y/.exec(text);
  const decimals = format ? Number(format[1]) : 6;
  const scale = /%MOIN\*%/.test(text) ? 25.4 : 1;
  const unit = scale / 10 ** decimals;
  const apertures = parseApertures(text, scale);

  const pads: Flash[] = [];
  const attributes: { pad?: string[]; net?: string } = {};
  let x = 0;
  let y = 0;
  let aperture = 0;
  let region: { x: number; y: number }[] | null = null;

  const addPad = (at: { x: number; y: number }, size: { w: number; h: number }) => {
    const [ref, pin] = attributes.pad ?? [];
    if (!ref || !pin) return;
    pads.push({ ref, pin, net: attributes.net || null, ...at, ...size });
  };

  for (const [token] of text.matchAll(/%[^%]*%|[^*%\s][^*%]*\*/g)) {
    if (token.startsWith('G04')) continue;

    if (token.startsWith('%')) {
      const object = /^%TO\.(P|N),(.*)\*%$/.exec(token);
      if (object?.[1] === 'P') attributes.pad = (object[2] ?? '').split(',');
      else if (object?.[1] === 'N') attributes.net = (object[2] ?? '').split(',')[0];
      else if (token.startsWith('%TD')) {
        if (/^%TD\*%$/.test(token) || token.startsWith('%TD.P')) delete attributes.pad;
        if (/^%TD\*%$/.test(token) || token.startsWith('%TD.N')) delete attributes.net;
      }
      continue;
    }

    if (token.startsWith('G36')) {
      region = [];
      continue;
    }
    if (token.startsWith('G37')) {
      if (region && region.length > 0) {
        const xs = region.map((point) => point.x);
        const ys = region.map((point) => point.y);
        const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        addPad({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, { w: maxX - minX, h: maxY - minY });
      }
      region = null;
      continue;
    }

    const select = /^(?:G54)?D(\d+)\*$/.exec(token);
    if (select && Number(select[1]) >= 10) {
      aperture = Number(select[1]);
      continue;
    }

    const move = /^(?:G0[123])?(?:X(-?\d+))?(?:Y(-?\d+))?(?:I-?\d+)?(?:J-?\d+)?D0([123])\*$/.exec(token);
    if (!move) continue;
    if (move[1] !== undefined) x = Number(move[1]) * unit;
    if (move[2] !== undefined) y = Number(move[2]) * unit;
    if (region) region.push({ x, y });
    else if (move[3] === '3') addPad({ x, y }, apertures.get(aperture) ?? { w: DEFAULT_PAD_MM, h: DEFAULT_PAD_MM });
  }
  return pads;
}

function layerOf(files: readonly GerberFile[], fileFunction: RegExp, fileName: RegExp): GerberFile | undefined {
  return (
    files.find((file) => fileFunction.test(/%TF\.FileFunction,([^*]*)\*%/.exec(file.text)?.[1] ?? '')) ??
    files.find((file) => fileName.test(file.name))
  );
}

function componentsOn(files: readonly (GerberFile | undefined)[]): Set<string> {
  const refs = new Set<string>();
  for (const file of files) {
    for (const match of file?.text.matchAll(/%TO\.C,([^*,]+)/g) ?? []) if (match[1]) refs.add(match[1]);
  }
  return refs;
}

function friendlyBoardName(project: string): string {
  const words = project
    .replace(/^uwat[-_ ]?/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[-_ ]+/)
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') || project;
}

function projectOf(files: readonly GerberFile[]) {
  for (const file of files) {
    const match = /%TF\.ProjectId,([^,*]*),[^,*]*,([^*]*)\*%/.exec(file.text);
    if (match?.[1]) return { name: friendlyBoardName(match[1]), revision: match[2] ?? '' };
  }
  const first = files[0]?.name.replace(/[-_.](F_Cu|B_Cu|Edge_Cuts).*$/i, '').replace(/\.[^.]+$/, '') ?? 'Board';
  return { name: friendlyBoardName(first), revision: '' };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function buildPlacements(
  topPads: Flash[],
  bottomPads: Flash[],
  topComponents: Set<string>,
  toBoard: (x: number, y: number) => { x: number; y: number },
): PlacementGeometry[] {
  const refs = new Set([...topPads, ...bottomPads].map((pad) => pad.ref));

  return [...refs].map((ref) => {
    const onTop = topPads.filter((pad) => pad.ref === ref);
    const onBottom = bottomPads.filter((pad) => pad.ref === ref);
    const side: BoardSide = topComponents.has(ref) || onBottom.length === 0 ? 'top' : 'bottom';
    const chosen = side === 'top' ? onTop : onBottom;
    const flashes = chosen.length > 0 ? chosen : [...onTop, ...onBottom];

    const pads: BoardPad[] = flashes.map((pad) => {
      const at = toBoard(pad.x, pad.y);
      return { pin: pad.pin, net: pad.net, x: round(at.x), y: round(at.y), w: round(pad.w), h: round(pad.h) };
    });
    const xs = pads.map((pad) => pad.x);
    const ys = pads.map((pad) => pad.y);
    return {
      ref,
      side,
      x: round((Math.min(...xs) + Math.max(...xs)) / 2),
      y: round((Math.min(...ys) + Math.max(...ys)) / 2),
      pads,
      packageGuess: guessChipSize(pads),
    };
  });
}

export async function parseGerbers(uploaded: readonly GerberFile[]): Promise<ParsedBoard> {
  const files = uploaded.filter((file) => LAYER_FILE.test(file.name));
  const topCopper = layerOf(files, /^Copper,L1,/, /F_Cu|\.gtl$/i);
  const bottomCopper = layerOf(files, /^Copper,L\d+,Bot/, /B_Cu|\.gbl$/i);
  if (!topCopper) throw new ApiError(422, 'no_copper', "Couldn't find a top copper layer in those files.");

  const topPads = readPads(topCopper.text);
  const bottomPads = bottomCopper ? readPads(bottomCopper.text) : [];
  if (topPads.length + bottomPads.length === 0) {
    throw new ApiError(
      422,
      'no_component_data',
      "These gerbers don't say which pad belongs to which part. In KiCad's Plot window, turn on the X2 format and netlist attributes, then plot again.",
    );
  }

  let rendered;
  try {
    rendered = await stackup(
      files.map((file) => ({ filename: file.name, gerber: file.text })),
      { useOutline: true, color: BOARD_COLOURS },
    );
  } catch {
    throw new ApiError(422, 'bad_gerber', "Couldn't draw the board. One of those files may be damaged.");
  }

  const [viewX, viewY, viewWidth, viewHeight] = rendered.top.viewBox;
  const scale = (rendered.top.units === 'in' ? 25.4 : 1) / 1000;
  const left = viewX * scale;
  const top = (viewY + viewHeight) * scale;
  const toBoard = (x: number, y: number) => ({ x: x - left, y: top - y });

  const topComponents = componentsOn([
    layerOf(files, /^Legend,Top/, /F_Silk|\.gto$/i),
    layerOf(files, /^Paste,Top/, /F_Paste|\.gtp$/i),
  ]);

  return {
    ...projectOf(files),
    widthMm: round(viewWidth * scale),
    heightMm: round(viewHeight * scale),
    topSvg: rendered.top.svg,
    bottomSvg: rendered.bottom.svg,
    placements: buildPlacements(topPads, bottomPads, topComponents, toBoard),
  };
}
