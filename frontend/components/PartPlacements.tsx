'use client';

import { formatRefs, type BoardDetail, type BoardSide, type BoardUse, type PartSummary } from '@uwat/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { BoardView } from './BoardView';

/** One glance at where a part goes. Tapping it opens the full board with these spots lit. */
function BoardUseCard({ use }: { use: BoardUse }) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<BoardDetail>(`/api/boards/${use.boardId}`)
      .then((result) => {
        if (live) setDetail(result);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [use.boardId]);

  const mine = useMemo(() => new Set(use.refs), [use.refs]);
  const title = use.revision ? `${use.boardName} rev ${use.revision}` : use.boardName;

  if (failed) return <p className="muted">Couldn't load {title}.</p>;
  if (!detail) return <p className="muted">Loading {title}…</p>;

  const spots = detail.placements.filter((placement) => mine.has(placement.ref));
  const topCount = spots.filter((spot) => spot.side === 'top').length;
  const side: BoardSide = topCount * 2 >= spots.length ? 'top' : 'bottom';

  return (
    <Link href={`/boards/${use.boardId}?find=${use.refs.join(',')}`} className="use" aria-label={`Open ${title} with these spots lit`}>
      <BoardView
        boardId={use.boardId}
        widthMm={detail.board.widthMm}
        heightMm={detail.board.heightMm}
        side={side}
        placements={detail.placements}
        highlighted={mine}
      />
      <span className="use-caption">
        <strong>{title}</strong>
        <span>{use.refs.length} per board · {formatRefs(use.refs)}</span>
      </span>
    </Link>
  );
}

export function PartPlacements({ part }: { part: PartSummary }) {
  if (part.usedOn.length === 0) return null;
  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Where it goes</h3>
      </div>
      {part.usedOn.map((use) => (
        <BoardUseCard key={use.boardId} use={use} />
      ))}
    </section>
  );
}
