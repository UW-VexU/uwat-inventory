'use client';

import type { ImportProblem, ImportRow } from '@uwat/shared';
import { useState } from 'react';
import { BoxTag } from '@/components/BoxTag';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';

type Status = 'new' | 'adds-bag' | 'in-stock';

interface Preview {
  rows: (ImportRow & { status: Status })[];
  problems: ImportProblem[];
  newBoxes: string[];
}

const STATUS_TEXT: Record<Status, string> = {
  new: 'New part',
  'adds-bag': 'Refills part',
  'in-stock': 'Already in stock',
};

const EXAMPLE = `P/N LM323M-ND
Desc: IC OPAMP GP 4 CIRCUIT 14SOIC
QTY: 5
CUST REF: BMS/EMBEDDED
IDX: 13`;

export default function ImportPage() {
  const { snapshot, refresh } = useInventory();
  const toast = useToast();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [boxId, setBoxId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const review = async (source: string) => {
    setBusy(true);
    setProblem(null);
    try {
      setPreview(await api<Preview>('/api/import/preview', { method: 'POST', body: { text: source } }));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const contents = await file.text();
    setText(contents);
    await review(contents);
  };

  const commit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await api<{ created: number; skipped: number }>('/api/import/commit', {
        method: 'POST',
        body: { text, skipExisting, boxId: boxId || null },
      });
      await refresh();
      toast(
        `Imported ${plural(result.created, 'bag')}${result.skipped ? `, skipped ${formatNumber(result.skipped)}` : ''}.`,
      );
      setText('');
      setPreview(null);
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const importing = preview?.rows.filter((row) => !(skipExisting && row.status === 'in-stock')).length ?? 0;
  const inStock = preview?.rows.filter((row) => row.status === 'in-stock').length ?? 0;
  const rowsWithoutBox = preview?.rows.some((row) => !row.boxCode) ?? false;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Import</h1>
      </header>

      {!preview ? (
        <section className="import-source">
          <label className="field">
            <span>Paste labels or CSV</span>
            <textarea
              rows={12}
              value={text}
              spellCheck={false}
              placeholder={EXAMPLE}
              onChange={(event) => setText(event.target.value)}
            />
            <small>
              CSVs need a quantity column plus a P/N or description column. DigiKey order exports work as they are.
            </small>
          </label>
          {problem ? <p className="form-error" role="alert">{problem}</p> : null}
          <div className="import-actions">
            <label className="button">
              <Icon name="upload" />
              Choose CSV file
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="sr-only"
                onChange={(event) => void openFile(event.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !text.trim()}
              onClick={() => void review(text)}
            >
              Review
            </button>
          </div>
        </section>
      ) : (
        <section>
          {preview.problems.length > 0 ? (
            <div className="import-problems" role="alert">
              <h2>{plural(preview.problems.length, 'row')} can't be imported</h2>
              <ul>
                {preview.problems.slice(0, 20).map((item) => (
                  <li key={`${item.line}-${item.message}`}>
                    Line {item.line}: {item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.rows.length > 0 ? (
            <>
              <div className="import-options">
                {inStock > 0 ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={skipExisting}
                      onChange={(event) => setSkipExisting(event.target.checked)}
                    />
                    Skip the {plural(inStock, 'row')} already in stock
                  </label>
                ) : null}
                {rowsWithoutBox ? (
                  <label className="select">
                    <span>Rows with no box go in</span>
                    <select value={boxId} onChange={(event) => setBoxId(event.target.value)}>
                      <option value="">No box yet</option>
                      {snapshot?.boxes.map((box) => (
                        <option key={box.id} value={box.id}>
                          {box.code}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {preview.newBoxes.length > 0 ? (
                  <p className="muted">Creates {plural(preview.newBoxes.length, 'new box', 'new boxes')}.</p>
                ) : null}
              </div>

              <table className="parts import-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Box</th>
                    <th className="col-qty">Qty</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.line} className={skipExisting && row.status === 'in-stock' ? 'is-skipped' : undefined}>
                      <td>
                        <span className="part-name">{row.description}</span>
                        <span className="part-number">{row.partNumber ?? 'No part number'}</span>
                      </td>
                      <td>{row.boxCode ? <BoxTag code={row.boxCode} /> : <span className="faint">—</span>}</td>
                      <td className="col-qty">
                        <span className="qty">{formatNumber(row.quantity)}</span>
                      </td>
                      <td className="muted">{STATUS_TEXT[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 200 ? (
                <p className="muted">Showing the first 200 of {formatNumber(preview.rows.length)} rows.</p>
              ) : null}
            </>
          ) : null}

          {problem ? <p className="form-error" role="alert">{problem}</p> : null}
          <div className="import-actions">
            <button type="button" className="button" onClick={() => setPreview(null)}>
              Back
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || importing === 0}
              onClick={() => void commit()}
            >
              Import {plural(importing, 'bag')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
