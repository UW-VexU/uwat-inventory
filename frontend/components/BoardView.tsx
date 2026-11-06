'use client';

import type { BoardSide, PlacementGeometry } from '@uwat/shared';

interface Props {
  boardId: string;
  widthMm: number;
  heightMm: number;
  side: BoardSide;
  placements: readonly PlacementGeometry[];
  /** Spots to mark in gold. */
  highlighted: ReadonlySet<string>;
  /** The one spot being looked at, which also shows its pin 1. */
  selected?: string | null;
  onSelect?: (ref: string) => void;
}

const HIT_MARGIN_MM = 0.35;

function bounds(placement: PlacementGeometry, flip: (x: number) => number) {
  const edges = placement.pads.map((pad) => ({
    left: flip(pad.x) - pad.w / 2,
    right: flip(pad.x) + pad.w / 2,
    top: pad.y - pad.h / 2,
    bottom: pad.y + pad.h / 2,
  }));
  const left = Math.min(...edges.map((edge) => edge.left));
  const right = Math.max(...edges.map((edge) => edge.right));
  const top = Math.min(...edges.map((edge) => edge.top));
  const bottom = Math.max(...edges.map((edge) => edge.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

export function BoardView({ boardId, widthMm, heightMm, side, placements, highlighted, selected, onSelect }: Props) {
  // The bottom drawing is mirrored, as if the board were flipped over in your hand.
  const flip = (x: number) => (side === 'bottom' ? widthMm - x : x);
  const visible = placements.filter((placement) => placement.side === side);
  // Neighbouring spots share a lot of space, so a crowd of rings needs to sit tighter.
  const ringGap = highlighted.size > 3 ? 0.15 : 0.55;

  return (
    <div className="board-view" style={{ aspectRatio: `${widthMm} / ${heightMm}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/boards/${boardId}/${side}.svg`} alt={`${side === 'top' ? 'Top' : 'Bottom'} of the board`} />
      <svg viewBox={`0 0 ${widthMm} ${heightMm}`} aria-hidden="true">
        {visible.map((placement) => {
          const box = bounds(placement, flip);
          const lit = highlighted.has(placement.ref);
          const chosen = selected === placement.ref;
          const firstPad = placement.pads.find((pad) => pad.pin === '1' || pad.pin === 'A1');

          return (
            <g key={placement.ref} className={chosen ? 'spot spot-chosen' : lit ? 'spot spot-lit' : 'spot'}>
              {lit || chosen
                ? placement.pads.map((pad, index) => (
                    <rect
                      key={`${pad.pin}-${index}`}
                      className="spot-pad"
                      x={flip(pad.x) - pad.w / 2}
                      y={pad.y - pad.h / 2}
                      width={pad.w}
                      height={pad.h}
                      rx={0.1}
                    />
                  ))
                : null}
              {lit || chosen ? (
                <circle
                  className="spot-ring"
                  cx={flip(placement.x)}
                  cy={placement.y}
                  r={Math.min(Math.hypot(box.width, box.height) / 2 + ringGap, 7)}
                />
              ) : null}
              {chosen && firstPad && placement.pads.length > 1 ? (
                <circle className="spot-pin" cx={flip(firstPad.x)} cy={firstPad.y} r={0.24} />
              ) : null}
              {onSelect ? (
                <rect
                  className="spot-hit"
                  x={box.left - HIT_MARGIN_MM}
                  y={box.top - HIT_MARGIN_MM}
                  width={box.width + HIT_MARGIN_MM * 2}
                  height={box.height + HIT_MARGIN_MM * 2}
                  onClick={() => onSelect(placement.ref)}
                >
                  <title>{placement.ref}</title>
                </rect>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
