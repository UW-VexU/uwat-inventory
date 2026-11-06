'use client';

import {
  describeRole,
  filterParts,
  formatRefs,
  friendlyNet,
  parseRefList,
  refKind,
  refKindName,
  type BoardDetail,
  type BoardSide,
  type BoardSummary,
  type ImportProblem,
  type PartSummary,
  type PlacementView,
} from '@uwat/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, putFile } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { BoardView } from './BoardView';
import { BoxTag } from './BoxTag';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { WiringDiagram } from './WiringDiagram';

type View = BoardSide | 'schematic';

interface BomResult {
  linked: number;
  notInStock: { partNumber: string | null; refs: string[] }[];
  notOnBoard: string[];
  problems: ImportProblem[];
}

const LIKELY_CATEGORIES: Record<string, readonly string[]> = {
  R: ['Resistors'],
  C: ['Capacitors'],
  L: ['Inductors'],
  D: ['Diodes', 'LEDs', 'Protection'],
  U: ['ICs', 'Sensors'],
  J: ['Connectors'],
  SW: ['Switches'],
  F: ['Protection'],
  Y: ['Crystals'],
};

const MAX_SUGGESTIONS = 8;

function setUrlRef(ref: string | null) {
  const url = new URL(window.location.href);
  if (ref) url.searchParams.set('ref', ref);
  else url.searchParams.delete('ref');
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
  const [selected, setSelected] = useState<string | null>(params.get('ref'));
  const [filter, setFilter] = useState('');
  const [bom, setBom] = useState<BomResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const bomInput = useRef<HTMLInputElement>(null);
  const schematicInput = useRef<HTMLInputElement>(null);

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

  const placements = useMemo(() => detail?.placements ?? [], [detail]);
  const spot = placements.find((placement) => placement.ref === selected) ?? null;

  const select = useCallback(
    (ref: string | null) => {
      setSelected(ref);
      setUrlRef(ref);
      const target = placements.find((placement) => placement.ref === ref);
      if (target) setView(target.side);
    },
    [placements],
  );

  // Arriving from a part's panel, the board has to open on the side that spot is on.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !spot) return;
    opened.current = true;
    setView(spot.side);
  }, [spot]);

  const groups = useMemo(() => {
    const needle = filter.trim().toUpperCase();
    const matches = (placement: PlacementView) => {
      if (!needle) return true;
      const words = [
        placement.ref,
        describeRole(placement, placements),
        placement.part?.description,
        placement.value,
        ...placement.pads.map((pad) => friendlyNet(pad.net)),
      ];
      return words.join(' ').toUpperCase().includes(needle);
    };
    const byKind = new Map<string, PlacementView[]>();
    for (const placement of placements.filter(matches)) {
      const kind = refKindName(refKind(placement.ref));
      byKind.set(kind, [...(byKind.get(kind) ?? []), placement]);
    }
    return [...byKind];
  }, [placements, filter]);

  if (problem) return <div className="page"><p className="form-error">{problem}</p></div>;
  if (!detail) return <div className="page"><p className="muted">Loading board…</p></div>;

  const { board } = detail;
  const highlighted = new Set(selected ? [selected] : []);

  const uploadBom = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await api<BomResult>(`/api/boards/${id}/bom`, { method: 'POST', body: { text: await file.text() } });
      setBom(result);
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
    <div className="board-screen">
      <div className="board-main">
        <header className="page-head">
          <div>
            <h1>
              {board.name}
              {board.revision ? <small> rev {board.revision}</small> : null}
            </h1>
            <p className="muted">
              {board.linkedCount} of {plural(board.placementCount, 'spot')} linked to parts · {board.widthMm} × {board.heightMm} mm
            </p>
          </div>
          <div className="page-actions">
            <button type="button" className="button" onClick={() => bomInput.current?.click()}>
              <Icon name="upload" />
              Upload BOM
            </button>
            <button type="button" className="button" onClick={() => schematicInput.current?.click()}>
              <Icon name="upload" />
              {board.hasSchematic ? 'Replace schematic' : 'Add schematic'}
            </button>
          </div>
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
        </header>

        {bom ? <BomReport result={bom} onClose={() => setBom(null)} /> : null}

        <div className="tabs" role="tablist" aria-label="Board view">
          {(['top', 'bottom'] as const).map((side) => (
            <button key={side} type="button" role="tab" aria-selected={view === side} onClick={() => setView(side)}>
              {side === 'top' ? 'Top' : 'Bottom'}
            </button>
          ))}
          {board.hasSchematic ? (
            <button type="button" role="tab" aria-selected={view === 'schematic'} onClick={() => setView('schematic')}>
              Schematic
            </button>
          ) : null}
        </div>

        {view === 'schematic' ? (
          <SchematicView board={board} />
        ) : (
          <>
            <BoardView
              boardId={board.id}
              widthMm={board.widthMm}
              heightMm={board.heightMm}
              side={view}
              placements={placements}
              highlighted={highlighted}
              selected={selected}
              onSelect={select}
            />
            <p className="board-hint">
              Click any part on the board.{view === 'bottom' ? ' This is the board flipped over.' : ''}
              {spot ? ' The white dot marks pin 1.' : ''}
            </p>
          </>
        )}

        {confirmingDelete ? (
          <div className="bag-confirm board-replace">
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
        ) : (
          <button type="button" className="link-button link-danger" onClick={() => setConfirmingDelete(true)}>
            Delete board
          </button>
        )}
      </div>

      <aside className="board-side" aria-label="Parts on this board">
        {spot ? (
          <SpotCard
            key={spot.ref}
            boardId={board.id}
            spot={spot}
            placements={placements}
            onClose={() => select(null)}
            onChanged={async () => {
              await load();
              await refresh();
            }}
          />
        ) : null}

        <label className="field board-filter">
          <span className="sr-only">Filter spots</span>
          <input
            type="search"
            value={filter}
            placeholder="Find a spot: R12, SD_CMD, pull-up"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>

        {groups.map(([kind, spots]) => (
          <section key={kind} className="spot-group">
            <h2>
              {kind} <span>{spots.length}</span>
            </h2>
            <ul>
              {spots.map((placement) => (
                <li key={placement.ref}>
                  <button
                    type="button"
                    className="spot-row"
                    aria-current={selected === placement.ref ? 'true' : undefined}
                    onClick={() => select(placement.ref)}
                  >
                    <strong>{placement.ref}</strong>
                    <span className="spot-row-text">
                      {placement.part?.description ?? placement.value ?? describeRole(placement, placements) ?? 'No part linked'}
                    </span>
                    {placement.part ? <span className="spot-linked" title="Linked to a part" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 ? <p className="muted">No spots match.</p> : null}
      </aside>
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
    <section className="bom-report" role="status">
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
        <p>
          In the BOM but not on this board, so check the revision: {formatRefs(result.notOnBoard)}
        </p>
      ) : null}
      {result.problems.map((item) => (
        <p key={item.line}>
          Line {item.line}: {item.message}
        </p>
      ))}
    </section>
  );
}

function SpotCard({
  boardId,
  spot,
  placements,
  onClose,
  onChanged,
}: {
  boardId: string;
  spot: PlacementView;
  placements: readonly PlacementView[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const role = describeRole(spot, placements);
  return (
    <section className="spot-card">
      <header className="spot-card-head">
        <span className="box-tag box-tag-large">
          <span>{spot.ref}</span>
        </span>
        <span className="eyebrow">
          {spot.side === 'top' ? 'Top' : 'Bottom'}
          {spot.packageGuess ? ` · looks like ${spot.packageGuess}` : ''}
        </span>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {role ? <p className="spot-role">{role}</p> : null}
      <WiringDiagram placement={spot} all={placements} />
      <SpotPart boardId={boardId} spot={spot} onChanged={onChanged} />
    </section>
  );
}

function SpotPart({
  boardId,
  spot,
  onChanged,
}: {
  boardId: string;
  spot: PlacementView;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [linking, setLinking] = useState(false);

  const unlink = async () => {
    try {
      await api(`/api/boards/${boardId}/link`, { method: 'POST', body: { refs: [spot.ref], partId: null } });
      await onChanged();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  if (linking) {
    return (
      <PartPicker
        boardId={boardId}
        spot={spot}
        onDone={async () => {
          setLinking(false);
          await onChanged();
        }}
        onCancel={() => setLinking(false)}
      />
    );
  }

  if (!spot.part) {
    return (
      <div className="spot-part">
        <h3>What goes here</h3>
        {spot.bomPartNumber ? (
          <p className="muted">The BOM says {spot.bomPartNumber}, which isn't in stock.</p>
        ) : (
          <p className="muted">No part linked. Gerbers don't say what goes here, so upload a BOM or pick one.</p>
        )}
        <button type="button" className="button" onClick={() => setLinking(true)}>
          Link a part
        </button>
      </div>
    );
  }

  return (
    <div className="spot-part">
      <h3>What goes here</h3>
      <Link href={`/?part=${spot.part.id}`} className="spot-part-name">
        {spot.part.description}
      </Link>
      <p className="muted">{spot.part.partNumber}</p>
      <div className="spot-part-stock">
        <span className={spot.part.total === 0 ? 'qty qty-out' : 'qty'}>{formatNumber(spot.part.total)}</span>
        <span className="muted">in stock</span>
        <span className="tags">
          {spot.part.boxes.map((code) => (
            <BoxTag key={code} code={code} />
          ))}
        </span>
      </div>
      <div className="bag-actions">
        <button type="button" className="link-button" onClick={() => setLinking(true)}>
          Change
        </button>
        <button type="button" className="link-button link-danger" onClick={() => void unlink()}>
          Unlink
        </button>
      </div>
    </div>
  );
}

function PartPicker({
  boardId,
  spot,
  onDone,
  onCancel,
}: {
  boardId: string;
  spot: PlacementView;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { snapshot } = useInventory();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [spots, setSpots] = useState(spot.ref);

  const refs = parseRefList(spots);
  const suggestions = useMemo(() => {
    const parts = snapshot?.parts ?? [];
    if (query.trim()) return filterParts(parts, { query }).slice(0, MAX_SUGGESTIONS);

    const categories = LIKELY_CATEGORIES[refKind(spot.ref)] ?? [];
    const likely = parts.filter((part) => categories.includes(part.category));
    const sized = spot.packageGuess ? likely.filter((part) => part.package === spot.packageGuess) : likely;
    return filterParts(sized.length > 0 ? sized : likely, {}).slice(0, MAX_SUGGESTIONS);
  }, [snapshot, query, spot]);

  const link = async (part: PartSummary) => {
    if (!refs) return;
    try {
      await api(`/api/boards/${boardId}/link`, { method: 'POST', body: { refs, partId: part.id } });
      toast(`Linked ${formatRefs(refs)} to ${part.description}.`);
      await onDone();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <div className="spot-part">
      <h3>Link a part</h3>
      <label className="field">
        <span>Spots</span>
        <input value={spots} spellCheck={false} onChange={(event) => setSpots(event.target.value)} />
        <small>Link several at once, like R9-R14.</small>
      </label>
      <label className="field">
        <span>Part</span>
        <input
          type="search"
          value={query}
          autoFocus
          autoComplete="off"
          placeholder={spot.packageGuess ? `Showing ${spot.packageGuess} parts. Search for others.` : 'Search parts'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="picker">
        {suggestions.map((part) => (
          <li key={part.id}>
            <button type="button" disabled={!refs} onClick={() => void link(part)}>
              <span>{part.description}</span>
              <small>
                {formatNumber(part.total)} in stock{part.partNumber ? ` · ${part.partNumber}` : ''}
              </small>
            </button>
          </li>
        ))}
        {suggestions.length === 0 ? <li className="muted">No parts match.</li> : null}
      </ul>
      <button type="button" className="link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
