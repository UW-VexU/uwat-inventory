'use client';

import {
  describeRole,
  filterParts,
  formatRefs,
  parseRefList,
  refKind,
  type PartSummary,
  type PlacementView,
} from '@uwat/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { BoxTag } from './BoxTag';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { WiringDiagram } from './WiringDiagram';

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

const MAX_SUGGESTIONS = 6;

interface Props {
  boardId: string;
  spot: PlacementView;
  placements: readonly PlacementView[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}

export function SpotCard({ boardId, spot, placements, onClose, onChanged }: Props) {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const role = describeRole(spot, placements);

  const unlink = async () => {
    try {
      await api(`/api/boards/${boardId}/link`, { method: 'POST', body: { refs: [spot.ref], partId: null } });
      await onChanged();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <aside className="spot-float" aria-label={spot.ref}>
      <header className="spot-card-head">
        <span className="box-tag box-tag-large">
          <span>{spot.ref}</span>
        </span>
        <span className="eyebrow">
          {spot.side === 'top' ? 'Top' : 'Bottom'}
          {spot.packageGuess ? ` · ${spot.packageGuess}` : ''}
        </span>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      {linking ? (
        <PartPicker
          boardId={boardId}
          spot={spot}
          onDone={async () => {
            setLinking(false);
            await onChanged();
          }}
          onCancel={() => setLinking(false)}
        />
      ) : (
        <>
          {spot.part ? (
            <div className="spot-part">
              <Link href={`/?part=${spot.part.id}`} className="spot-part-name">
                {spot.part.description}
              </Link>
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
          ) : (
            <div className="spot-part">
              <p className="muted">
                {spot.bomPartNumber ? `The BOM says ${spot.bomPartNumber}, which isn't in stock.` : 'No part linked yet.'}
              </p>
              <button type="button" className="button" onClick={() => setLinking(true)}>
                Link a part
              </button>
            </div>
          )}
          {role ? <p className="spot-role">{role}</p> : null}
          <WiringDiagram placement={spot} all={placements} />
        </>
      )}
    </aside>
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
          placeholder={spot.packageGuess ? `Showing ${spot.packageGuess}. Search for others.` : 'Search parts'}
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
