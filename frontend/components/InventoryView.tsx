'use client';

import { buildFacets, filterParts, stockStatus, type PartFilters, type PartSummary, type SortKey } from '@uwat/shared';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatNumber, plural } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { AddBagDialog } from './AddBagDialog';
import { BoxTag } from './BoxTag';
import { Icon } from './Icon';
import { PartPanel } from './PartPanel';

type Stock = PartFilters['stock'];

const MAX_TAGS = 3;

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function setUrlParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, '', url);
}

export function InventoryView() {
  const { snapshot, loadError, arrivals } = useInventory();
  const params = useSearchParams();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [boxId, setBoxId] = useState<string | null>(params.get('box'));
  const [stock, setStock] = useState<Stock>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [descending, setDescending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('part'));
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const allParts = useMemo(() => snapshot?.parts ?? [], [snapshot]);
  // The latest scan of each part, so a second bag of it flashes its row again.
  const arrived = useMemo(() => new Map(arrivals.map((arrival) => [arrival.partId, arrival.seq])), [arrivals]);
  const categories = useMemo(() => buildFacets(allParts).categories, [allParts]);

  const parts = useMemo(() => {
    const sorted = filterParts(allParts, { query, category, boxId, stock }, sort);
    return descending ? sorted.reverse() : sorted;
  }, [allParts, query, category, boxId, stock, sort, descending]);

  const counts = useMemo(() => {
    const statuses = allParts.map(stockStatus);
    return {
      low: statuses.filter((status) => status !== 'ok').length,
      out: statuses.filter((status) => status === 'out').length,
    };
  }, [allParts]);

  const selected = allParts.find((part) => part.id === selectedId) ?? null;
  const box = snapshot?.boxes.find((candidate) => candidate.id === boxId) ?? null;

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setUrlParam('part', id);
  }, []);

  const changeBox = (id: string | null) => {
    setBoxId(id);
    setUrlParam('box', id);
  };

  const hasFilters = Boolean(query || category || boxId || stock);
  const clearFilters = () => {
    setQuery('');
    setCategory(null);
    changeBox(null);
    setStock(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;

      if (event.key === 'Escape' && selectedId) {
        select(null);
        return;
      }
      if (isTyping(event.target) && !(event.target === searchRef.current && /^Arrow(Up|Down)$/.test(event.key))) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'n') {
        event.preventDefault();
        setAdding(true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const index = parts.findIndex((part) => part.id === selectedId);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = parts[Math.min(parts.length - 1, Math.max(0, index + step))];
        if (next) select(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [parts, select, selectedId]);

  // A "Show" on a phone scan notice links here with ?part=.
  const partParam = params.get('part');
  useEffect(() => {
    setSelectedId(partParam);
  }, [partParam]);

  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(`[data-part="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending((value) => !value);
    else {
      setSort(key);
      setDescending(false);
    }
  };

  const sortState = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sort !== key) return 'none';
    return descending ? 'descending' : 'ascending';
  };

  if (!snapshot) {
    return (
      <div className="page">
        <p className={loadError ? 'form-error' : 'muted'}>{loadError ?? 'Loading inventory…'}</p>
      </div>
    );
  }

  return (
    <div className={`inventory ${selected ? 'inventory-open' : ''}`}>
      <div className="inventory-main">
        <header className="finder">
          <label className="search">
            <Icon name="search" size={22} />
            <span className="sr-only">Search parts</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search: 10k 0603, op amp, LM323, B-07"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <kbd>/</kbd>
          </label>
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            <span className="button-text">Add bag</span>
          </button>
        </header>

        <div className="filters">
          <div className="chips" role="group" aria-label="Filter parts">
            {box || boxId === 'none' ? (
              <button type="button" className="chip" aria-pressed="true" title="Show every box" onClick={() => changeBox(null)}>
                {box ? `In ${box.code}` : 'Not in a box'}
                <Icon name="close" size={14} />
              </button>
            ) : null}
            <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory(null)}>
              All
            </button>
            {categories.map((facet) => (
              <button
                key={facet.value}
                type="button"
                className="chip"
                aria-pressed={category === facet.value}
                onClick={() => setCategory(category === facet.value ? null : facet.value)}
              >
                {facet.value}
              </button>
            ))}
            {counts.low > 0 ? (
              <button
                type="button"
                className="chip chip-low"
                aria-pressed={stock === 'low'}
                onClick={() => setStock(stock === 'low' ? null : 'low')}
              >
                Low <span>{formatNumber(counts.low)}</span>
              </button>
            ) : null}
            {counts.out > 0 ? (
              <button
                type="button"
                className="chip chip-out"
                aria-pressed={stock === 'out'}
                onClick={() => setStock(stock === 'out' ? null : 'out')}
              >
                Out <span>{formatNumber(counts.out)}</span>
              </button>
            ) : null}
          </div>
          {hasFilters ? (
            <p className="result-count" aria-live="polite">
              {plural(parts.length, 'part')}
              <button type="button" className="link-button" onClick={clearFilters}>
                Clear
              </button>
            </p>
          ) : null}
        </div>

        {allParts.length === 0 ? (
          <EmptyInventory onAdd={() => setAdding(true)} />
        ) : parts.length === 0 ? (
          <div className="empty">
            <h2>No parts match</h2>
            <p>Try fewer words, or clear the filters.</p>
            <button type="button" className="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <table className="parts">
            <thead>
              <tr>
                <th aria-sort={sortState('name')}>
                  <button type="button" onClick={() => sortBy('name')}>
                    Part
                  </button>
                </th>
                <th className="col-box" aria-sort={sortState('box')}>
                  <button type="button" onClick={() => sortBy('box')}>
                    Box
                  </button>
                </th>
                <th className="col-qty" aria-sort={sortState('qty')}>
                  <button type="button" onClick={() => sortBy('qty')}>
                    Qty
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <PartRow
                  key={`${part.id}:${arrived.get(part.id) ?? 0}`}
                  part={part}
                  selected={part.id === selectedId}
                  isNew={arrived.has(part.id)}
                  onSelect={select}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected ? <PartPanel key={selected.id} part={selected} onClose={() => select(null)} /> : null}
      {adding ? (
        <AddBagDialog
          onClose={() => setAdding(false)}
          onCreated={(part) => select(part.id)}
          defaultBoxId={boxId && boxId !== 'none' ? boxId : null}
        />
      ) : null}
    </div>
  );
}

function PartRow({
  part,
  selected,
  isNew,
  onSelect,
}: {
  part: PartSummary;
  selected: boolean;
  isNew: boolean;
  onSelect: (id: string) => void;
}) {
  const status = stockStatus(part);
  const codes = [...new Set(part.bags.map((bag) => bag.box?.code ?? null))];
  const shown = codes.slice(0, MAX_TAGS);

  return (
    <tr
      data-part={part.id}
      className={[selected && 'is-selected', isNew && 'is-new'].filter(Boolean).join(' ') || undefined}
      onClick={() => onSelect(part.id)}
    >
      <td>
        <button type="button" className="part-name" onClick={() => onSelect(part.id)}>
          {part.description}
        </button>
        <span className="part-number">{part.partNumber ?? part.mfrPartNumber ?? 'No part number'}</span>
      </td>
      <td>
        <span className="tags">
          {shown.length === 0 ? <span className="faint">No bags</span> : null}
          {shown.map((code) => (
            <BoxTag key={code ?? 'none'} code={code} />
          ))}
          {codes.length > MAX_TAGS ? <span className="faint">+{codes.length - MAX_TAGS}</span> : null}
        </span>
      </td>
      <td className="col-qty">
        <span className={`qty qty-${status}`}>{formatNumber(part.total)}</span>
        {isNew ? <span className="flag flag-new">New</span> : null}
        {status !== 'ok' ? <span className={`flag flag-${status}`}>{status === 'out' ? 'Out' : 'Low'}</span> : null}
      </td>
    </tr>
  );
}

function EmptyInventory({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <h2>No parts yet</h2>
      <p>Add your first bag, or bring everything in at once from a spreadsheet or pasted labels.</p>
      <div className="empty-actions">
        <button type="button" className="button button-primary" onClick={onAdd}>
          <Icon name="plus" />
          Add bag
        </button>
        <a className="button" href="/import">
          <Icon name="upload" />
          Import
        </a>
      </div>
    </div>
  );
}
