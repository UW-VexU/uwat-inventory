'use client';

import { stockStatus, type BagSummary, type PartSummary, type StockEventView } from '@uwat/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiFailure, errorMessage, newRequestId } from '@/lib/api';
import { formatNumber, timeAgo } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { AddBagDialog } from './AddBagDialog';
import { BoxTag } from './BoxTag';
import { EditPartDialog } from './EditPartDialog';
import { describeEvent } from './eventText';
import { Icon } from './Icon';
import { PartPlacements } from './PartPlacements';
import { useToast } from './Toast';

interface PartResult {
  part: PartSummary;
  eventId?: string;
}

export function PartPanel({ part, onClose }: { part: PartSummary; onClose: () => void }) {
  const { applyPart } = useInventory();
  const toast = useToast();
  const [events, setEvents] = useState<StockEventView[]>([]);
  const [editing, setEditing] = useState(false);
  const [addingBag, setAddingBag] = useState(false);
  const status = stockStatus(part);

  const loadEvents = useCallback(async () => {
    try {
      const result = await api<{ events: StockEventView[] }>(`/api/events?partId=${part.id}&limit=8`);
      setEvents(result.events);
    } catch {
      setEvents([]);
    }
  }, [part.id]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, part.updatedAt]);

  const undo = useCallback(
    async (eventId: string) => {
      try {
        const result = await api<PartResult>(`/api/events/${eventId}/undo`, { method: 'POST' });
        applyPart(result.part);
        toast('Undone.');
      } catch (error) {
        toast(errorMessage(error), { tone: 'error' });
      }
    },
    [applyPart, toast],
  );

  const onChanged = useCallback(
    (result: PartResult, message: string) => {
      applyPart(result.part);
      const { eventId } = result;
      toast(message, eventId ? { action: { label: 'Undo', run: () => void undo(eventId) } } : {});
    },
    [applyPart, toast, undo],
  );

  const copyNumber = async () => {
    if (!part.partNumber) return;
    await navigator.clipboard.writeText(part.partNumber);
    toast('Part number copied.');
  };

  return (
    <aside className="panel" aria-label={part.description}>
      <header className="panel-head">
        <h2 className="panel-title">{part.description}</h2>
        <div className="panel-tools">
          <button type="button" className="icon-button" aria-label="Edit part" title="Edit part" onClick={() => setEditing(true)}>
            <Icon name="edit" />
          </button>
          <button type="button" className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <dl className="panel-numbers">
        {part.partNumber ? (
          <div>
            <dt>P/N</dt>
            <dd>
              <button type="button" className="copyable" onClick={copyNumber} title="Copy part number">
                {part.partNumber}
                <Icon name="copy" size={13} />
              </button>
            </dd>
          </div>
        ) : null}
        {part.mfrPartNumber ? (
          <div>
            <dt>Mfr</dt>
            <dd>{part.mfrPartNumber}</dd>
          </div>
        ) : null}
      </dl>

      <section className="total-plate" aria-label="Total in stock">
        <strong className={`qty-${status}`}>{formatNumber(part.total)}</strong>
        <div>
          <span>in stock</span>
          {part.minQty !== null ? <span className="faint">Reorder at {formatNumber(part.minQty)}</span> : null}
        </div>
        {status !== 'ok' ? <span className={`flag flag-${status}`}>{status === 'out' ? 'Out' : 'Low'}</span> : null}
      </section>

      {part.notes ? <p className="panel-notes">{part.notes}</p> : null}

      <section className="panel-section">
        <div className="section-head">
          <h3>Where it is</h3>
          <button type="button" className="link-button" onClick={() => setAddingBag(true)}>
            Add bag
          </button>
        </div>
        {part.bags.length === 0 ? <p className="muted">No bags left. Add one when new stock arrives.</p> : null}
        {part.bags.map((bag) => (
          <BagCard key={bag.id} bag={bag} onChanged={onChanged} />
        ))}
      </section>

      <PartPlacements part={part} />

      <section className="panel-section">
        <div className="section-head">
          <h3>Recent changes</h3>
        </div>
        {events.length === 0 ? <p className="muted">Nothing yet.</p> : null}
        <ol className="history">
          {events.map((event) => (
            <li key={event.id} className={event.undone ? 'is-undone' : undefined}>
              <span className="history-text">
                <span>{describeEvent(event)}</span>
                <span className="faint">
                  {timeAgo(event.createdAt)}
                  {event.note ? ` · ${event.note}` : ''}
                </span>
              </span>
              {event.canUndo ? (
                <button type="button" className="link-button" onClick={() => void undo(event.id)}>
                  Undo
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {editing ? <EditPartDialog part={part} onClose={() => setEditing(false)} onDeleted={onClose} /> : null}
      {addingBag ? <AddBagDialog part={part} onClose={() => setAddingBag(false)} /> : null}
    </aside>
  );
}

type BagMode = 'idle' | 'count' | 'move' | 'remove';

function BagCard({ bag, onChanged }: { bag: BagSummary; onChanged: (result: PartResult, message: string) => void }) {
  const { snapshot } = useInventory();
  const toast = useToast();
  const [amount, setAmount] = useState('1');
  const [mode, setMode] = useState<BagMode>('idle');
  const [counted, setCounted] = useState(String(bag.quantity));
  const [targetBox, setTargetBox] = useState(bag.box?.id ?? '');
  const [busy, setBusy] = useState(false);

  const where = bag.box?.code ?? 'this bag';
  const parsedAmount = Number(amount);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount > 0;

  const perform = async (request: () => Promise<PartResult>, message: string) => {
    setBusy(true);
    try {
      onChanged(await request(), message);
      setMode('idle');
      setAmount('1');
    } catch (error) {
      const text = errorMessage(error);
      toast(error instanceof ApiFailure && error.status === 0 ? `${text} Nothing was changed.` : text, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const change = (verb: 'take' | 'add') => {
    if (!validAmount) return;
    void perform(
      () =>
        api<PartResult>(`/api/bags/${bag.id}/${verb}`, {
          method: 'POST',
          body: { amount: parsedAmount, requestId: newRequestId() },
        }),
      verb === 'take' ? `Took ${formatNumber(parsedAmount)} from ${where}.` : `Added ${formatNumber(parsedAmount)} to ${where}.`,
    );
  };

  const saveCount = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(counted);
    if (!Number.isInteger(value) || value < 0) return;
    void perform(
      () => api<PartResult>(`/api/bags/${bag.id}/count`, { method: 'POST', body: { counted: value, requestId: newRequestId() } }),
      `Count saved: ${formatNumber(value)} in ${where}.`,
    );
  };

  const saveMove = (event: React.FormEvent) => {
    event.preventDefault();
    const box = snapshot?.boxes.find((candidate) => candidate.id === targetBox);
    void perform(
      () => api<PartResult>(`/api/bags/${bag.id}`, { method: 'PATCH', body: { boxId: targetBox || null } }),
      box ? `Moved to ${box.code}.` : 'Taken out of its box.',
    );
  };

  const remove = () => {
    void perform(() => api<PartResult>(`/api/bags/${bag.id}`, { method: 'DELETE' }), 'Bag removed.');
  };

  return (
    <article className="bag">
      <div className="bag-top">
        <BoxTag code={bag.box?.code} size="large" />
        <div className="bag-qty">
          <strong>{formatNumber(bag.quantity)}</strong>
          <span>in bag</span>
        </div>
      </div>
      {bag.project ? <p className="bag-project">{bag.project}</p> : null}

      {mode === 'idle' ? (
        <>
          <div className="stepper">
            <button
              type="button"
              className="icon-button"
              aria-label="Fewer"
              disabled={parsedAmount <= 1}
              onClick={() => setAmount(String(Math.max(1, parsedAmount - 1)))}
            >
              <Icon name="minus" />
            </button>
            <input
              inputMode="numeric"
              aria-label={`Amount for bag in ${where}`}
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/\D/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') change('take');
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="More"
              onClick={() => setAmount(String((validAmount ? parsedAmount : 0) + 1))}
            >
              <Icon name="plus" />
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !validAmount || parsedAmount > bag.quantity}
              onClick={() => change('take')}
            >
              Take
            </button>
            <button type="button" className="button" disabled={busy || !validAmount} onClick={() => change('add')}>
              Add
            </button>
          </div>
          {validAmount && parsedAmount > bag.quantity ? (
            <p className="bag-hint">Only {formatNumber(bag.quantity)} in this bag.</p>
          ) : null}
          <div className="bag-actions">
            <button type="button" className="link-button" onClick={() => { setCounted(String(bag.quantity)); setMode('count'); }}>
              Count
            </button>
            <button type="button" className="link-button" onClick={() => { setTargetBox(bag.box?.id ?? ''); setMode('move'); }}>
              Move
            </button>
            <button type="button" className="link-button link-danger" onClick={() => setMode('remove')}>
              Remove
            </button>
          </div>
        </>
      ) : null}

      {mode === 'count' ? (
        <form className="bag-form" onSubmit={saveCount}>
          <label className="field">
            <span>How many are in the bag?</span>
            <input
              inputMode="numeric"
              value={counted}
              autoFocus
              onFocus={(event) => event.target.select()}
              onChange={(event) => setCounted(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button type="submit" className="button button-primary" disabled={busy || counted === ''}>
            Save
          </button>
          <button type="button" className="button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      ) : null}

      {mode === 'move' ? (
        <form className="bag-form" onSubmit={saveMove}>
          <label className="field">
            <span>Move to</span>
            <select value={targetBox} autoFocus onChange={(event) => setTargetBox(event.target.value)}>
              <option value="">No box</option>
              {snapshot?.boxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.code}
                  {box.label ? ` · ${box.label}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button button-primary" disabled={busy || targetBox === (bag.box?.id ?? '')}>
            Move
          </button>
          <button type="button" className="button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      ) : null}

      {mode === 'remove' ? (
        <div className="bag-confirm">
          <p>
            Remove this bag and its {formatNumber(bag.quantity)} from stock? You can undo this.
          </p>
          <div>
            <button type="button" className="button button-danger" disabled={busy} onClick={remove}>
              Remove bag
            </button>
            <button type="button" className="button" onClick={() => setMode('idle')}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
