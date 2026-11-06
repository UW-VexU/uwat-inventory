'use client';

import { CATEGORIES, type PartSummary } from '@uwat/shared';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

export function EditPartDialog({
  part,
  onClose,
  onDeleted,
}: {
  part: PartSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { applyPart, refresh } = useInventory();
  const toast = useToast();
  const [partNumber, setPartNumber] = useState(part.partNumber ?? '');
  const [mfrPartNumber, setMfrPartNumber] = useState(part.mfrPartNumber ?? '');
  const [description, setDescription] = useState(part.description);
  const [category, setCategory] = useState(part.category);
  const [packageName, setPackageName] = useState(part.package ?? '');
  const [minQty, setMinQty] = useState(part.minQty === null ? '' : String(part.minQty));
  const [notes, setNotes] = useState(part.notes ?? '');
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const result = await api<{ part: PartSummary }>(`/api/parts/${part.id}`, {
        method: 'PATCH',
        body: {
          partNumber,
          mfrPartNumber,
          description,
          category,
          package: packageName,
          minQty: minQty === '' ? null : Number(minQty),
          notes,
        },
      });
      applyPart(result.part);
      toast('Part saved.');
      onClose();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/parts/${part.id}`, { method: 'DELETE' });
      await refresh();
      toast('Part deleted. Undo it from Activity if that was a mistake.');
      onClose();
      onDeleted();
    } catch (error) {
      setProblem(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Edit part" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Description</span>
          <input value={description} required onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">
            <span>P/N</span>
            <input value={partNumber} spellCheck={false} onChange={(event) => setPartNumber(event.target.value)} />
          </label>
          <label className="field">
            <span>Manufacturer P/N</span>
            <input value={mfrPartNumber} spellCheck={false} onChange={(event) => setMfrPartNumber(event.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Package</span>
            <input value={packageName} onChange={(event) => setPackageName(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Reorder when total reaches</span>
          <input
            inputMode="numeric"
            value={minQty}
            placeholder="Leave blank for no warning"
            onChange={(event) => setMinQty(event.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>

        {problem ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}

        {confirming ? (
          <div className="bag-confirm">
            <p>Delete this part and its {plural(part.bags.length, 'bag')}? You can undo this from Activity.</p>
            <div>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => void remove()}>
                Delete part
              </button>
              <button type="button" className="button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <footer className="form-actions form-actions-split">
            <button type="button" className="link-button link-danger" onClick={() => setConfirming(true)}>
              Delete part
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              Save
            </button>
          </footer>
        )}
      </form>
    </Dialog>
  );
}
