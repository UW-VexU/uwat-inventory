'use client';

import {
  describeRole,
  findSpots,
  formatRefs,
  refKind,
  refKindName,
  shortPartName,
  type BoardDetail,
  type BoardSide,
  type BoardSummary,
  type ImportProblem,
  type PlacementView,
} from '@uwat/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, putFile } from '@/lib/api';
import { plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { BoardCanvas, type BoardCanvasHandle } from './BoardCanvas';
import { Icon } from './Icon';
import { SpotCard } from './SpotCard';
import { useToast } from './Toast';

type View = BoardSide | 'schematic';

interface BomResult {
  linked: number;
  notInStock: { partNumber: string | null; refs: string[] }[];
  notOnBoard: string[];
  problems: ImportProblem[];
}

const INSETS = { top: 118, right: 24, bottom: 24, left: 24 };
const PHONE_INSETS = { top: 150, right: 8, bottom: 16, left: 8 };
const PHONE_WIDTH = 760;
const MAX_LABEL_CHARS = 24;

const clip = (text: string) => (text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text);

function setFindInUrl(find: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete('ref');
  if (find) url.searchParams.set('find', find);
  else url.searchParams.delete('find');
  window.history.replaceState(null, '', url);
}

export function BoardScreen() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useInventory();

  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View>('top');
  const [query, setQuery] = useState(params.get('find') ?? params.get('ref') ?? '');
  const [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [bom, setBom] = useState<BomResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [phone, setPhone] = useState(false);
  const canvas = useRef<BoardCanvasHandle>(null);
  const bomInput = useRef<HTMLInputElement>(null);
  const schematicInput = useRef<HTMLInputElement>(null);
  const openedSide = useRef(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<BoardDetail>(`/api/boards/${id}`));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const check = () => setPhone(window.innerWidth <= PHONE_WIDTH);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const placements = useMemo(() => detail?.placements ?? [], [detail]);
  const matches = useMemo(() => findSpots(placements, query, kind), [placements, query, kind]);
  const spotsBySide = useMemo(() => new Map(placements.map((spot) => [spot.ref, spot.side])), [placements]);

  const side: BoardSide = view === 'bottom' ? 'bottom' : 'top';
  const here = useMemo(() => matches.filter((ref) => spotsBySide.get(ref) === side), [matches, side, spotsBySide]);
  const otherSideCount = matches.length - here.length;
  const matched = useMemo(() => new Set(here), [here]);
  const spot = placements.find((placement) => placement.ref === selected) ?? null;

  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const placement of placements) {
      const name = refKindName(refKind(placement.ref));
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [placements]);

  // Arriving from a part, open on the side its spots are on.
  useEffect(() => {
    if (openedSide.current || placements.length === 0 || matches.length === 0) return;
    openedSide.current = true;
    const onTop = matches.filter((ref) => spotsBySide.get(ref) === 'top').length;
    if (onTop * 2 < matches.length) setView('bottom');
  }, [matches, placements, spotsBySide]);

  const search = (text: string) => {
    setQuery(text);
    setFindInUrl(text);
    setSelected(null);
  };

  const flyToMatches = () => {
    if (matches.length === 0) return;
    const first = matches[0];
    if (here.length === 0 && first) setView(spotsBySide.get(first) ?? 'top');
    if (matches.length === 1 && first) setSelected(first);
    // The canvas needs a frame to pick up a side change before it can fly there.
    requestAnimationFrame(() => canvas.current?.focus(here.length > 0 ? here : matches));
  };

  const labelLines = useCallback(
    (placement: PlacementView, level: number): string[] => {
      if (level === 0) return [placement.ref];
      const role = describeRole(placement, placements);
      const box = placement.part?.boxes[0];
      const part = placement.part ? `${shortPartName(placement.part.description)}${box ? ` · ${box}` : ''}` : null;
      const what = part ?? placement.value ?? null;
      const lines = [placement.ref];
      if (what) lines.push(clip(what));
      if (role && (level === 2 || !what)) lines.push(clip(role));
      if (lines.length === 1) lines.push('Nothing linked');
      return lines;
    },
    [placements],
  );

  const summary = useCallback(
    (placement: PlacementView): string => {
      const role = describeRole(placement, placements);
      if (placement.part) {
        const where = placement.part.boxes[0] ? ` in ${placement.part.boxes.join(', ')}` : '';
        return `${placement.part.description}${where}`;
      }
      return [placement.value, role].filter(Boolean).join(' · ') || 'Nothing linked yet';
    },
    [placements],
  );

  if (problem) return <div className="page"><p className="form-error">{problem}</p></div>;
  if (!detail) return <div className="page"><p className="muted">Loading board…</p></div>;

  const { board } = detail;
  const filtering = Boolean(query.trim() || kind);

  const uploadBom = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBom(await api<BomResult>(`/api/boards/${id}/bom`, { method: 'POST', body: { text: await file.text() } }));
      await load();
      await refresh();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  const uploadSchematic = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await putFile<{ board: BoardSummary }>(`/api/boards/${id}/schematic`, file);
      setDetail((current) => (current ? { ...current, board: result.board } : current));
      setView('schematic');
      toast('Schematic added.');
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  const deleteBoard = async () => {
    try {
      await api(`/api/boards/${id}`, { method: 'DELETE' });
      await refresh();
      router.push('/boards');
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <div className="stage">
      {view === 'schematic' ? (
        <SchematicView board={board} />
      ) : (
        <BoardCanvas
          ref={canvas}
          boardId={board.id}
          widthMm={board.widthMm}
          heightMm={board.heightMm}
          side={side}
          placements={placements}
          matched={matched}
          selected={selected}
          labelLines={labelLines}
          summary={summary}
          onSelect={setSelected}
          insets={phone ? PHONE_INSETS : INSETS}
        />
      )}

      <header className="stage-bar">
        <div className="stage-row">
          <Link href="/boards" className="stage-title">
            {board.name}
            {board.revision ? <small> rev {board.revision}</small> : null}
          </Link>

          <div className="segments" role="tablist" aria-label="Board view">
            {(['top', 'bottom'] as const).map((name) => (
              <button key={name} type="button" role="tab" aria-selected={view === name} onClick={() => setView(name)}>
                {name === 'top' ? 'Top' : 'Bottom'}
              </button>
            ))}
            {board.hasSchematic ? (
              <button type="button" role="tab" aria-selected={view === 'schematic'} onClick={() => setView('schematic')}>
                Schematic
              </button>
            ) : null}
          </div>

          <form
            className="stage-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              flyToMatches();
            }}
          >
            <Icon name="search" />
            <input
              type="search"
              aria-label="What part have you got?"
              value={query}
              placeholder="What have you got? 10k, resistor, 0603, R12"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => search(event.target.value)}
            />
          </form>

          <details className="stage-more">
            <summary aria-label="More actions">
              <Icon name="edit" />
            </summary>
            <div className="stage-menu">
              <button type="button" onClick={() => bomInput.current?.click()}>
                Upload BOM
              </button>
              <button type="button" onClick={() => schematicInput.current?.click()}>
                {board.hasSchematic ? 'Replace schematic' : 'Add schematic'}
              </button>
              <button type="button" className="link-danger" onClick={() => setConfirmingDelete(true)}>
                Delete board
              </button>
            </div>
          </details>
        </div>

        <div className="stage-row">
          <div className="chips chips-tight" role="group" aria-label="Show a kind of part">
            {kinds.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className="chip"
                aria-pressed={kind === name}
                onClick={() => {
                  setKind(kind === name ? null : name);
                  setSelected(null);
                }}
              >
                {name}
                <span>{count}</span>
              </button>
            ))}
          </div>
          {filtering ? (
            <p className="stage-result" aria-live="polite">
              {matches.length === 0 ? (
                <span className="muted">No spots match. Click a spot to link it, or upload a BOM.</span>
              ) : (
                <>
                  <strong>{here.length}</strong> {here.length === 1 ? 'spot' : 'spots'}
                  {here.length > 0 && here.length <= 8 ? <span className="muted"> {formatRefs(here)}</span> : null}
                  {otherSideCount > 0 ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setView(side === 'top' ? 'bottom' : 'top')}
                    >
                      +{otherSideCount} on the {side === 'top' ? 'bottom' : 'top'}
                    </button>
                  ) : null}
                </>
              )}
            </p>
          ) : null}
        </div>
      </header>

      {spot && view !== 'schematic' ? (
        <SpotCard
          key={spot.ref}
          boardId={board.id}
          spot={spot}
          placements={placements}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load();
            await refresh();
          }}
        />
      ) : null}

      {bom ? <BomReport result={bom} onClose={() => setBom(null)} /> : null}

      {confirmingDelete ? (
        <div className="bag-confirm stage-confirm">
          <p>Delete this board and its links? Parts and stock aren't affected, but this can't be undone.</p>
          <div>
            <button type="button" className="button button-danger" onClick={() => void deleteBoard()}>
              Delete board
            </button>
            <button type="button" className="button" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={bomInput}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="Choose a BOM file"
        onChange={(event) => {
          void uploadBom(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={schematicInput}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="sr-only"
        aria-label="Choose a schematic file"
        onChange={(event) => {
          void uploadSchematic(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function SchematicView({ board }: { board: BoardSummary }) {
  const url = `/api/boards/${board.id}/schematic`;
  return (
    <div className="schematic">
      {board.schematicType === 'application/pdf' ? (
        <iframe src={url} title={`${board.name} schematic`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`${board.name} schematic`} />
      )}
    </div>
  );
}

function BomReport({ result, onClose }: { result: BomResult; onClose: () => void }) {
  return (
    <section className="bom-report stage-report" role="status">
      <header>
        <h2>Linked {plural(result.linked, 'spot')}</h2>
        <button type="button" className="icon-button" aria-label="Dismiss" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {result.notInStock.length > 0 ? (
        <>
          <p>Not in stock yet. These link by themselves once the bags are added:</p>
          <ul>
            {result.notInStock.map((row) => (
              <li key={row.refs.join()}>
                {row.partNumber ?? 'Unknown part'} · {formatRefs(row.refs)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {result.notOnBoard.length > 0 ? (
        <p>In the BOM but not on this board, so check the revision: {formatRefs(result.notOnBoard)}</p>
      ) : null}
      {result.problems.map((item) => (
        <p key={item.line}>
          Line {item.line}: {item.message}
        </p>
      ))}
    </section>
  );
}
