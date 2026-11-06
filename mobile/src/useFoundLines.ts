import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

/** Remembers what's been found on this phone, so closing the app doesn't lose your place. */
export function useFoundLines(boardId: string) {
  const storageKey = `found_${boardId}`;
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    void SecureStore.getItemAsync(storageKey).then((saved) => {
      setFound(new Set(saved ? (JSON.parse(saved) as string[]) : []));
    });
  }, [storageKey]);

  const save = useCallback(
    (next: ReadonlySet<string>) => {
      setFound(next);
      void SecureStore.setItemAsync(storageKey, JSON.stringify([...next]));
    },
    [storageKey],
  );

  const markFound = useCallback(
    (key: string) => {
      setFound((current) => {
        const next = new Set(current).add(key);
        void SecureStore.setItemAsync(storageKey, JSON.stringify([...next]));
        return next;
      });
    },
    [storageKey],
  );

  return { found, markFound, reset: useCallback(() => save(new Set()), [save]) };
}
