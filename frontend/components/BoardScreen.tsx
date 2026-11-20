'use client';

import {
  boardLines,
  classifyScan,
  describeRole,
  findSpots,
  formatRefs,
  judgeScan,
  shortPartName,
  type BoardDetail,
  type BoardSide,
  type BoardSummary,
  type BagLabel,
  type BoardLine,
  type BoardUse,
  type ImportProblem,
  type PartSummary,
  type PlacementView,
  type StockNote,
} from '@uwat/shared';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure, errorMessage, newRequestId, putFile } from '@/lib/api';
import { plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { BoardCanvas, type BoardCanvasHandle } from './BoardCanvas';
import { Icon } from './Icon';
import { CameraScanner, Checklist, ScanBanner, type ScanResult } from './ScanCheck';
import { SpotCard } from './SpotCard';
import { useToast } from './Toast';

type View = BoardSide | 'schematic';

interface BomResult {
  linked: number;
  leftEmpty: number;
  notInStock: { partNumber: string | null; refs: string[] }[];
  notOnBoard: string[];
  problems: ImportProblem[];
}

// Room for the bar across the top: keep these in step with --stage-bar in globals.css.
const INSETS = { top: 80, right: 24, bottom: 24, left: 24 };
const PHONE_INSETS = { top: 116, right: 8, bottom: 16, left: 8 };
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
  const { refresh, applyPart, liveVersion } = useInventory();

  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View>('top');
  const [query, setQuery] = useState(params.get('find') ?? params.get('ref') ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [bom, setBom] = useState<BomResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [phone, setPhone] = useState(false);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const canvas = useRef<BoardCanvasHandle>(null);
  const scanInput = useRef<HTMLInputElement>(null);
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

  // Again whenever anyone changes stock, so a phone scan ticks parts off here too.
  useEffect(() => {
    void load();
  }, [load, liveVersion]);

  useEffect(() => {
    const check = () => setPhone(window.innerWidth <= PHONE_WIDTH);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const placements = useMemo(() => detail?.placements ?? [], [detail]);
  const scanRefs = scan && scan.verdict.kind !== 'not-here' ? scan.verdict.line.refs : null;
  const typedMatches = useMemo(
    () => (query.startsWith('[)>') ? [] : findSpots(placements, query, null)),
    [placements, query],
  );
  const matches = scanRefs ?? typedMatches;
  const lines = useMemo(() => boardLines(placements), [placements]);
  // Progress is what's soldered on. It's shared, so this page, the boards list and every phone agree.
  const doneRefs = useMemo(() => new Set(lines.filter((line) => line.placed).flatMap((line) => line.refs)), [lines]);
  const placedCount = lines.filter((line) => line.placed).length;
  // The line as it is now, since the one judged at scan time doesn't see later ticks.
  const scanVerdict = scan?.verdict;
  const scannedLine =
    scanVerdict?.kind === 'fits' ? (lines.find((line) => line.key === scanVerdict.line.key) ?? scanVerdict.line) : null;
  const scannedPartId =
    (scan?.stock?.state === 'added' || scan?.stock?.state === 'already' ? scan.stock.partId : null) ??
    scannedLine?.partId ??
    null;

  /** Ticks a part off as soldered, or back. Shows it straight away, then confirms with the server. */
  const togglePlaced = useCallback(
    async (line: BoardLine) => {
      const placed = !line.placed;
      setDetail((current) =>
        current && {
          ...current,
          placements: current.placements.map((spot) => (line.refs.includes(spot.ref) && !spot.dnp ? { ...spot, placed } : spot)),
        },
      );
      try {
        await api(`/api/boards/${id}/placed`, { method: 'POST', body: { refs: line.refs, placed } });
      } catch (error) {
        toast(errorMessage(error), { tone: 'error' });
      }
      await load();
    },
    [id, load, toast],
  );
  // Bags sent to stock on this visit. The camera keeps seeing a label while it's in view.
  const sent = useRef(new Map<string, { requestId: string; note: StockNote }>());
  const spotsBySide = useMemo(() => new Map(placements.map((spot) => [spot.ref, spot.side])), [placements]);

  const side: BoardSide = view === 'bottom' ? 'bottom' : 'top';
  const here = useMemo(() => matches.filter((ref) => spotsBySide.get(ref) === side), [matches, side, spotsBySide]);
  const otherSideCount = matches.length - here.length;
  const matched = useMemo(() => new Set(here), [here]);
  const spot = placements.find((placement) => placement.ref === selected) ?? null;

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
    setScan(null);
  };

  /** Every real bag label scanned here goes into the inventory, whichever board it's for. */
  const addToStock = useCallback(
    (scanId: number, raw: string, label: BagLabel): StockNote => {
      const key = label.labelKey ?? raw;
      const earlier = sent.current.get(key);
      if (earlier && earlier.note.state !== 'failed') return earlier.note;

      const requestId = earlier?.requestId ?? newRequestId();
      const settle = (note: StockNote) => {
        sent.current.set(key, { requestId, note });
        setScan((current) => (current?.id === scanId ? { ...current, stock: note } : current));
      };
      sent.current.set(key, { requestId, note: { state: 'adding' } });
      api<{ part: PartSummary; bagId: string }>('/api/intake', {
        method: 'POST',
        body: {
          partNumber: label.partNumber,
          mfrPartNumber: label.mfrPartNumber,
          quantity: label.quantity ?? 0,
          project: label.project,
          labelKey: label.labelKey,
          requestId,
        },
      })
        .then(({ part, bagId }) => {
          settle({ state: 'added', total: part.total, partId: part.id, bagId });
          applyPart(part);
          void load();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure && error.code === 'duplicate_label') {
            const { partId, bagId } = error.details;
            settle({
              state: 'already',
              partId: typeof partId === 'string' ? partId : null,
              bagId: typeof bagId === 'string' ? bagId : null,
            });
          }
          else settle({ state: 'failed', message: errorMessage(error) });
        });
      return { state: 'adding' };
    },
    [applyPart, load],
  );

  /** Judges a scanned or typed code against this board. False means it wasn't a part code at all. */
  const runScan = useCallback(
    (raw: string): boolean => {
      const judged = judgeScan(raw, placements);
      if (!judged) return false;

      const { bag, verdict } = judged;
      const scanId = Date.now();
      const read = classifyScan(raw);
      const stock = read.kind === 'bag' ? addToStock(scanId, raw, read.label) : null;
      const result: ScanResult = { id: scanId, code: judged.code, quantity: judged.quantity, verdict, otherBoards: null, stock };
      setScan(result);
      setQuery('');
      setSelected(null);
      setFindInUrl('');

      if (verdict.kind === 'not-here') {
        const params = new URLSearchParams();
        if (bag.partNumber) params.set('partNumber', bag.partNumber);
        if (bag.mfrPartNumber) params.set('mfrPartNumber', bag.mfrPartNumber);
        api<{ boards: BoardUse[] }>(`/api/boards/which?${params}`)
          .then(({ boards }) => {
            setScan((current) => (current?.id === result.id ? { ...current, otherBoards: boards } : current));
          })
          .catch(() => undefined);
      } else {
        const onThisSide = verdict.line.refs.some((ref) => spotsBySide.get(ref) === side);
        const first = verdict.line.refs[0];
        if (!onThisSide && first) setView(spotsBySide.get(first) ?? 'top');
      }
      return true;
    },
    [addToStock, placements, side, spotsBySide],
  );

  // A USB scanner just types, so it has to work wherever the focus happens to be.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      scanInput.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      if (placement.dnp) return [placement.ref, 'Leave empty'];
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
      if (placement.dnp) return `Leave empty${placement.value ? ` (${placement.value} not fitted)` : ''}`;
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
  const filtering = Boolean(query.trim());

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
          done={doneRefs}
          warning={scan?.verdict.kind === 'leave-empty'}
          selected={selected}
          labelLines={labelLines}
          summary={summary}
          onSelect={setSelected}
          insets={phone ? PHONE_INSETS : INSETS}
        />
      )}

      <header className="stage-bar">
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
            if (!runScan(query)) flyToMatches();
          }}
        >
          <Icon name="search" />
          <input
            ref={scanInput}
            type="search"
            aria-label="Scan a part, or type what you have"
            value={query}
            autoFocus
            placeholder={phone ? 'Scan or search' : 'Scan a part, or search: 10k, 0603, R12'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => search(event.target.value)}
          />
          {filtering ? (
            <span className="stage-result" aria-live="polite">
              {matches.length === 0 ? (
                <span className="muted">No match</span>
              ) : (
                <>
                  <strong>{here.length}</strong> {here.length === 1 ? 'spot' : 'spots'}
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
            </span>
          ) : null}
          <button
            type="button"
            className="stage-camera"
            aria-label="Scan with the camera"
            title="Scan with the camera"
            aria-pressed={cameraOpen}
            onClick={() => setCameraOpen((open) => !open)}
          >
            <Icon name="camera" />
          </button>
        </form>

        {lines.length > 0 ? (
          <button
            type="button"
            className="stage-progress"
            aria-expanded={checklistOpen}
            aria-label={`${placedCount} of ${lines.length} parts on the board`}
            title="Parts on the board"
            onClick={() => setChecklistOpen((open) => !open)}
          >
            <Icon name="list" size={16} />
            <strong>{placedCount}</strong>
            <span>of {lines.length} on</span>
          </button>
        ) : null}

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

      {scan ? (
        <ScanBanner
          result={scan}
          onClose={() => setScan(null)}
          placed={scannedLine ? scannedLine.placed : null}
          onTogglePlaced={scannedLine ? () => void togglePlaced(scannedLine) : undefined}
          partId={scannedPartId}
        />
      ) : null}

      {cameraOpen ? <CameraScanner onScan={runScan} onClose={() => setCameraOpen(false)} /> : null}

      {checklistOpen ? (
        <Checklist
          lines={lines}
          onPick={(refs) => {
            setChecklistOpen(false);
            search(refs.join(','));
          }}
          onTogglePlaced={(line) => void togglePlaced(line)}
          onClose={() => setChecklistOpen(false)}
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
        <h2>BOM loaded</h2>
        <button type="button" className="icon-button" aria-label="Dismiss" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <p>
        {plural(result.linked, 'spot')} linked to stock.
        {result.leftEmpty > 0 ? ` ${plural(result.leftEmpty, 'spot')} left empty.` : ''}
      </p>
      {result.notInStock.length > 0 ? (
        <p>{plural(result.notInStock.length, 'part')} not in the inventory yet. They link themselves once bags are added.</p>
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
