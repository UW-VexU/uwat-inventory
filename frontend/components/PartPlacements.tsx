'use client';

import {
  describeRole,
  formatRefs,
  type BoardDetail,
  type BoardSide,
  type BoardUse,
  type PartSummary,
} from '@uwat/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { BoardView } from './BoardView';
import { WiringDiagram } from './WiringDiagram';

function BoardUseCard({ use }: { use: BoardUse }) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

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
  const spots = useMemo(
    () => (detail?.placements ?? []).filter((placement) => mine.has(placement.ref)),
    [detail, mine],
  );

  const title = use.revision ? `${use.boardName} rev ${use.revision}` : use.boardName;
  if (failed) return <p className="muted">Couldn't load {title}.</p>;
  if (!detail) return <p className="muted">Loading {title}…</p>;

  const chosenSpot = spots.find((spot) => spot.ref === chosen) ?? null;
  const topCount = spots.filter((spot) => spot.side === 'top').length;
  const side: BoardSide = chosenSpot?.side ?? (topCount >= spots.length - topCount ? 'top' : 'bottom');
  const otherSide = spots.some((spot) => spot.side !== side);

  return (
    <article className="use">
      <header className="use-head">
        <Link href={`/boards/${use.boardId}`} className="use-title">
          {title}
        </Link>
        <span className="muted">{use.refs.length} per board</span>
      </header>

      <BoardView
        boardId={use.boardId}
        widthMm={detail.board.widthMm}
        heightMm={detail.board.heightMm}
        side={side}
        placements={detail.placements}
        highlighted={chosen ? new Set([chosen]) : mine}
        selected={chosen}
      />
      {otherSide ? <p className="use-note">Some spots are on the other side of the board.</p> : null}

      <ul className="use-spots">
        {spots.map((spot) => (
          <li key={spot.ref}>
            <button
              type="button"
              className="use-spot"
              aria-expanded={chosen === spot.ref}
              onClick={() => setChosen(chosen === spot.ref ? null : spot.ref)}
            >
              <strong>{spot.ref}</strong>
              <span>{describeRole(spot, detail.placements) ?? 'See wiring'}</span>
            </button>
            {chosen === spot.ref ? <WiringDiagram placement={spot} all={detail.placements} /> : null}
          </li>
        ))}
      </ul>

      <footer className="use-links">
        <Link className="link-button" href={`/boards/${use.boardId}?ref=${spots[0]?.ref ?? ''}`}>
          Open board
        </Link>
        {detail.board.hasSchematic ? (
          <a className="link-button" href={`/api/boards/${use.boardId}/schematic`} target="_blank" rel="noreferrer">
            Open schematic
          </a>
        ) : null}
      </footer>
    </article>
  );
}

export function PartPlacements({ part }: { part: PartSummary }) {
  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Where it goes</h3>
        {part.usedOn.length > 0 ? (
          <span className="muted">{formatRefs(part.usedOn.flatMap((use) => use.refs))}</span>
        ) : null}
      </div>
      {part.usedOn.length === 0 ? (
        <p className="muted">
          Not linked to a board yet. Link it from <Link href="/boards">Boards</Link>.
        </p>
      ) : null}
      {part.usedOn.map((use) => (
        <BoardUseCard key={use.boardId} use={use} />
      ))}
    </section>
  );
}
