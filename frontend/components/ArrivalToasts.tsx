'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { formatNumber } from '@/lib/format';
import { useInventory } from '@/lib/inventory';
import { useToast } from './Toast';

/** Says what just came in from a phone, on whichever page is open. */
export function ArrivalToasts() {
  const { arrivals } = useInventory();
  const toast = useToast();
  const router = useRouter();
  const shown = useRef(0);

  useEffect(() => {
    for (const arrival of arrivals) {
      if (arrival.seq <= shown.current) continue;
      shown.current = arrival.seq;
      toast(`${arrival.by} added ${formatNumber(arrival.quantity)} × ${arrival.name} from the phone`, {
        action: { label: 'Show', run: () => router.push(`/?part=${arrival.partId}`) },
      });
    }
  }, [arrivals, router, toast]);

  return null;
}
