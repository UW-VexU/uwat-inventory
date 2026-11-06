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
  const { snapshot, loadError } = useInventory();
  const params = useSearchParams();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [packageName, setPackageName] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [boxId, setBoxId] = useState<string | null>(params.get('box'));
  const [stock, setStock] = useState<Stock>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [descending, setDescending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('part'));
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const allParts = useMemo(() => snapshot?.parts ?? [], [snapshot]);
  const facets = useMemo(() => buildFacets(allParts), [allParts]);

  const parts = useMemo(() => {
    const sorted = filterParts(allParts, { query, category, package: packageName, project, boxId, stock }, sort);
    return descending ? sorted.reverse() : sorted;
  }, [allParts, query, category, packageName, project, boxId, stock, sort, descending]);

  const counts = useMemo(() => {
    const statuses = allParts.map(stockStatus);
    return {
      bags: allParts.reduce((sum, part) => sum + part.bags.length, 0),
      low: statuses.filter((status) => status !== 'ok').length,
      out: statuses.filter((status) => status === 'out').length,
    };
  }, [allParts]);

  const selected = allParts.find((part) => part.id === selectedId) ?? null;

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setUrlParam('part', id);
  }, []);

  const changeBox = (id: string | null) => {
    setBoxId(id);
    setUrlParam('box', id);
  };

  const hasFilters = Boolean(query || category || packageName || project || boxId || stock);
  const clearFilters = () => {
    setQuery('');
    setCategory(null);
    setPackageName(null);
    setProject(null);
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

        <div className="ledger" role="group" aria-label="Stock totals">
          <div className="ledger-cell">
            <strong>{formatNumber(allParts.length)}</strong>
            <span>Parts</span>
          </div>
          <div className="ledger-cell">
            <strong>{formatNumber(counts.bags)}</strong>
            <span>Bags</span>
          </div>
          <div className="ledger-cell">
            <strong>{formatNumber(snapshot.boxes.length)}</strong>
            <span>Boxes</span>
          </div>
          <button
            type="button"
            className="ledger-cell ledger-button ledger-low"
            aria-pressed={stock === 'low'}
            onClick={() => setStock(stock === 'low' ? null : 'low')}
          >
            <strong>{formatNumber(counts.low)}</strong>
            <span>Low</span>
          </button>
          <button
            type="button"
            className="ledger-cell ledger-button ledger-out"
            aria-pressed={stock === 'out'}
            onClick={() => setStock(stock === 'out' ? null : 'out')}
          >
            <strong>{formatNumber(counts.out)}</strong>
            <span>Out</span>
          </button>
        </div>

        <div className="filters">
          <div className="chips" role="group" aria-label="Category">
            <button type="button" className="chip" aria-pressed={!category} onClick={() => setCategory(null)}>
              All
            </button>
            {facets.categories.map((facet) => (
              <button
                key={facet.value}
                type="button"
                className="chip"
                aria-pressed={category === facet.value}
                onClick={() => setCategory(category === facet.value ? null : facet.value)}
              >
                {facet.value}
                <span>{facet.count}</span>
              </button>
            ))}
          </div>

          <div className="selects">
            <label className="select">
              <span>Package</span>
              <select value={packageName ?? ''} onChange={(event) => setPackageName(event.target.value || null)}>
                <option value="">Any package</option>
                {facets.packages.map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.value} ({facet.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="select">
              <span>Project</span>
              <select value={project ?? ''} onChange={(event) => setProject(event.target.value || null)}>
                <option value="">Any project</option>
                {facets.projects.map((facet) => (
                  <option key={facet.value} value={facet.value}>
                    {facet.value} ({facet.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="select">
              <span>Box</span>
              <select value={boxId ?? ''} onChange={(event) => changeBox(event.target.value || null)}>
                <option value="">Any box</option>
                <option value="none">No box</option>
                {snapshot.boxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.code}
                  </option>
                ))}
              </select>
            </label>
            <p className="result-count" aria-live="polite">
              {plural(parts.length, 'part')}
              {hasFilters ? (
                <button type="button" className="link-button" onClick={clearFilters}>
                  Clear
                </button>
              ) : null}
            </p>
          </div>
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
                <th className="col-package">Package</th>
                <th aria-sort={sortState('box')}>
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
                <PartRow key={part.id} part={part} selected={part.id === selectedId} onSelect={select} />
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
  onSelect,
}: {
  part: PartSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const status = stockStatus(part);
  const codes = [...new Set(part.bags.map((bag) => bag.box?.code ?? null))];
  const shown = codes.slice(0, MAX_TAGS);

  return (
    <tr data-part={part.id} className={selected ? 'is-selected' : undefined} onClick={() => onSelect(part.id)}>
      <td>
        <button type="button" className="part-name" onClick={() => onSelect(part.id)}>
          {part.description}
        </button>
        <span className="part-number">{part.partNumber ?? part.mfrPartNumber ?? 'No part number'}</span>
      </td>
      <td className="col-package">{part.package ?? <span className="faint">—</span>}</td>
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
