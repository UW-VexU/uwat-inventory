'use client';

import type { CurrentUser, InventorySnapshot, PartSummary } from '@uwat/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';

const REFRESH_MS = 20_000;

interface InventoryContext {
  user: CurrentUser | null;
  snapshot: InventorySnapshot | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Shows a server result straight away, then picks up anything else that changed. */
  applyPart: (part: PartSummary) => void;
}

const Context = createContext<InventoryContext | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const writes = useRef(0);

  const refresh = useCallback(async () => {
    const startedAt = writes.current;
    try {
      const next = await api<InventorySnapshot>('/api/inventory');
      // A write landed while this was in flight, so this copy is already out of date.
      if (writes.current === startedAt) setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  const applyPart = useCallback(
    (part: PartSummary) => {
      writes.current += 1;
      setSnapshot((current) => {
        if (!current) return current;
        const known = current.parts.some((existing) => existing.id === part.id);
        return {
          ...current,
          parts: known
            ? current.parts.map((existing) => (existing.id === part.id ? part : existing))
            : [...current.parts, part],
        };
      });
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    api<{ user: CurrentUser }>('/api/auth/me')
      .then((result) => setUser(result.user))
      .catch(() => window.location.assign('/login'));
    void refresh();

    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ user, snapshot, loadError, refresh, applyPart }),
    [user, snapshot, loadError, refresh, applyPart],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useInventory(): InventoryContext {
  const value = useContext(Context);
  if (!value) throw new Error('useInventory needs an InventoryProvider');
  return value;
}
