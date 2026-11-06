'use client';

import { spotBox, type BoardSide, type PlacementGeometry } from '@uwat/shared';

interface Props {
  boardId: string;
  widthMm: number;
  heightMm: number;
  side: BoardSide;
  placements: readonly PlacementGeometry[];
  /** Spots to mark in gold. */
  highlighted: ReadonlySet<string>;
}

/** A small picture of a board for showing where a part goes. BoardCanvas is the full, zoomable one. */

export function BoardView({ boardId, widthMm, heightMm, side, placements, highlighted }: Props) {
  // The bottom drawing is mirrored, as if the board were flipped over in your hand.
  const flip = (x: number) => (side === 'bottom' ? widthMm - x : x);
  const lit = placements.filter((placement) => placement.side === side && highlighted.has(placement.ref));
  // Neighbouring spots share a lot of space, so a crowd of rings needs to sit tighter.
  const ringGap = highlighted.size > 3 ? 0.15 : 0.55;

  return (
    <div className="board-view" style={{ aspectRatio: `${widthMm} / ${heightMm}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/boards/${boardId}/${side}.svg`} alt={`${side === 'top' ? 'Top' : 'Bottom'} of the board`} />
      <svg viewBox={`0 0 ${widthMm} ${heightMm}`} aria-hidden="true">
        {lit.map((placement) => {
          const box = spotBox(placement, widthMm, side);
          return (
            <g key={placement.ref}>
              {placement.pads.map((pad, index) => (
                <rect
                  key={`${pad.pin}-${index}`}
                  className="spot-pad"
                  x={flip(pad.x) - pad.w / 2}
                  y={pad.y - pad.h / 2}
                  width={pad.w}
                  height={pad.h}
                  rx={0.1}
                />
              ))}
              <circle
                className="spot-ring"
                cx={flip(placement.x)}
                cy={placement.y}
                r={Math.min(Math.hypot(box.right - box.left, box.bottom - box.top) / 2 + ringGap, 7)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
