'use client';

import { buildFacets, looksLikeLabelText, parseDescription, parseLabelText, type PartSummary } from '@uwat/shared';
import { useMemo, useRef, useState } from 'react';
import { api, ApiFailure, errorMessage, newRequestId } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { Dialog } from './Dialog';
import { useToast } from './Toast';

interface Props {
  /** Adding another bag of a part we already have. */
  part?: PartSummary;
  defaultBoxId?: string | null;
  onClose: () => void;
  onCreated?: (part: PartSummary) => void;
}

export function AddBagDialog({ part, defaultBoxId = null, onClose, onCreated }: Props) {
  const { snapshot, applyPart } = useInventory();
  const toast = useToast();
  const [partNumber, setPartNumber] = useState(part?.partNumber ?? '');
  const [description, setDescription] = useState(part?.description ?? '');
  const [quantity, setQuantity] = useState('');
  const [boxId, setBoxId] = useState(defaultBoxId ?? '');
  const [project, setProject] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const numberRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(newRequestId());

  const parts = useMemo(() => snapshot?.parts ?? [], [snapshot]);
  const projects = useMemo(() => buildFacets(parts).projects, [parts]);

  const trimmedNumber = partNumber.trim().toUpperCase();
  const existing = part ?? (trimmedNumber ? parts.find((item) => item.partNumber?.toUpperCase() === trimmedNumber) : undefined);
  const preview = description.trim() ? parseDescription(description) : null;
  const parsedQuantity = Number(quantity);
  const canSave = quantity !== '' && Number.isInteger(parsedQuantity) && (Boolean(existing) || Boolean(description.trim() || trimmedNumber));

  const fillFromLabel = (text: string) => {
    const label = parseLabelText(text)[0];
    if (!label) return;
    setPartNumber(label.partNumber ?? '');
    setDescription(label.description ?? '');
    setQuantity(label.quantity === null ? '' : String(label.quantity));
    setProject(label.project ?? '');
  };

  const reset = () => {
    setPartNumber('');
    setDescription('');
    setQuantity('');
    setProject('');
    requestId.current = newRequestId();
    numberRef.current?.focus();
  };

  const save = async (keepGoing: boolean, force = false) => {
    if (!canSave) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api<{ part: PartSummary }>('/api/intake', {
        method: 'POST',
        body: {
          ...(existing ? { partId: existing.id } : { partNumber: trimmedNumber ? partNumber.trim() : null, description }),
          quantity: parsedQuantity,
          boxId: boxId || null,
          project,
          force,
          requestId: requestId.current,
        },
      });
      applyPart(result.part);
      if (keepGoing && !part) {
        setAdded((count) => count + 1);
        reset();
      } else {
        toast(`Added ${formatNumber(parsedQuantity)} of ${result.part.description}.`);
        onCreated?.(result.part);
        onClose();
      }
    } catch (error) {
      setProblem(error instanceof ApiFailure ? error.message : errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={part ? 'Add a bag of this part' : 'Add bag'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(!part);
        }}
      >
        {part ? (
          <p className="form-note">{part.description}</p>
        ) : (
          <>
            <label className="field">
              <span>P/N</span>
              <input
                ref={numberRef}
                value={partNumber}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="LM323M-ND"
                onChange={(event) => setPartNumber(event.target.value)}
                onPaste={(event) => {
                  const text = event.clipboardData.getData('text');
                  if (looksLikeLabelText(text)) {
                    event.preventDefault();
                    fillFromLabel(text);
                    quantityRef.current?.focus();
                  }
                }}
              />
            </label>

            {existing ? (
              <p className="form-note">
                {existing.description} is already in stock ({formatNumber(existing.total)}). This adds another bag of it.
              </p>
            ) : (
              <label className="field">
                <span>Description</span>
                <input
                  value={description}
                  autoComplete="off"
                  placeholder="IC OPAMP GP 4 CIRCUIT 14SOIC"
                  onChange={(event) => setDescription(event.target.value)}
                />
                {preview ? (
                  <small>
                    Files under {preview.category}
                    {preview.package ? ` · ${preview.package}` : ''}. You can change this later.
                  </small>
                ) : null}
              </label>
            )}
          </>
        )}

        <div className="form-row">
          <label className="field">
            <span>Quantity</span>
            <input
              ref={quantityRef}
              inputMode="numeric"
              value={quantity}
              autoFocus={Boolean(part)}
              onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="field">
            <span>Box</span>
            <select value={boxId} onChange={(event) => setBoxId(event.target.value)}>
              <option value="">No box yet</option>
              {snapshot?.boxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.code}
                  {box.label ? ` · ${box.label}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Project (optional)</span>
          <input
            list="projects"
            value={project}
            autoComplete="off"
            placeholder="CUST REF on the label, like BMS/EMBEDDED"
            onChange={(event) => setProject(event.target.value)}
          />
          <datalist id="projects">
            {projects.map((facet) => (
              <option key={facet.value} value={facet.value} />
            ))}
          </datalist>
        </label>

        {problem ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}

        <footer className="form-actions">
          {added > 0 ? <span className="form-progress">{plural(added, 'bag')} added</span> : null}
          {!part ? (
            <button type="button" className="button" disabled={busy || !canSave} onClick={() => void save(false)}>
              Save and close
            </button>
          ) : null}
          <button type="submit" className="button button-primary" disabled={busy || !canSave}>
            {part ? 'Add bag' : 'Save and add another'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
