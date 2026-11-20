'use client';

import { formatRefs, lineStatus, type BoardLine, type BoardUse, type LineStatus, type ScanVerdict, type StockNote } from '@uwat/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatNumber, plural } from '@/lib/format';
import { Icon } from './Icon';

export interface ScanResult {
  id: number;
  code: string;
  quantity: number | null;
  verdict: ScanVerdict;
  /** Filled in a moment later when a part isn't for this board. */
  otherBoards: BoardUse[] | null;
  stock: StockNote | null;
}

const SCAN_INTERVAL_MS = 220;
/** The camera sees the same label many times a second, so hold off before reading it again. */
const REPEAT_HOLD_MS = 2500;

function otherBoardText(boards: BoardUse[] | null): string {
  if (boards === null) return 'Checking other boards…';
  const [first] = boards;
  if (!first) return 'Not on any other board.';
  return boards.map((use) => `Goes on ${use.boardName}: ${formatRefs(use.refs)}`).join('. ');
}

export function ScanBanner({
  result,
  onClose,
  placed = null,
  onTogglePlaced,
  partId = null,
}: {
  result: ScanResult;
  onClose: () => void;
  /** Whether this board's part is ticked off as soldered. Null when the banner isn't about one. */
  placed?: boolean | null;
  onTogglePlaced?: () => void;
  /** The inventory part, once known, for a link to its stock. */
  partId?: string | null;
}) {
  const { verdict, code, quantity } = result;
  const dismiss = (
    <button type="button" className="icon-button" aria-label="Dismiss" onClick={onClose}>
      <Icon name="close" />
    </button>
  );
  const editStock = partId ? (
    <Link className="button" href={`/?part=${partId}`}>
      Edit stock
    </Link>
  ) : null;
  const stock = (
    <>
      {result.stock ? <StockLine note={result.stock} /> : null}
      {editStock ? <div className="scan-actions">{editStock}</div> : null}
    </>
  );

  if (verdict.kind === 'not-here') {
    return (
      <section className="scan-banner scan-banner-no" role="status">
        <header>
          <h2>Not for this board</h2>
          {dismiss}
        </header>
        <p className="scan-spots">{code}</p>
        <p className="scan-note">{otherBoardText(result.otherBoards)}</p>
        {stock}
      </section>
    );
  }

  const { line } = verdict;
  if (verdict.kind === 'leave-empty') {
    return (
      <section className="scan-banner scan-banner-warn" role="status">
        <header>
          <h2>Leave this one off</h2>
          {dismiss}
        </header>
        <p className="scan-value">{line.value ?? code}</p>
        <p className="scan-note">The BOM says do not populate {formatRefs(line.refs)}.</p>
        {stock}
      </section>
    );
  }

  return (
    <section className="scan-banner" role="status">
      <header>
        <h2>Goes on this board</h2>
        {dismiss}
      </header>
      <p className="scan-value">{line.value ?? code}</p>
      {line.description ? <p className="scan-note">{line.description}</p> : null}
      <p className="scan-spots">
        {plural(line.refs.length, 'spot')}: {formatRefs(line.refs)}
      </p>
      {quantity !== null && quantity < line.refs.length ? (
        <p className="scan-note">Only {formatNumber(quantity)} in this bag, not enough for one board.</p>
      ) : null}
      {result.stock ? <StockLine note={result.stock} /> : null}
      <div className="scan-actions">
        {placed !== null && onTogglePlaced ? (
          <button
            type="button"
            className={placed ? 'button button-primary' : 'button'}
            aria-pressed={placed}
            onClick={onTogglePlaced}
          >
            {placed ? '✓ On the board' : 'Mark as on the board'}
          </button>
        ) : null}
        {editStock}
      </div>
    </section>
  );
}

