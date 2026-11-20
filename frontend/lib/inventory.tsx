'use client';

import type { CurrentUser, InventorySnapshot, LiveMessage, PartSummary } from '@uwat/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api';

/** A fallback for when the live connection is down. */
const REFRESH_MS = 20_000;
/** Several changes often land together, like a bag and its spots. One reload covers them. */
const LIVE_SETTLE_MS = 150;

export type Arrival = Extract<LiveMessage, { type: 'intake' }> & { seq: number };

interface InventoryContext {
  user: CurrentUser | null;
  snapshot: InventorySnapshot | null;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** Shows a server result straight away, then picks up anything else that changed. */
  applyPart: (part: PartSummary) => void;
  /** Bags scanned in on a phone since this page opened, oldest first. */
  arrivals: readonly Arrival[];
  /** Goes up on every change anyone makes, for pages that load their own data. */
  liveVersion: number;
}

const Context = createContext<InventoryContext | null>(null);

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [liveVersion, setLiveVersion] = useState(0);
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

  useEffect(() => {
    let settle: number | undefined;
    const catchUp = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => void refresh(), LIVE_SETTLE_MS);
    };
    // Reconnects by itself, and catches up on open in case anything changed while it was down.
    const source = new EventSource('/api/live');
    source.onopen = catchUp;
    source.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as LiveMessage;
      if (message.type === 'intake' && message.source === 'phone') {
        setArrivals((current) => [...current, { ...message, seq: (current.at(-1)?.seq ?? 0) + 1 }]);
      }
      setLiveVersion((version) => version + 1);
      catchUp();
    };
    return () => {
      window.clearTimeout(settle);
      source.close();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ user, snapshot, loadError, refresh, applyPart, arrivals, liveVersion }),
    [user, snapshot, loadError, refresh, applyPart, arrivals, liveVersion],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useInventory(): InventoryContext {
  const value = useContext(Context);
  if (!value) throw new Error('useInventory needs an InventoryProvider');
  return value;
}
