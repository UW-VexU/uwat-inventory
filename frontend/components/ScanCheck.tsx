'use client';

import { formatRefs, type BoardLine, type BoardUse, type ScanVerdict, type StockNote } from '@uwat/shared';
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
  if (!first) return "It isn't on any board that's been uploaded.";
  return boards.map((use) => `Goes on ${use.boardName}: ${formatRefs(use.refs)}`).join('. ');
}

export function ScanBanner({
  result,
  boardName,
  onClose,
}: {
  result: ScanResult;
  boardName: string;
  onClose: () => void;
}) {
  const { verdict, code, quantity } = result;
  const dismiss = (
    <button type="button" className="icon-button" aria-label="Dismiss" onClick={onClose}>
      <Icon name="close" />
    </button>
  );
  const stock = result.stock ? <StockLine note={result.stock} /> : null;

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
        <p className="scan-note">
          {boardName} has a spot for it at {formatRefs(line.refs)}, but the BOM says do not populate.
        </p>
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
      {quantity !== null ? (
        <p className="scan-note">
          This bag holds {formatNumber(quantity)}
          {quantity < line.refs.length ? `, which isn't enough for one board.` : '.'}
        </p>
      ) : null}
      {stock}
    </section>
  );
}

function StockLine({ note }: { note: StockNote }) {
  const text = {
    adding: 'Adding to stock…',
    added: note.state === 'added' ? `Added to stock. ${formatNumber(note.total)} in stock now.` : '',
    already: 'Already in stock, so not added again.',
    failed: note.state === 'failed' ? `Not added to stock. ${note.message}` : '',
  }[note.state];
  return <p className={`scan-stock scan-stock-${note.state}`}>{text}</p>;
}

/** The board's parts, missing ones first. A part is ticked once it's in stock, whoever scanned it. */
export function Checklist({
  lines,
  onPick,
  onClose,
}: {
  lines: readonly BoardLine[];
  onPick: (refs: string[]) => void;
  onClose: () => void;
}) {
  const waiting = lines.filter((line) => line.stock === 0);
  const done = lines.filter((line) => line.stock > 0);

  const row = (line: BoardLine, finished: boolean) => (
    <li key={line.key} className={finished ? 'is-found' : undefined}>
      <button type="button" onClick={() => onPick(line.refs)}>
        <span aria-hidden="true">{finished ? '✓' : '□'}</span>
        <span>{line.value ?? line.partNumber ?? line.mfrPartNumber}</span>
        <small>
          {formatRefs(line.refs)}
          {finished ? ` · ${formatNumber(line.stock)} in stock` : null}
        </small>
      </button>
    </li>
  );

  return (
    <aside className="checklist" aria-label="Parts for this board">
      <header>
        <h2>{waiting.length === 0 ? 'Everything in stock' : `${waiting.length} not in stock yet`}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <ul>
        {waiting.map((line) => row(line, false))}
        {done.map((line) => row(line, true))}
      </ul>
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