function StockLine({ note }: { note: StockNote }) {
  const text = {
    adding: 'Adding to stock…',
    added: note.state === 'added' ? `Added to stock. ${formatNumber(note.total)} in stock now.` : '',
    already: 'Already added to stock.',
    failed: note.state === 'failed' ? `Not added to stock. ${note.message}` : '',
  }[note.state];
  return <p className={`scan-stock scan-stock-${note.state}`}>{text}</p>;
}

const SECTIONS: ReadonlyArray<{ status: LineStatus; title: string }> = [
  { status: 'needed', title: 'Still needed' },
  { status: 'in-stock', title: 'In stock, not on the board yet' },
  { status: 'placed', title: 'On the board' },
];

/**
 * The board's parts, by where they stand. The box ticks a part off as soldered, for everyone.
 * Clicking the name lights its spots on the board.
 */
export function Checklist({
  lines,
  onPick,
  onTogglePlaced,
  onClose,
}: {
  lines: readonly BoardLine[];
  onPick: (refs: string[]) => void;
  onTogglePlaced: (line: BoardLine) => void;
  onClose: () => void;
}) {
  const placed = lines.filter((line) => line.placed).length;
  const stocked = lines.filter((line) => lineStatus(line) === 'in-stock').length;

  return (
    <aside className="checklist" aria-label="Parts for this board">
      <header>
        <div>
          <h2>
            {placed} of {lines.length} on the board
          </h2>
          <p>
            {stocked} in stock to fit · {lines.length - placed - stocked} still needed
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="checklist-body">
        {SECTIONS.map(({ status, title }) => {
          const group = lines.filter((line) => lineStatus(line) === status);
          if (group.length === 0) return null;
          return (
            <section key={status}>
              <h3>{title}</h3>
              <ul>
                {group.map((line) => {
                  const name = line.value ?? line.partNumber ?? line.mfrPartNumber ?? line.refs.join(', ');
                  return (
                    <li key={line.key} className={line.placed ? 'is-found' : undefined}>
                      <input
                        type="checkbox"
                        checked={line.placed}
                        onChange={() => onTogglePlaced(line)}
                        aria-label={`${name} is on the board`}
                      />
                      <button type="button" onClick={() => onPick(line.refs)}>
                        <span>{name}</span>
                        <small>
                          {formatRefs(line.refs)} · {line.stock > 0 ? `${formatNumber(line.stock)} in stock` : 'none in stock'}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

async function loadDetector(): Promise<Detector> {
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  // Served from this site, so scanning doesn't depend on someone else's CDN.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : `${prefix}${path}`),
    },
  });
  // No 1D codes: DigiKey's long barcodes never hold the part, and they'd crowd out the square code.
  return new BarcodeDetector({ formats: ['data_matrix', 'qr_code'] }) as unknown as Detector;
}

export function CameraScanner({ onScan, onClose }: { onScan: (code: string) => boolean; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting the camera…');
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = { code: '', at: 0 };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('The camera needs this site on HTTPS.');
        return;
      }
      try {
        const [detector, media] = await Promise.all([
          loadDetector(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          }),
        ]);
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const element = video.current;
        if (!element) return;
        element.srcObject = media;
        await element.play();
        setStatus('Hold the square barcode on the bag up to the camera.');

        const tick = async () => {
          if (stopped) return;
          try {
            const [hit] = await detector.detect(element);
            const now = Date.now();
            if (hit && (hit.rawValue !== last.code || now - last.at > REPEAT_HOLD_MS)) {
              last = { code: hit.rawValue, at: now };
              if (!scanRef.current(hit.rawValue)) setStatus("That code isn't a parts label.");
            }
          } catch {
            // A frame that can't be read is normal. The next one usually can.
          }
          timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
        };
        void tick();
      } catch {
        setStatus("Couldn't open the camera. Check the browser's permission for it.");
      }
    };
    void start();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <aside className="camera" aria-label="Camera scanner">
      <video ref={video} muted playsInline />
      <footer>
        <span>{status}</span>
        <button type="button" className="icon-button" aria-label="Close camera" onClick={onClose}>
          <Icon name="close" />
        </button>
      </footer>
    </aside>
  );
}
