'use client';

import type { BoxSummary } from '@uwat/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BoxTag } from '@/components/BoxTag';
import { Dialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';

export default function BoxesPage() {
  const { snapshot, refresh } = useInventory();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BoxSummary | null>(null);

  const unitsByBox = useMemo(() => {
    const units = new Map<string, number>();
    for (const part of snapshot?.parts ?? []) {
      for (const bag of part.bags) {
        if (bag.box) units.set(bag.box.id, (units.get(bag.box.id) ?? 0) + bag.quantity);
      }
    }
    return units;
  }, [snapshot]);

  const loose = useMemo(
    () => (snapshot?.parts ?? []).reduce((sum, part) => sum + part.bags.filter((bag) => !bag.box).length, 0),
    [snapshot],
  );

  if (!snapshot) return <div className="page"><p className="muted">Loading boxes…</p></div>;
  const boxes = [...snapshot.boxes].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Boxes</h1>
          <p className="muted">
            {plural(boxes.length, 'box', 'boxes')}. Open one to see what's in it.
          </p>
        </div>
        <div className="page-actions">
          <Link className="button" href="/boxes/labels">
            <Icon name="print" />
            Print labels
          </Link>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add boxes
          </button>
        </div>
      </header>

      {loose > 0 ? (
        <Link className="notice" href="/?box=none">
          {plural(loose, 'bag')} not in a box yet. Open them to file them.
        </Link>
      ) : null}

      {boxes.length === 0 ? (
        <div className="empty">
          <h2>No boxes yet</h2>
          <p>Add a box for each real box on the shelf, then print labels so each code matches.</p>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add boxes
          </button>
        </div>
      ) : (
        <ul className="box-grid">
          {boxes.map((box) => (
            <li key={box.id} className="box-card">
              <Link href={`/?box=${box.id}`} className="box-card-link">
                <BoxTag code={box.code} size="large" />
                <span className="box-card-label">{box.label ?? ' '}</span>
                <span className="box-card-stats">
                  <strong>{formatNumber(box.bagCount)}</strong> {box.bagCount === 1 ? 'bag' : 'bags'}
                  <span className="faint"> · {formatNumber(unitsByBox.get(box.id) ?? 0)} units</span>
                </span>
              </Link>
              <button
                type="button"
                className="icon-button box-card-edit"
                aria-label={`Edit ${box.code}`}
                onClick={() => setEditing(box)}
              >
                <Icon name="edit" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddBoxesDialog
          onClose={() => setAdding(false)}
          onDone={(count) => {
            void refresh();
            toast(`Added ${count === 1 ? '1 box' : `${count} boxes`}.`);
          }}
        />
      ) : null}
      {editing ? <EditBoxDialog box={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function AddBoxesDialog({ onClose, onDone }: { onClose: () => void; onDone: (count: number) => void }) {
  const [count, setCount] = useState('1');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = Number(count);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/boxes', { method: 'POST', body: { count: parsed } });
      onDone(parsed);
      onClose();
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add boxes" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>How many?</span>
          <input
            inputMode="numeric"
            value={count}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))}
          />
          <small>Codes continue from your highest box number.</small>
        </label>
        {problem ? <p className="form-error" role="alert">{problem}</p> : null}
        <footer className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy || parsed < 1 || parsed > 100}>
            Add
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function EditBoxDialog({ box, onClose }: { box: BoxSummary; onClose: () => void }) {
  const { refresh } = useInventory();
  const toast = useToast();
  const [code, setCode] = useState(box.code);
  const [label, setLabel] = useState(box.label ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (request: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setProblem(null);
    try {
      await request();
      await refresh();
      toast(message);
      onClose();
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Edit ${box.code}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => api(`/api/boxes/${box.id}`, { method: 'PATCH', body: { code, label } }), 'Box saved.');
        }}
      >
        <label className="field">
          <span>Code</span>
          <input value={code} spellCheck={false} onChange={(event) => setCode(event.target.value.toUpperCase())} />
          <small>If you change this, reprint the box's label.</small>
        </label>
        <label className="field">
          <span>Label (optional)</span>
          <input value={label} placeholder="Passives, shelf 2" onChange={(event) => setLabel(event.target.value)} />
        </label>
        {problem ? <p className="form-error" role="alert">{problem}</p> : null}
        <footer className="form-actions form-actions-split">
          <button
            type="button"
            className="link-button link-danger"
            disabled={busy}
            onClick={() => void run(() => api(`/api/boxes/${box.id}`, { method: 'DELETE' }), `${box.code} deleted.`)}
          >
            Delete box
          </button>
          <button type="submit" className="button button-primary" disabled={busy || !code.trim()}>
            Save
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
